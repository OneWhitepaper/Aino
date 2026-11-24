"""Desktop history sync must preserve executable conversations across owner restarts.

Exercise real gateways, the native recovery helper, the authenticated importer and
the bundled Code engine. Only the provider is replaced by a loopback HTTP server.
"""

import asyncio
import hashlib
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import threading

import httpx
import pytest

from persistence_assembly import open_persistence, open_persistence_reader, profile_scope
from tests.gateway.fixtures.local_recovery_probe import Model, child_env, daemon, rpc, websocket
from tests.gateway.test_native_http_auth import headers, ticket
from tests.waiting import async_wait_until


class AccountKeyModel(Model):
    def do_POST(self):
        self.server.authorizations.append(self.headers.get('Authorization'))
        super().do_POST()


@pytest.fixture
def history_model():
    peer = ThreadingHTTPServer(("127.0.0.1", 0), AccountKeyModel)
    peer.daemon_threads = True
    peer.requests = []
    peer.authorizations = []
    peer.blocked, peer.release = threading.Event(), threading.Event()
    worker = threading.Thread(target=peer.serve_forever, daemon=True)
    worker.start()
    try:
        yield peer
    finally:
        peer.release.set()
        peer.shutdown()
        peer.server_close()
        worker.join(timeout=5)


def _native_helper(root, env, request):
    completed = subprocess.run(
        [sys.executable, "-m", "hermes_cli.desktop_history_recovery"],
        input=json.dumps(request), capture_output=True, text=True, cwd=root,
        env=env, timeout=60, check=False,
    )
    assert completed.returncode == 0, (request["action"], completed.stdout, completed.stderr)
    result = json.loads(completed.stdout)
    assert result["ok"] is True, result
    return result


def _file_hashes(home):
    # The shared-memory lock index changes when SQLite opens a read-only snapshot.
    return {
        str(path.relative_to(home)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in home.rglob("*") if path.is_file() and path != home / "state.db-shm"
    }


def _assert_source_unchanged(home, before):
    after = _file_hashes(home)
    assert {name: after.get(name) for name in before} == before
    # Read-only snapshots may also create an empty WAL without changing stored data.
    added = after.keys() - before.keys()
    assert added <= {"state.db-wal"}, added
    if "state.db-wal" in added:
        assert (home / "state.db-wal").stat().st_size == 0


def _session_config(home, sid):
    with open_persistence_reader(home) as store:
        return store.sessions.get(sid).model_config


def _assert_binding(snapshot, sid, mode, model, cwd):
    assert snapshot["session_id"] == sid, snapshot
    info = snapshot["info"]
    assert (info["execution_mode"], info["model"], info["cwd"]) == (mode, model, str(cwd)), info


async def _resume(ws, sid):
    reply = await rpc(ws, "session.resume", session_id=sid)
    assert "result" in reply, reply
    return reply["result"]


async def _send(ws, home, sid, input_id, text):
    submitted = await rpc(ws, "prompt.submit", session_id=sid, input_id=input_id, text=text)
    assert submitted.get("result", {}).get("status") == "queued", submitted

    def terminal():
        with sqlite3.connect(f"{(home / 'state.db').as_uri()}?mode=ro", uri=True) as db:
            row = db.execute(
                "SELECT status FROM session_admissions WHERE request_id=?", (input_id,),
            ).fetchone()
        return row is not None and row[0] == "terminal"

    await async_wait_until(terminal, timeout=60, interval=0.05, what=f"{input_id} turn committed")
    snapshot = await _resume(ws, sid)
    assert any(
        message.get("role") == "assistant" and "RECOVERY_ACK_" in str(message.get("content"))
        and text in str(message.get("content"))
        for message in snapshot["messages"]
    ), snapshot
    return snapshot


def _assert_provider_history(peer, offset, model, text, previous):
    requests = [body for body in peer.requests[offset:] if any(
        message.get("role") == "user" and text in json.dumps(message.get("content"))
        for message in body["messages"]
    )]
    assert requests, peer.requests[offset:]
    for body in requests:
        assert body["model"] == model, body
        for old_text in previous:
            assert any(message.get("role") == "user" and old_text in json.dumps(message.get("content"))
                       for message in body["messages"]), body
            assert any(message.get("role") == "assistant"
                       and "RECOVERY_ACK_" in json.dumps(message.get("content"))
                       and old_text in json.dumps(message.get("content"))
                       for message in body["messages"]), body


@pytest.mark.platforms("posix")
@pytest.mark.parametrize(
    ("mode", "projectless"),
    [pytest.param("work", False, id="work"), pytest.param("code", False, id="code-project"),
     pytest.param("code", True, id="code-projectless")],
)
def test_native_history_sync_continues_original_execution_after_gateway_restart(
    tmp_path, request, history_model, mode, projectless,
):
    binary = request.getfixturevalue("codex_test_binary") if mode == "code" else None
    root = Path(__file__).resolve().parents[4]
    base = tmp_path.resolve()
    source, desktop, user, project = (base / name for name in ("legacy", "desktop", "user", "project"))
    owner = {"platform_origin": "http://127.0.0.1", "user_id": "history-owner"}
    digest = hashlib.sha256(json.dumps(list(owner.values()), separators=(",", ":")).encode()).hexdigest()
    target = desktop / "account-workspaces" / digest / "home"
    for home in (source, target, user, project):
        home.mkdir(mode=0o700, parents=True)
    model = "history-selected-model"
    endpoint = f"http://127.0.0.1:{history_model.server_port}/v1"
    for home, default in ((source, "legacy-default-model"), (target, "changed-current-default")):
        config = {
            "gateway": {"multiplex_profiles": False},
            "model": {"provider": "custom", "default": default, "base_url": endpoint,
                      "api_mode": "chat_completions",
                      "api_key": "legacy-private-fixture" if home == source else "current-private-fixture",
                      **({"codex_bin": binary} if binary else {})},
            "auxiliary": {"title_generation": {"enabled": False}},
            "security": {"allow_lazy_installs": False},
            "platform_toolsets": {"cli": []},
        }
        (home / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
        (home / ".env").write_text("OPENAI_API_KEY=loopback-history-fixture\n", encoding="utf-8")
        # Keep boot-time plugin discovery offline and prevent a late catalog cache write.
        (home / "cache").mkdir()
        (home / "cache/plugin-catalog.json").write_text(json.dumps({"entries": [], "removed": []}))
    env = child_env()
    env.update(
        HOME=str(user), USERPROFILE=str(user), HERMES_HOME=str(source),
        HERMES_RUNTIME_DIR=str(base / "runtime"), PYTHONPATH=str(root), PYTHONUNBUFFERED="1",
        OPENAI_API_KEY="loopback-history-fixture", OPENAI_BASE_URL=endpoint, TIRITH_ENABLED="false",
    )
    first, second, third = "Remember amber before sync", "Continue after sync", "Continue after restart"

    async def original(desc):
        async with websocket(source, desc) as ws:
            created = await rpc(
                ws, "session.create", source="gui", request_id="original-history-session",
                execution_mode=mode, model=model, provider="custom", base_url=endpoint, toolsets=[],
                api_key="legacy-private-fixture",
                **({} if projectless else {"cwd": str(project), "cwd_explicit": True}),
            )
            assert "result" in created, created
            sid = created["result"]["session_id"]
            cwd = source / "code/workspaces" / sid if projectless else project
            snapshot = await _resume(ws, sid)
            _assert_binding(snapshot, sid, mode, model, cwd)
            offset = len(history_model.requests)
            snapshot = await _send(ws, source, sid, "before-sync", first)
            _assert_binding(snapshot, sid, mode, model, cwd)
            _assert_provider_history(history_model, offset, model, first, [])
            return sid, cwd

    with daemon(root, source, env, barrier=False) as (process, desc):
        sid, original_cwd = asyncio.run(original(desc))
        process.send_signal(signal.SIGINT)
        process.wait(timeout=30)
    # Stamp the current account exactly as the desktop does, after the real source turn.
    with open_persistence(profile_scope(home=source)) as store:
        store.sessions.patch_model_config(sid, {"platform_owner": owner})
        thread_id = store.sessions.get_model_config_value(sid, "codex_thread_id")
    artifact = original_cwd / "nested" / "retained.txt"
    artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact.write_text("Work produced before history sync", encoding="utf-8")
    source_rollouts = list((source / "code/sessions").rglob(f"*{thread_id}.jsonl")) if mode == "code" else []
    if mode == "code":
        assert thread_id, _session_config(source, sid)
        assert source_rollouts, list((source / "code").rglob("*.jsonl"))
        assert first in source_rollouts[0].read_text(encoding="utf-8")
    assert history_model.authorizations and set(history_model.authorizations) == {"Bearer legacy-private-fixture"}
    history_model.authorizations.clear()
    before = _file_hashes(source)
    env["HERMES_HOME"] = str(target)
    recovery = {"source_home": str(source), "target_home": str(target), "user_data": str(desktop),
                "owner": owner, "confirm_unowned": False}
    inspected = _native_helper(root, env, {**recovery, "action": "inspect"})
    assert inspected["owned"] == 1 and inspected["foreign"] == 0, inspected
    recovery["plan_id"] = inspected["planId"]
    prepared = _native_helper(root, env, {**recovery, "action": "prepare"})
    rows = [row for group in prepared["groups"] for batch in group["batches"] for row in batch]
    assert [row["id"] for row in rows] == [sid], prepared
    assert rows[0]["model_config"].get("execution_mode") == mode, rows
    assert rows[0]["model_config"].get("cwd") == str(original_cwd), rows
    assert rows[0]["model"] == model, rows
    _native_helper(root, env, {**recovery, "action": "backup", "profile": "default"})
    runtime = _native_helper(root, env, {
        **recovery, "action": "runtime", "profile": "default", "session_ids": [sid],
    })
    rows = runtime["sessions"]
    assert isinstance(rows, list) and all(isinstance(row, dict) for row in rows), runtime
    assert [row["id"] for row in rows] == [sid], runtime
    assert rows[0]["model_config"]["execution_mode"] == mode, rows
    cwd = target / "code/workspaces" / sid if projectless else project
    assert rows[0]["model_config"]["cwd"] == str(cwd), rows
    if projectless:
        assert not rows[0].get("cwd"), rows
    if mode == "code":
        assert rows[0]["model_config"]["codex_thread_id"] == thread_id, rows
        for source_rollout in source_rollouts:
            copied = target / source_rollout.relative_to(source)
            records = [json.loads(line) for line in copied.read_text(encoding="utf-8").splitlines()]
            metadata = next(record["payload"] for record in records if record["type"] == "session_meta")
            assert metadata["id"] == thread_id
            assert metadata["cwd"] == str(cwd)
            assert first in copied.read_text(encoding="utf-8")
    assert (cwd / "nested/retained.txt").read_text(encoding="utf-8") == "Work produced before history sync"
    _assert_source_unchanged(source, before)

    async def continue_history(desc, text, input_id, previous):
        async with websocket(target, desc) as ws:
            snapshot = await _resume(ws, sid)
            _assert_binding(snapshot, sid, mode, model, cwd)
            for old_text in previous:
                assert any(message.get("role") == "assistant"
                           and "RECOVERY_ACK_" in str(message.get("content"))
                           and old_text in str(message.get("content"))
                           for message in snapshot["messages"]), snapshot
            offset = len(history_model.requests)
            snapshot = await _send(ws, target, sid, input_id, text)
            _assert_binding(snapshot, sid, mode, model, cwd)
            _assert_provider_history(history_model, offset, model, text, previous)
            if mode == "code":
                assert _session_config(target, sid)["codex_thread_id"] == thread_id
            return snapshot

    with daemon(root, target, env, barrier=False) as (process, desc):
        with httpx.Client(base_url=desc["api_origin"], trust_env=False, timeout=30) as client:
            imported = client.post(
                "/api/sessions/import", headers=headers(ticket(target, desc)),
                json={"request_id": "native-history-sync", "expected_revision": rows[0].get("_recovery_revision", 0),
                      "restore_execution": True, "sessions": rows},
            )
            assert imported.status_code == 200, imported.text
            assert imported.json()["ok"] is True, imported.text
        asyncio.run(continue_history(desc, second, "after-sync", [first]))
        instance, epoch = desc["instance_id"], desc["authority_epoch"]
        process.send_signal(signal.SIGINT)
        process.wait(timeout=30)
    with daemon(root, target, env, barrier=False) as (process, desc):
        assert desc["instance_id"] != instance
        assert desc["authority_epoch"] > epoch
        asyncio.run(continue_history(desc, third, "after-restart", [first, second]))
        process.send_signal(signal.SIGINT)
        process.wait(timeout=30)
    _assert_source_unchanged(source, before)
    assert artifact.read_text(encoding="utf-8") == "Work produced before history sync"
    assert history_model.authorizations and set(history_model.authorizations) == {"Bearer current-private-fixture"}

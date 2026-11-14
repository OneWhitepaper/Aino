"""Recover group messages as visible, read-only history without reviving old work."""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

from gateway import hosted_rooms as rooms
from hermes_state import SessionDB


def _seed_group(db_path, room_id="room-1", name="创作讨论"):
    rooms.create_room(db_path, room_id=room_id, name=name,
                      members=[{"profile": "writer", "handle": "writer", "display_name": "写作机器人"}],
                      authority_gateway_id="gateway-a", now=10)
    for event_id, kind, actor, payload in [
        ("question", "message.user", {"kind": "user", "id": "desktop-user", "display_name": "小张"},
         {"text": "请给我一个方案"}),
        ("running", "turn.started", {"kind": "gateway", "id": "gateway-a"},
         {"task_id": "must-not-resume", "credential": "must-not-copy"}),
        ("answer", "message.member", {"kind": "member", "id": "writer", "profile": "writer", "display_name": "写作机器人"},
         {"text": "这是讨论结果"}),
    ]:
        rooms.append_event(db_path, room_id=room_id, event_id=event_id, kind=kind, actor=actor,
                           payload=payload, authority_gateway_id="gateway-a", authority_epoch=1, now=11)


def _request(tmp_path):
    owner = {"platform_origin": "https://api.aino.test", "user_id": "10"}
    user_data = tmp_path / "desktop"
    key = hashlib.sha256(json.dumps(list(owner.values()), separators=(",", ":")).encode()).hexdigest()
    return {"action": "inspect", "source_home": str(tmp_path / "legacy"), "owner": owner,
            "user_data": str(user_data), "target_home": str(user_data / "account-workspaces" / key / "home")}


def test_projects_only_speaker_messages_as_visible_read_only_history(tmp_path):
    from hermes_cli.desktop_history_recovery_groups import project_group_history

    home = tmp_path / "legacy"
    home.mkdir()
    db = SessionDB(db_path=home / "state.db")
    _seed_group(db.db_path)
    before = hashlib.sha256(db.db_path.read_bytes()).hexdigest()
    try:
        projected = project_group_history(db, home)
        assert projected == project_group_history(db, home)
        assert len(projected) == 1
        archive = projected[0]
        assert archive["source"] == "import" and archive["hidden"] == 0
        assert archive["title"] == "群聊历史 · 创作讨论"
        assert [message["role"] for message in archive["messages"]] == ["user", "assistant"]
        assert "小张" in archive["messages"][0]["content"]
        assert "写作机器人" in archive["messages"][1]["content"]
        assert "这是讨论结果" in archive["messages"][1]["content"]
        assert "must-not-copy" not in json.dumps(projected)
        assert "must-not-resume" not in json.dumps(projected)
        assert hashlib.sha256(db.db_path.read_bytes()).hexdigest() == before
        target = SessionDB(db_path=tmp_path / "target.db")
        try:
            assert target.import_sessions(projected)["ok"]
            assert [row["id"] for row in target.list_sessions_rich()] == [archive["id"]]
            assert target.get_session(archive["id"])["source"] == "import"
        finally:
            target.close()
    finally:
        db.close()


def test_shared_store_is_snapshotted_with_stable_identity_and_original_data_preserved(tmp_path):
    from hermes_cli.desktop_history_recovery_groups import project_group_history, project_shared_group_history

    home = tmp_path / "legacy"
    home.mkdir()
    db = SessionDB(db_path=home / "state.db")
    _seed_group(db.db_path)
    _seed_group(home / "shared-state.db")
    before = (home / "shared-state.db").read_bytes()
    destination = tmp_path / "shared-snapshot.db"
    try:
        projected = project_shared_group_history(home, destination)
        assert projected == project_group_history(db, home)
        assert (home / "shared-state.db").read_bytes() == before
        assert not destination.exists()
    finally:
        db.close()


def test_unknown_group_history_requires_confirmation_and_does_not_reappear_after_restore(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    source = Path(request["source_home"])
    source.mkdir()
    _seed_group(source / "shared-state.db")
    inspected = run(request)
    assert inspected["owned"] == 0 and inspected["unowned"] == 1
    prepare = {**request, "action": "prepare", "plan_id": inspected["planId"]}
    assert not run(prepare)["groups"]
    prepared = run({**prepare, "confirm_unowned": True})
    sessions = [row for group in prepared["groups"] for batch in group["batches"] for row in batch]
    assert len(sessions) == 1
    target_home = Path(request["target_home"])
    target_home.mkdir(parents=True, exist_ok=True)
    target = SessionDB(db_path=target_home / "state.db")
    try:
        assert target.import_sessions(sessions)["ok"]
        assert target.export_all(include_inactive=True)[0]["messages"][1]["content"].endswith("这是讨论结果")
    finally:
        target.close()
    again = run(request)
    assert again["owned"] == 0 and again["unowned"] == 0 and again["conflicts"] == 0
    assert not run({**prepare, "confirm_unowned": True})["groups"]


def test_large_group_history_splits_without_truncating_messages(tmp_path):
    from hermes_cli.desktop_history_recovery_groups import project_group_history

    home = tmp_path / "legacy"
    home.mkdir()
    db = SessionDB(db_path=home / "state.db")
    _seed_group(db.db_path)
    count = SessionDB._IMPORT_MAX_MESSAGES_PER_SESSION + 1
    with sqlite3.connect(db.db_path) as connection:
        connection.execute("DELETE FROM hosted_room_events")
        connection.executemany("""INSERT INTO hosted_room_events
            (room_id,seq,event_id,kind,actor_json,authority_epoch,payload_json,created_at)
            VALUES ('room-1',?,?,'message.user',?,1,?,11)""",
            [(number + 1, f"event-{number}", json.dumps({"kind": "user", "id": "user"}),
              json.dumps({"text": f"Message {number}"})) for number in range(count)])
    try:
        projected = project_group_history(db, home)
        assert len(projected) >= 2
        assert sum(len(row["messages"]) for row in projected) == count
        assert len({message["message_uid"] for row in projected for message in row["messages"]}) == count
        assert all(len(row["messages"]) <= SessionDB._IMPORT_MAX_MESSAGES_PER_SESSION for row in projected)
        assert not db._validate_import_payload(projected)[1]
    finally:
        db.close()


def test_imported_group_archive_is_visible_in_native_sidebar_and_remains_read_only(tmp_path):
    import asyncio
    import httpx
    from hermes_cli.desktop_history_recovery import run
    from tests.gateway.fixtures.local_recovery_probe import child_env, daemon, rpc, websocket
    from tests.gateway.test_native_http_auth import headers, ticket

    request = _request(tmp_path)
    source = Path(request["source_home"])
    source.mkdir()
    _seed_group(source / "shared-state.db")
    inspected = run(request)
    prepared = run({**request, "action": "prepare", "plan_id": inspected["planId"], "confirm_unowned": True})
    sessions = prepared["groups"][0]["batches"][0]
    target = Path(request["target_home"])
    target.mkdir(parents=True, exist_ok=True)
    db = SessionDB(db_path=target / "state.db")
    db.close()
    (target / "config.yaml").write_text(json.dumps({
        "gateway": {"multiplex_profiles": False},
        "model": {"provider": "custom", "default": "offline", "base_url": "http://127.0.0.1:1/v1"},
        "auxiliary": {"title_generation": {"enabled": False}},
    }))
    root = Path(__file__).resolve().parents[2]
    user = tmp_path / "osuser"
    user.mkdir()
    env = child_env()
    env.update(HOME=str(user), USERPROFILE=str(user), HERMES_HOME=str(target), PYTHONPATH=str(root))
    with daemon(root, target, env, barrier=False) as (_process, descriptor), httpx.Client(
            base_url=descriptor["api_origin"], trust_env=False, timeout=30) as client:
        receipt = client.post("/api/sessions/import", json={"request_id": "archive-import", "expected_revision": 0,
            "sessions": sessions}, headers=headers(ticket(target, descriptor)))
        assert receipt.status_code == 200, receipt.text
        sidebar = client.get("/api/profiles/sessions/sidebar?recents_profile=default",
                             headers=headers(ticket(target, descriptor)))
        assert sidebar.status_code == 200 and sessions[0]["id"] in sidebar.text, sidebar.text
        transcript = client.get(f"/api/sessions/{sessions[0]['id']}/messages", headers=headers(ticket(target, descriptor)))
        assert transcript.status_code == 200 and "这是讨论结果" in transcript.text, transcript.text

        async def open_archive():
            async with websocket(target, descriptor) as peer:
                resumed = await rpc(peer, "session.resume", session_id=sessions[0]["id"])
                assert "result" in resumed, resumed
                rejected = await rpc(peer, "prompt.submit", session_id=sessions[0]["id"],
                                     input_id="do-not-run", text="must never run")
                assert rejected.get("error", {}).get("message") == "session_read_only", rejected

        asyncio.run(open_archive())
        assert run(request)["unowned"] == 0

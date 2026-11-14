"""Account-isolated recovery of history left behind by the 0.1.5 home move."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from hermes_state import SessionDB
from hermes_state_mutation_retirement import RETIRED_PREFIX


OWNER = {"platform_origin": "https://api.aino.test", "user_id": "10"}
OTHER = {**OWNER, "user_id": "11"}


def _request(tmp_path, owner=OWNER, **changes):
    user_data = tmp_path / "desktop"
    key = hashlib.sha256(json.dumps(list(owner.values()), separators=(",", ":")).encode()).hexdigest()
    return {"action": "inspect", "source_home": str(tmp_path / "legacy"),
            "user_data": str(user_data), "target_home": str(user_data / "account-workspaces" / key / "home"),
            "owner": owner, **changes}


def _seed(home, sessions):
    home.mkdir(parents=True, exist_ok=True)
    db = SessionDB(db_path=home / "state.db")
    for item in sessions:
        item = {"messages": [{"role": "user", "content": item["id"]}], **item}
        assert db.import_sessions([item])["ok"]
    return db


def _owned(sid, owner=OWNER, **extra):
    return {"id": sid, "source": "desktop", "model_config": {"platform_owner": owner}, **extra}


def _flatten(prepared):
    return [session for group in prepared["groups"] for batch in group["batches"] for session in batch]


def test_snapshot_filters_accounts_and_preserves_source_and_compacted_turns(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    source = _seed(Path(request["source_home"]), [
        _owned("mine", archived=1, pinned=1, messages=[
            {"role": "user", "content": "old turn", "active": 0, "compacted": 1},
            {"role": "assistant", "content": "answer"}]),
        _owned("foreign", OTHER), {"id": "unknown", "source": "desktop"},
        _owned("mixed-parent"), _owned("mixed-child", OTHER, parent_session_id="mixed-parent"),
    ])
    before = source.export_all(include_inactive=True)
    digest = hashlib.sha256((Path(request["source_home"]) / "state.db").read_bytes()).hexdigest()
    try:
        inspected = run(request)
        assert (inspected["owned"], inspected["unowned"], inspected["foreign"]) == (1, 1, 3)
        prepared = run({**request, "action": "prepare", "plan_id": inspected["planId"]})
        restored = _flatten(prepared)
        assert [session["id"] for session in restored] == ["mine"]
        assert restored[0]["archived"] and restored[0]["pinned"]
        assert restored[0]["messages"][0]["active"] == 0
        assert restored[0]["messages"][0]["compacted"] == 1
        assert source.export_all(include_inactive=True) == before
        assert hashlib.sha256((Path(request["source_home"]) / "state.db").read_bytes()).hexdigest() == digest
        assert not (Path(request["target_home"]) / "state.db").exists()
    finally:
        source.close()


def test_unknown_history_requires_confirmation_and_cannot_be_claimed_by_second_account(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    _seed(Path(request["source_home"]), [{"id": "unknown", "source": "desktop"}]).close()
    inspected = run(request)
    prepare = {**request, "action": "prepare", "plan_id": inspected["planId"]}
    assert not _flatten(run(prepare))
    assert [row["id"] for row in _flatten(run({**prepare, "confirm_unowned": True}))] == ["unknown"]
    assert len(_flatten(run({**prepare, "confirm_unowned": True}))) == 1
    second = _request(tmp_path, OTHER)
    second_plan = run(second)
    assert second_plan["unowned"] == 0
    refused = run({**second, "action": "prepare", "plan_id": second_plan["planId"], "confirm_unowned": True})
    assert not _flatten(refused)
    assert refused["claimedElsewhere"] == 0
    with pytest.raises(ValueError, match="owner"):
        run({**second, "action": "prepare", "plan_id": inspected["planId"]})


def test_existing_history_tombstones_titles_and_metadata_are_preserved(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    source_home = Path(request["source_home"])
    bot = source_home / "profiles" / "writer"
    _seed(bot, [_owned("old-bot", title="Bot Chat", hidden=1)]).close()
    (bot / "profile.yaml").write_text("display_name: Writer\ndescription: Writes\nui_meta:\n  hermes-bots:\n    title: Writer\n    chat: old-bot\n")
    (bot / "SOUL.md").write_text("A helpful writer.")
    _seed(source_home, [_owned("duplicate"), _owned("deleted"), _owned("parent"),
                        _owned("child", parent_session_id="parent")]).close()
    target_home = Path(request["target_home"])
    target = _seed(target_home, [_owned("duplicate", messages=[{"role": "user", "content": "new data"}])])
    target.set_meta(RETIRED_PREFIX + "deleted", "{}")
    target.close()
    target_bot = target_home / "profiles" / "writer"
    _seed(target_bot, [_owned("new-bot", title="Bot Chat")]).close()
    (target_bot / "profile.yaml").write_text("display_name: Current Writer\n")
    inspected = run(request)
    prepared = run({**request, "action": "prepare", "plan_id": inspected["planId"]})
    rows = {row["id"]: row for row in _flatten(prepared)}
    assert "duplicate" not in rows and "deleted" not in rows
    assert inspected["conflicts"] >= 1
    assert prepared["conflicts"] >= inspected["conflicts"]
    assert rows["child"]["parent_session_id"] == "parent"
    old_bot = rows["old-bot"]
    assert old_bot["title"].startswith("Writer · recovered conversation")
    assert not old_bot["hidden"]
    backup = run({**request, "action": "backup", "plan_id": inspected["planId"], "profile": "writer"})
    assert Path(backup["backupPath"]).is_file()
    run({**request, "action": "metadata", "plan_id": inspected["planId"], "profile": "writer", "created_profile": False})
    assert (target_bot / "profile.yaml").read_text() == "display_name: Current Writer\n"


def test_batches_keep_lineages_together_and_enforce_account_paths(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    sessions = [_owned(f"ordinary-{number}") for number in range(1001)]
    sessions += [_owned("chain-root"), _owned("chain-leaf", parent_session_id="chain-root")]
    _seed(Path(request["source_home"]), sessions).close()
    inspected = run(request)
    prepared = run({**request, "action": "prepare", "plan_id": inspected["planId"]})
    batches = prepared["groups"][0]["batches"]
    assert len(_flatten(prepared)) == len(sessions)
    assert all(len(batch) <= SessionDB._IMPORT_MAX_SESSIONS for batch in batches)
    assert any([row["id"] for row in batch if row["id"].startswith("chain-")] == ["chain-root", "chain-leaf"]
               for batch in batches)
    with pytest.raises(ValueError, match="target"):
        run({**request, "target_home": str(tmp_path / "wrong")})


def test_metadata_is_restored_after_canonical_profile_creation(tmp_path, monkeypatch):
    import hermes_yaml as yaml
    from hermes_cli.desktop_history_recovery import run
    from hermes_cli.profiles import create_profile

    request = _request(tmp_path)
    source = Path(request["source_home"]) / "profiles" / "writer"
    _seed(source, [_owned("writer-history")]).close()
    (source / "profile.yaml").write_text("display_name: Writer\ndescription: Drafts prose\nui_meta:\n  hermes-bots:\n    title: Writer\n    chat: stale-pointer\n")
    (source / "SOUL.md").write_text("Original writer persona")
    (source / ".env").write_text("API_KEY=must-not-copy")
    target = Path(request["target_home"])
    target.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "osuser")
    monkeypatch.setenv("HERMES_HOME", str(target))
    inspected = run(request)
    profile = create_profile("writer", no_skills=True, description="New-profile description", soul="New-profile default")
    assert (profile / "profile.yaml").exists()
    result = run({**request, "action": "metadata", "plan_id": inspected["planId"],
                  "profile": "writer", "created_profile": True})
    assert result["applied"]
    meta = yaml.safe_load((profile / "profile.yaml").read_text())
    assert meta["display_name"] == "Writer" and meta["description"] == "Drafts prose"
    assert "chat" not in meta["ui_meta"]["hermes-bots"]
    assert (profile / "SOUL.md").read_text() == "Original writer persona"
    assert not (profile / ".env").exists() or "must-not-copy" not in (profile / ".env").read_text()


def test_recovery_batches_import_via_authenticated_rest_without_losing_new_history(tmp_path):
    import asyncio
    import httpx
    from hermes_cli.desktop_history_recovery import run
    from tests.gateway.fixtures.local_recovery_probe import child_env, daemon, rpc, websocket
    from tests.gateway.test_native_http_auth import headers, ticket

    request = _request(tmp_path)
    _seed(Path(request["source_home"]), [
        _owned("old-parent", title="Old conversation", archived=1, pinned=1),
        _owned("old-leaf", parent_session_id="old-parent", hidden=1),
        _owned("old-bot", title="Bot Chat", hidden=1,
               model_config={"platform_owner": OWNER, "follow_profile_config": True}),
    ]).close()
    target = Path(request["target_home"])
    _seed(target, [_owned("new-history", title="Current conversation")]).close()
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
    inspected = run(request)
    prepared = run({**request, "action": "prepare", "plan_id": inspected["planId"]})
    body = {"request_id": "history-recovery-" + inspected["planId"], "expected_revision": 0,
            "sessions": prepared["groups"][0]["batches"][0]}
    with daemon(root, target, env, barrier=False) as (_process, descriptor), httpx.Client(
            base_url=descriptor["api_origin"], trust_env=False, timeout=30) as client:
        assert client.post("/api/sessions/import", json=body).status_code == 401
        first = client.post("/api/sessions/import", json=body, headers=headers(ticket(target, descriptor)))
        assert first.status_code == 200, first.text
        retry = client.post("/api/sessions/import", json=body, headers=headers(ticket(target, descriptor)))
        assert retry.status_code == 200 and retry.json() == first.json(), retry.text
        snapshot = client.get("/api/sessions/old-leaf/mutation-snapshot", headers=headers(ticket(target, descriptor)))
        assert snapshot.status_code == 200, snapshot.text
        transcript = client.get("/api/sessions/old-leaf/messages", headers=headers(ticket(target, descriptor)))
        assert transcript.status_code == 200, transcript.text
        assert any(message.get("content") == "old-leaf" for message in transcript.json()["messages"]), transcript.text
        assert not _flatten(run({**request, "action": "prepare", "plan_id": inspected["planId"]}))

        async def reopen():
            runtime_ids = []
            async with websocket(target, descriptor) as peer:
                for sid in ("old-leaf", "old-bot"):
                    resumed = await rpc(peer, "session.resume", session_id=sid)
                    assert "result" in resumed, resumed
                    assert any(message.get("content") == sid for message in resumed["result"]["messages"]), resumed
                    runtime_ids.append(resumed["result"]["session_id"])
            return runtime_ids

        runtime_ids = asyncio.run(reopen())
        db = SessionDB(db_path=target / "state.db", read_only=True)
        try:
            from hermes_state_local import POLICY_PREFIX
            assert all(db.get_meta(POLICY_PREFIX + sid) is not None for sid in runtime_ids)
            assert db.get_session("new-history")["title"] == "Current conversation"
            assert db.get_session("old-parent")["archived"] and db.get_session("old-parent")["pinned"]
            assert db.get_session("old-leaf")["parent_session_id"] == "old-parent"
            assert db.get_session("old-leaf")["hidden"]
        finally:
            db.close()


@pytest.mark.platforms("posix")
def test_system_parent_aliases_are_allowed_but_profile_symlinks_are_rejected(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    actual = tmp_path / "actual"
    actual.mkdir()
    alias = tmp_path / "alias"
    alias.symlink_to(actual, target_is_directory=True)
    request = _request(alias)
    _seed(Path(request["source_home"]), [_owned("aliased-history")]).close()
    assert run(request)["owned"] == 1
    profiles = Path(request["source_home"]) / "profiles"
    profiles.mkdir()
    (profiles / "unsafe").symlink_to(actual, target_is_directory=True)
    with pytest.raises(ValueError, match="symlink"):
        run(request)


def test_old_plans_are_bounded_without_deleting_target_backups(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    _seed(Path(request["source_home"]), [_owned("old-history")]).close()
    _seed(Path(request["target_home"]), [_owned("new-history")]).close()
    original = run(request)
    backup = run({**request, "action": "backup", "plan_id": original["planId"]})
    for _ in range(4):
        run(request)
    assert Path(backup["backupPath"]).exists()
    plans = Path(request["user_data"]) / "legacy-history-recovery" / "plans"
    manifests = [json.loads(path.read_text()) for path in plans.glob("*/manifest.json")]
    assert sum(bool(plan.get("groups")) for plan in manifests) <= 3
    assert not list(plans.glob("*/source-*.db")) and not list(plans.glob("*/target-*.db"))
    with pytest.raises(ValueError, match="expired"):
        run({**request, "action": "prepare", "plan_id": original["planId"]})


def test_partial_existing_lineage_is_reported_without_detaching_children(tmp_path):
    from hermes_cli.desktop_history_recovery import run

    request = _request(tmp_path)
    source = _seed(Path(request["source_home"]), [_owned("parent"), _owned("child", parent_session_id="parent")])
    parent = source.export_session("parent", include_inactive=True)
    source.close()
    _seed(Path(request["target_home"]), [parent]).close()
    inspected = run(request)
    assert inspected["conflicts"] == 1 and inspected["pending"] == 1
    prepared = run({**request, "action": "prepare", "plan_id": inspected["planId"]})
    assert not _flatten(prepared)
    assert prepared["conflicts"] == inspected["conflicts"]

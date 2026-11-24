"""Sidebar writes follow a local reset head without renaming its retired conversation."""

import pytest

from tests.gateway.test_session_create_tier_cwd import _owner

pytestmark = pytest.mark.usefixtures("authority_cwd_in_tmp")


@pytest.mark.asyncio
async def test_sidebar_rename_and_flags_target_the_current_reset_conversation(tmp_path, monkeypatch):
    store, _, authority, connection = _owner(tmp_path / "home", monkeypatch, {"model": {"default": "fixture"}})
    try:
        created = await connection.dispatch({"id": "create", "method": "session.create", "params": {
            "request_id": "before-reset", "source": "gui", "cwd": str(tmp_path), "cwd_explicit": True,
            "model": "fixture", "toolsets": []}})
        assert "result" in created, created
        sid = created["result"]["session_id"]
        authority.persistence.sessions.set_title(sid, "previous conversation")
        reset = await connection.dispatch({"id": "reset", "method": "session.mutate", "params": {
            "session_id": sid, "request_id": "reset", "expected_revision": 0, "expected_generation": 0,
            "operation": "reset", "payload": {}}})
        assert "result" in reset, reset
        target = reset["result"]["target_session_id"]
        assert target != sid
        revision = reset["result"]["revision"]
        edited = await connection.dispatch({"id": "sidebar", "method": "session.mutate", "params": {
            "session_id": sid, "request_id": "sidebar", "expected_revision": revision,
            "operation": "sidebar", "payload": {"title": "current conversation", "pinned": True, "hidden": False}}})
        assert "result" in edited, edited
        previous = authority.persistence.sessions.get(sid)
        current = authority.persistence.sessions.get(target)
        assert current.title == "current conversation"
        assert current.pinned is True
        assert current.hidden is False
        assert previous.title == "previous conversation"
        assert previous.pinned is False
    finally:
        await connection.close()
        store.close_all_db_handles()

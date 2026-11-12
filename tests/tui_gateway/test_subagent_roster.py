"""``subagent.roster``: the sessionless, profile-scoped feed the Desktop sidebar hydrates from."""

import json
import threading
from types import SimpleNamespace

import pytest


@pytest.fixture()
def roster(monkeypatch, tmp_path):
    from hermes_state import SessionDB
    from tools import delegate_tool_registry as reg
    from tui_gateway import server

    db = SessionDB(db_path=tmp_path / "state.db")
    db.create_session("parent-a", source="tui")
    monkeypatch.setattr(server, "_get_db", lambda: db)
    monkeypatch.setattr(reg, "_active_subagents", {})
    monkeypatch.setattr(reg, "_active_subagents_lock", threading.RLock())

    def call():
        resp = server.handle_request({"jsonrpc": "2.0", "id": 1, "method": "subagent.roster", "params": {}})
        return {e["session_id"]: e for e in resp["result"]["sessions"]}

    yield reg._active_subagents, call
    db.close()


def test_roster_reports_live_children_without_an_attached_session(roster):
    """A conversation nobody has open (no live session record, no transport) still reports its running
    top-level children, so its sidebar row can light up after a reload."""
    active, call = roster
    active["c1"] = {"subagent_id": "c1", "depth": 0, "owner_agent_session_id": "parent-a", "status": "running"}
    active["c2"] = {"subagent_id": "c2", "depth": 0, "owner_agent_session_id": "parent-a", "status": "running"}
    active["g1"] = {"subagent_id": "g1", "depth": 1, "owner_agent_session_id": "child-x", "status": "running"}

    result = call()["parent-a"]
    assert result["subagents"] == 2
    assert {worker["subagent_id"] for worker in result["workers"]} == {"c1", "c2"}


def test_roster_groups_nested_workers_without_exposing_live_control_authority(roster):
    """The capsule can name real off-screen work, including nested children, but a read never
    hands out the captured transport, owner record or agent object that grants stop/steer."""
    active, call = roster
    active["c1"] = {
        "subagent_id": "c1", "depth": 0, "goal": "Inspect source", "status": "running",
        "owner_agent_session_id": "parent-a", "owner_session_id": "private-runtime",
        "owner_transport": object(), "owner_session_record": {"secret": True},
        "agent": SimpleNamespace(session_id="child-session"),
    }
    active["g1"] = {
        "subagent_id": "g1", "depth": 1, "parent_id": "c1", "goal": "Check imports",
        "owner_agent_session_id": "child-session", "status": "running", "last_tool": "read_file",
    }
    result = call()["parent-a"]
    assert result["subagents"] == 1
    workers = {worker["subagent_id"]: worker for worker in result["workers"]}
    assert workers["c1"]["child_session_id"] == "child-session"
    assert workers["g1"]["goal"] == "Check imports"
    assert workers["g1"]["last_tool"] == "read_file"
    for worker in workers.values():
        assert not {"agent", "owner_transport", "owner_session_record", "owner_session_id"} & worker.keys()
    active.clear()
    assert call() == {}


def test_roster_omits_conversations_stored_in_another_profile(roster):
    """One process serves several profiles: a child whose conversation is not in the requested
    profile's state.db is never reported, so its session id does not leak across profiles."""
    active, call = roster
    active["c1"] = {"subagent_id": "c1", "depth": 0, "owner_agent_session_id": "other-profile-sid"}

    assert json.dumps(call()) == "{}"


def test_roster_resolves_a_background_process_route_key_to_its_stored_conversation(roster, monkeypatch):
    """On the gateway path a ``terminal(background=true)`` process carries the conversation's ROUTE
    (``agent:main:local:dm:...``) as its ``session_key``, not the stored id; the roster still reports it
    under the stored conversation that route belongs to, so a background-only row lights after a reload."""
    from tools.process_registry import ProcessSession, process_registry
    from tui_gateway import server

    _, call = roster
    route = "agent:main:local:dm:desktop-chat-1"
    server._get_db().create_session("local-abc123", source="local", session_key=route)
    proc = ProcessSession(id="proc_route", command="sleep 90", session_key=route)
    monkeypatch.setattr(process_registry, "list_sessions", lambda **_: [{"session_id": proc.id}])
    monkeypatch.setattr(process_registry, "get", lambda pid: proc if pid == proc.id else None)

    assert call() == {"local-abc123": {"session_id": "local-abc123", "subagents": 0, "background": 1}}

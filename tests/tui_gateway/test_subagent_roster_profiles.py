"""``subagent.roster`` across two profiles served by one process: a background process lights only the
conversation of the profile that owns it, even when the other profile's store holds an identical route."""

import threading
import types
from pathlib import Path

import pytest

ROUTE = "agent:main:telegram:dm:42"  # unmultiplexed / legacy route: identical in every profile's store


@pytest.fixture()
def two_profiles(tmp_path, monkeypatch):
    from agent import secret_scope
    from hermes_state import SessionDB
    from tools import delegate_tool_registry as reg
    from tools.process_registry import process_registry
    from tui_gateway import launch_profile_policy, server

    launch = tmp_path / "launch-home"
    bot2 = launch / "profiles" / "bot2"
    bot2.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(launch))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(secret_scope, "_MULTIPLEX_ACTIVE", False)
    monkeypatch.setattr(launch_profile_policy, "_snapshot", None)
    monkeypatch.setattr(server, "_hermes_home", launch)
    monkeypatch.setattr(server, "_served_profile_homes", set())

    launch_db = SessionDB(db_path=launch / "state.db")
    launch_db.create_session("default-conv", source="telegram", session_key=ROUTE)
    bot2_db = SessionDB(db_path=bot2 / "state.db")
    bot2_db.create_session("bot2-legacy", source="telegram", session_key=ROUTE)
    bot2_db.create_session("bot2-conv", source="telegram", session_key="agent:bot2:telegram:dm:42")
    bot2_db.close()
    monkeypatch.setattr(server, "_get_db", lambda: launch_db)
    monkeypatch.setattr(reg, "_active_subagents", {})
    monkeypatch.setattr(reg, "_active_subagents_lock", threading.RLock())

    procs = {}
    monkeypatch.setattr(process_registry, "list_sessions", lambda **_: [{"session_id": k} for k in procs])
    monkeypatch.setattr(process_registry, "get", procs.get)

    def spawn(pid, *, parent="", key=ROUTE):
        from tools.process_registry import ProcessSession
        procs[pid] = ProcessSession(id=pid, command="sleep 90", session_key=key, parent_session_id=parent)

    def roster(profile=None):
        params = {"profile": profile} if profile else {}
        resp = server.handle_request({"jsonrpc": "2.0", "id": 1, "method": "subagent.roster", "params": params})
        return {e["session_id"]: e["background"] for e in resp["result"]["sessions"]}

    yield spawn, roster
    launch_db.close()


def test_a_stored_parent_id_is_authoritative_across_profiles(two_profiles):
    """The default profile's process names its conversation; the identical legacy route in bot2's store
    must not light bot2's row."""
    spawn, roster = two_profiles
    spawn("proc_default", parent="default-conv")

    assert roster("bot2") == {}
    assert roster() == {"default-conv": 1}
    assert roster("bot2") == {}


def test_route_fallback_is_fenced_to_the_profile_namespace(two_profiles):
    """Without a stored parent id the route decides, but only inside the requested profile's namespace:
    an unnamespaced route is the launch profile's, a namespaced one its own profile's."""
    spawn, roster = two_profiles
    spawn("proc_legacy")
    spawn("proc_bot2", key="agent:bot2:telegram:dm:42")

    assert roster("bot2") == {"bot2-conv": 1}
    assert roster() == {"default-conv": 1}


def test_native_interactive_fallback_returns_only_its_profile_worker_snapshots(two_profiles, monkeypatch):
    """The native owner's existing legacy-read fallback remains usable without attaching a
    conversation, and the ticket's home fences every worker goal and child session id."""
    from gateway.runtime_bootstrap import _PURPOSE_CAPABILITIES
    from hermes_constants import get_hermes_home
    from tools import delegate_tool_registry as reg
    from tui_gateway import server
    from tui_gateway.ws_legacy_fallback import dispatch_legacy, legacy_fallback_allowed

    reg._active_subagents.update({
        "default-worker": {"subagent_id": "default-worker", "depth": 0,
                           "owner_agent_session_id": "default-conv", "goal": "PRIVATE DEFAULT GOAL"},
        "bot-worker": {"subagent_id": "bot-worker", "depth": 0,
                       "owner_agent_session_id": "bot2-conv", "goal": "Review Bot files"},
    })
    profile_home = get_hermes_home() / "profiles" / "bot2"
    actor = types.SimpleNamespace(profile_id=str(profile_home),
                                  capabilities=frozenset(_PURPOSE_CAPABILITIES["interactive"]))
    assert legacy_fallback_allowed(actor, "subagent.roster")
    frames, done = [], threading.Event()
    transport = types.SimpleNamespace(write=lambda frame: frames.append(frame) or done.set() or True)
    reply = dispatch_legacy(server, {"jsonrpc": "2.0", "id": 7, "method": "subagent.roster", "params": {}},
                            transport, actor)
    if reply is None:
        assert done.wait(10)
        reply = frames[0]
    assert "error" not in reply
    rows = reply["result"]["sessions"]
    assert [row["session_id"] for row in rows] == ["bot2-conv"]
    assert [worker["goal"] for worker in rows[0]["workers"]] == ["Review Bot files"]

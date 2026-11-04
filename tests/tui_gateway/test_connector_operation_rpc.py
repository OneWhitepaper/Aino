"""Connector operation RPCs and events over the real dispatch path.

- ``connectors.operation.status`` reads the live operation with the same ownership checks as
  ``connectors.list`` (4000 / 4001); ``deadline_at`` is the server's, never recomputed
- ``connection.respond`` finds the op by ``op_id`` and drives target transitions; a foreign
  transport cannot
- every target transition and the settlement emit ``connection.update`` to the session
- ``pending_connection`` on resume comes from the live registry
"""

import json
import os
import threading
import time
from contextlib import ExitStack, suppress
from types import SimpleNamespace

import pytest

from tools.connectors import live
from tools.connectors.contract import Actor, TargetState
from tools.connectors.operation import ConnectionOperation, Target
from tui_gateway import server
from tui_gateway.transport import StdioTransport


class PipeClient:
    def __init__(self, stack):
        read_fd, write_fd = os.pipe()
        self.reader = stack.enter_context(os.fdopen(read_fd, "r", encoding="utf-8"))
        self.writer = os.fdopen(write_fd, "w", encoding="utf-8")
        stack.callback(lambda: suppress(BrokenPipeError) and self.writer.close())
        self.transport = StdioTransport(lambda: self.writer, threading.Lock())
        self.frames = []
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        for line in self.reader:
            self.frames.append(json.loads(line))

    def write(self, obj):
        return self.transport.write(obj)

    def close(self):
        pass

    def events(self, kind, *, expect=1):
        deadline = time.time() + 2
        while time.time() < deadline:
            found = [f["params"] for f in list(self.frames) if f.get("method") == "event" and f["params"]["type"] == kind]
            if len(found) >= expect:
                return found
            time.sleep(0.01)
        return [f["params"] for f in list(self.frames) if f.get("method") == "event" and f["params"]["type"] == kind]


SID = "op-rpc-session"


@pytest.fixture
def owned(monkeypatch):
    live.reset_for_tests()
    # A connect from the panel creates the guest identity first; in an empty test home that is a
    # real mint on the live Portal (up to 5s), which outlived the 2s reply wait on a slow Portal.
    monkeypatch.setattr("tools.connectors.ensure_guest_identity", lambda: None)
    monkeypatch.setattr("tools.connectors.managed.ensure_guest_identity", lambda: None)
    with ExitStack() as stack:
        owner, stranger = PipeClient(stack), PipeClient(stack)
        session = dict(transport=owner.transport, agent=None, session_key=SID, history=[],
                       history_lock=threading.Lock(), history_version=0, running=False, attached_images=[],
                       source="desktop")
        monkeypatch.setitem(server._sessions, SID, session)
        yield owner, stranger, session
    live.reset_for_tests()


def _rpc(client, method, **params):
    before = len(client.frames)
    response = server.dispatch({"jsonrpc": "2.0", "id": 7, "method": method,
                                "params": {"owner": {"type": "session", "session_id": SID}, **params}}, client.transport)
    if response is not None:
        return response
    deadline = time.time() + 2
    while time.time() < deadline:
        replies = [frame for frame in list(client.frames)[before:] if frame.get("id") == 7]
        if replies:
            return replies[-1]
        time.sleep(0.01)
    raise AssertionError("no reply")


def _connect_rpc(client, **params):
    """``connectors.connect`` runs on the long-handler pool and writes its reply to the transport."""
    before = len(client.frames)
    _rpc(client, "connectors.connect", **params)
    deadline = time.time() + 2
    while time.time() < deadline:
        replies = [f for f in list(client.frames)[before:] if f.get("id") == 7]
        if replies:
            return replies[-1]
        time.sleep(0.01)
    raise AssertionError("no reply")


def _open_op():
    operation = ConnectionOperation([Target("gmail", "connector", "connect"), Target("notion", "connector", "connect")],
                                    session_key=SID)
    live.open(operation)
    return operation


def test_operation_status_returns_the_live_snapshot_with_the_server_deadline(owned):
    owner, _, _ = owned
    operation = _open_op()
    operation.transition("gmail", TargetState.initiated, Actor.backend_watcher, connect_url="https://l/gmail")
    reply = _rpc(owner, "connectors.operation.status", op_id=operation.op_id)
    result = reply["result"]
    assert result["op_id"] == operation.op_id
    assert result["deadline_at"] == operation.deadline_at
    assert result["settled"] is False and result["settled_by"] is None
    by = {t["name"]: t for t in result["targets"]}
    assert by["gmail"]["state"] == "initiated" and by["gmail"]["connect_url"] == "https://l/gmail"
    assert by["notion"]["state"] == "pending"


def test_operation_status_is_owner_only_and_validates_params(owned):
    owner, stranger, _ = owned
    operation = _open_op()
    assert _rpc(stranger, "connectors.operation.status", op_id=operation.op_id)["error"]["code"] == 4001
    assert _rpc(owner, "connectors.operation.status")["error"]["code"] == 4000
    assert _rpc(owner, "connectors.operation.status", op_id="nope")["error"]["code"] == 4004


def test_respond_drives_the_live_operation_and_emits_update(owned):
    owner, stranger, _ = owned
    operation = _open_op()
    operation.transition("gmail", TargetState.initiated, Actor.backend_watcher)
    foreign = _rpc(stranger, "connection.respond", op_id=operation.op_id,
                   result={"targets": [{"name": "notion", "status": "skipped"}]})
    assert foreign["error"]["code"] == 4001
    assert operation.target("notion").state == TargetState.pending

    reply = _rpc(owner, "connection.respond", op_id=operation.op_id,
                 result={"targets": [{"name": "notion", "status": "skipped"}]})
    assert "result" in reply, reply
    assert operation.target("notion").state == TargetState.skipped
    assert operation.wake.is_set()
    updates = owner.events("connection.update", expect=2)
    assert updates and updates[-1]["payload"]["target"] == "notion"
    assert updates[-1]["payload"]["to"] == "skipped" and updates[-1]["payload"]["actor"] == "user"
    assert updates[-1]["payload"]["op_id"] == operation.op_id


def test_respond_cannot_claim_an_outcome_for_any_target(owned):
    """The card renders the operation; only skip, approve and Continue are its to say. The contract
    refuses any other claim (4002) before it reaches the operation."""
    owner, _, _ = owned
    operation = _open_op()
    operation.transition("gmail", TargetState.initiated, Actor.backend_watcher)
    reply = _rpc(owner, "connection.respond", op_id=operation.op_id,
                 result={"targets": [{"name": "gmail", "status": "connected"},
                                     {"name": "notion", "status": "failed"}]})
    assert reply["error"]["code"] == 4002, reply
    assert operation.target("gmail").state == TargetState.initiated
    assert operation.target("notion").state == TargetState.pending


def test_respond_continue_settles_and_emits_the_settlement_update(owned):
    owner, _, _ = owned
    operation = _open_op()
    reply = _rpc(owner, "connection.respond", op_id=operation.op_id, result={"settled_by": "continue"})
    assert "result" in reply
    assert operation.settled and operation.settled_by.value == "continue"
    settled = [u for u in owner.events("connection.update") if u["payload"].get("settled")]
    assert settled and settled[-1]["payload"]["settled_by"] == "continue"


def test_pending_connection_on_resume_comes_from_the_live_registry(owned):
    operation = _open_op()
    payload = server._pending_connection_request_payload(SID)
    assert payload["op_id"] == operation.op_id
    assert payload["deadline_at"] == operation.deadline_at
    live.close(operation)
    assert server._pending_connection_request_payload(SID) is None


def test_panel_connect_reissues_only_a_dead_link(owned, monkeypatch):
    """Try again re-mints a failed or expired target; a waiting target keeps the link it was minted
    with (the card reopens it), so the RPC refuses rather than spend a second mint."""
    owner, _, _ = owned
    operation = _open_op()
    operation.transition("gmail", TargetState.initiated, Actor.backend_watcher, connect_url="https://l/gmail/1")
    operation.transition("notion", TargetState.initiated, Actor.backend_watcher, connect_url="https://l/notion/1")
    operation.transition("notion", TargetState.failed, Actor.backend_watcher, detail="vendor: nope")
    mints = []

    class Client:
        def __init__(self, **_):
            pass

        def connections(self, names, *, reinitiate=False, **_):
            mints.append((tuple(names), reinitiate))
            return {"results": [{"connector": n, "status": "initiated", "connect_url": f"https://l/{n}/2"} for n in names]}

    monkeypatch.setattr("tools.connectors.gateway.client.ConnectorClient", Client)
    # The real dispatcher: availability gate passes, then the open operation routes to _reissue.
    monkeypatch.setattr("tools.connectors.connectors_available", lambda: True)
    monkeypatch.setattr("model_tools._select_tool_names", lambda *a, **k: {"manage_connections"})

    refused = _connect_rpc(owner, connectors=["gmail"])
    assert refused["error"]["code"] == 4002 and mints == []
    assert operation.target("gmail").connect_url == "https://l/gmail/1"

    reply = _connect_rpc(owner, connectors=["notion"])
    assert "result" in reply, reply
    assert mints == [(("notion",), True)]
    assert operation.target("notion").state == TargetState.initiated
    assert operation.target("notion").connect_url == "https://l/notion/2"


@pytest.mark.parametrize("dead", [TargetState.failed, TargetState.expired])
def test_a_failed_reissue_leaves_the_row_failed_with_no_link(owned, monkeypatch, dead):
    """Try again whose mint fails must not show the row as waiting on the old dead link."""
    owner, _, _ = owned
    operation = _open_op()
    operation.transition("notion", TargetState.initiated, Actor.backend_watcher, connect_url="https://l/notion/1")
    actor = Actor.clock if dead == TargetState.expired else Actor.backend_watcher
    operation.transition("notion", dead, actor, detail="vendor: nope")

    class Client:
        def __init__(self, **_):
            pass

        def connections(self, names, *, reinitiate=False, **_):
            return {"results": [{"connector": n, "status": "failed", "status_reason": "vendor: still no"} for n in names]}

    monkeypatch.setattr("tools.connectors.gateway.client.ConnectorClient", Client)
    monkeypatch.setattr("tools.connectors.connectors_available", lambda: True)
    monkeypatch.setattr("model_tools._select_tool_names", lambda *a, **k: {"manage_connections"})

    before = len(owner.frames)
    _rpc(owner, "connectors.connect", connectors=["notion"])
    deadline = time.time() + 2
    while time.time() < deadline and not [f for f in list(owner.frames)[before:] if f.get("id") == 7]:
        time.sleep(0.01)
    target = operation.target("notion")
    assert target.state == TargetState.failed
    assert target.connect_url is None
    assert target.detail == "vendor: still no"


@pytest.mark.parametrize("tool_enabled", [True, False])
def test_local_mcp_retry_needs_session_tools_but_no_hosted_service(owned, tmp_path, tool_enabled):
    from hermes_constants import get_hermes_home
    from tools.connectors import mcp

    owner, stranger, session = owned
    profile = tmp_path / "mcp-profile"
    profile.mkdir()
    (profile / "config.yaml").write_text("tools:\n  connectors:\n    enabled: false\n", encoding="utf-8")
    session.update(profile_home=str(profile), agent=SimpleNamespace(
        enabled_toolsets=["connections"] if tool_enabled else [], disabled_toolsets=[]))
    homes = []

    class Backend:
        def start_oauth(self, name):
            homes.append(get_hermes_home())
            if len(homes) == 1:
                raise RuntimeError("authorization failed")
            return SimpleNamespace(auth_url=f"https://auth.example/{name}/retry")

    operation = ConnectionOperation([Target("custom", "mcp", "authorize")], session_key=SID)
    runner = mcp.open_runner("authorize", Backend())
    try:
        with server._session_profile_runtime_scope(session):
            live.open(operation)
            runner.prepare(operation)
        assert operation.target("custom").state == TargetState.failed
        assert _connect_rpc(stranger, connectors=["custom"], reconnect=True)["error"]["code"] == 4001
        reply = _connect_rpc(owner, connectors=["custom"], reconnect=True)
        if not tool_enabled:
            assert reply["error"]["code"] == 4031, reply
            assert operation.target("custom").state == TargetState.failed
            assert homes == [profile]
            return
        assert "result" in reply, reply
        target = reply["result"]["targets"][0]
        assert target["state"] == "initiated"
        assert target["connect_url"] == "https://auth.example/custom/retry"
        assert homes == [profile, profile]
        wrong_account = _connect_rpc(owner, connectors=["custom"], alias="foreign", reconnect=True)
        assert wrong_account["error"]["code"] == 4004, wrong_account
        assert len(homes) == 2
    finally:
        runner.work.clear()
        runner.close()


@pytest.mark.parametrize("names", [["notion"], ["local", "notion"], ["local", "missing"]])
def test_retry_cannot_use_local_targets_to_bypass_hosted_policy(owned, tmp_path, names):
    owner, _, session = owned
    profile = tmp_path / "hosted-disabled"
    profile.mkdir()
    (profile / "config.yaml").write_text("tools:\n  connectors:\n    enabled: false\n", encoding="utf-8")
    session.update(profile_home=str(profile), agent=SimpleNamespace(
        enabled_toolsets=["connections"], disabled_toolsets=[]))
    operation = _open_op()
    operation.targets.append(Target("local", "mcp", "authorize", state=TargetState.failed))
    operation.transition("notion", TargetState.failed, Actor.backend_watcher)
    reply = _connect_rpc(owner, connectors=names, reconnect=True)
    assert reply["error"]["code"] == 4031, reply
    assert reply["error"]["data"]["reason"] == "CONNECTORS_UNAVAILABLE"
    assert operation.target("notion").state == TargetState.failed
    assert operation.target("local").state == TargetState.failed


@pytest.mark.parametrize("kind", ["plugin", "skill"])
def test_local_catalog_retry_installs_without_hosted_services(owned, tmp_path, kind):
    from tools.connectors import catalog
    from tests.waiting import wait_until

    owner, _, session = owned
    profile = tmp_path / "catalog-profile"
    profile.mkdir()
    (profile / "config.yaml").write_text("tools:\n  connectors:\n    enabled: false\n", encoding="utf-8")
    session.update(profile_home=str(profile), agent=SimpleNamespace(
        enabled_toolsets=["connections"], disabled_toolsets=[]))
    installed = profile / "installed"

    class Installer:
        def plugin_entry(self, name):
            return SimpleNamespace(name=name, repo="https://example.com/plugin", sha="a" * 40,
                                   description="Local plugin", tier="community", requires_hermes="",
                                   platforms=[], subdir="", capabilities=SimpleNamespace(requires_env=[]))

        def refuse(self, entry):
            return None

        def skill_meta(self, name):
            return {"name": name, "identifier": name, "source": "community"}

        def install_plugin(self, name, **options):
            installed.write_text(name, encoding="utf-8")
            return {"ok": True}

        def install_skill(self, name, **options):
            installed.write_text(name, encoding="utf-8")
            return {"name": name, "already_installed": False}

    operation = ConnectionOperation([Target("local", kind, "install", state=TargetState.failed)], session_key=SID)
    with server._session_profile_runtime_scope(session):
        runner = catalog.open_runner(Installer())
        live.open(operation)
        runner.prepare(operation)
    try:
        reply = _connect_rpc(owner, connectors=["local"], reconnect=True)
        assert "result" in reply, reply
        work = wait_until(lambda: runner.work.get("local"))
        assert work.done.wait(5)
        runner.observe(operation)
        status = _rpc(owner, "connectors.operation.status", op_id=operation.op_id)
        assert status["result"]["targets"][0]["state"] == "connected", status
        assert installed.read_text(encoding="utf-8") == "local"
    finally:
        runner.close()

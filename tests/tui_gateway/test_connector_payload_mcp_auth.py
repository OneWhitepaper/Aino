"""MCP review auth modes survive UI projection without exposing credential fields."""

from types import SimpleNamespace

import pytest

from tools.connectors.contract import Actor, TargetState
from tools.connectors.operation import ConnectionOperation, Target
from tui_gateway.connector_payload import connector_ui_payload


@pytest.mark.parametrize("auth", ["oauth", "none"])
def test_connection_snapshot_redaction_preserves_only_mcp_auth_mode(auth):
    payload = {"targets": [{"kind": "mcp", "mcp_config": {"auth": auth},
                             "auth": "opaque-auth-secret", "credentials": "opaque-credential"}],
               "other": {"mcp_config": {"auth": "opaque-nested-secret"}},
               "mcp_config": {"auth": "opaque-root-secret"}}
    projected = connector_ui_payload(payload)
    assert projected["targets"][0]["mcp_config"]["auth"] == auth
    assert projected["targets"][0]["auth"] == "[REDACTED]"
    assert projected["targets"][0]["credentials"] == "[REDACTED]"
    assert projected["other"]["mcp_config"]["auth"] == "[REDACTED]"
    assert projected["mcp_config"]["auth"] == "[REDACTED]"


def test_arbitrary_custom_auth_value_is_still_redacted():
    payload = {"targets": [{"kind": "mcp", "mcp_config": {"auth": "oauth-credential"}}]}
    assert connector_ui_payload(payload)["targets"][0]["mcp_config"]["auth"] == "[REDACTED]"


def test_native_connection_update_status_and_resume_keep_the_reviewed_auth(monkeypatch):
    from gateway import local_desktop_ui, local_viewer_events, session_connections
    from tools.connectors import live
    from hermes_constants import get_hermes_home

    monkeypatch.setattr(local_desktop_ui, "_turns", {})
    monkeypatch.setattr(local_desktop_ui, "_process_routes", {})
    monkeypatch.setattr(ConnectionOperation, "on_change", None)
    monkeypatch.setattr(live, "_open", {})
    updates = []
    stream = SimpleNamespace(publish=lambda sid, payload, **kwargs: updates.append(payload))
    authority = SimpleNamespace(sessions={"native": SimpleNamespace(
        event_stream=stream, route="agent:main:local:dm:auth-review")}, profile_id=str(get_hermes_home()))
    turn = SimpleNamespace(_ctx=SimpleNamespace(session_id="phys", session_key="agent:main:local:dm:auth-review"),
                           _approval_owner=(authority, "native", 1),
                           _publish_execution=lambda *_: True)
    agent = SimpleNamespace(_interrupt_requested=False)
    sinks = local_viewer_events.wire(turn, agent)
    operation = ConnectionOperation([Target("example", "mcp", "install", mcp_config={
        "url": "https://mcp.example.test/mcp", "auth": "oauth"})], session_key=turn._ctx.session_key)
    try:
        live.open(operation)
        operation.transition("example", TargetState.initiated, Actor.backend_watcher)
        status = session_connections._view(operation)
        resume = session_connections.pending_connection(authority, "native")
        for payload in (updates[-1], status, resume):
            assert payload["targets"][0]["mcp_config"]["auth"] == "oauth"
    finally:
        live.close(operation)
        local_viewer_events.restore(agent, sinks)

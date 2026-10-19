"""First-run onboarding uses the ordinary managed session lease before its hidden opening."""

from pathlib import Path
from datetime import datetime, timedelta, UTC
from unittest.mock import patch

from agent.onboarding_flow import Facts
from tests.tui_gateway import test_managed_model_agent as managed_model_fixture
from tests.tui_gateway.test_managed_model_agent import result
from tui_gateway import server
from tui_gateway.managed_model_runtime import get_registry

managed_gateway = managed_model_fixture.managed_gateway


def test_onboarding_waits_for_the_existing_managed_binding(managed_gateway, monkeypatch):
    rig = managed_gateway
    monkeypatch.setattr(server, "_hermes_home", str(Path(rig.db.db_path).parent))
    monkeypatch.setattr("agent.onboarding_facts.read_facts", lambda **kw: Facts(os="macos"))
    claims, submitted = [], []
    monkeypatch.setattr("hermes_cli.welcome_trial.claim_desktop_free_tier", lambda **kw: claims.append(kw))

    def submit(rid, params):
        submitted.append(params)
        return {"result": {"status": "streaming"}}

    monkeypatch.setitem(server._methods, "prompt.submit", submit)
    # The lease points at this same local HTTP service; no public model or account service is used.
    owner = {"user_id": "user-one"}
    # The origin is filled from the fixture's local provider, preserving the real bind validation.
    from hermes_cli.config import read_user_config_raw
    config = read_user_config_raw(Path(rig.db.db_path).parent / "config.yaml")
    owner["platform_origin"] = config["custom_providers"][0]["base_url"].removesuffix("/v1")
    selected = {"model_source": "aino", "model_id": "fixture-a", "platform_owner": owner}
    first = result(rig.call("onboarding.start", **selected))
    sid, stored = first["session_id"], first["stored_session_id"]
    rig.sessions.append(sid)
    assert first["managed_model_pending"] is True
    assert not claims and not submitted and not rig.requests
    assert rig.db.get_session_model_config_value(stored, "model_source") == "aino"
    assert rig.db.get_session_model_config_value(stored, "platform_owner") == owner
    assert result(rig.call("onboarding.start", **selected))["managed_model_pending"] is True
    assert not submitted

    # A disappeared runtime is not permission to submit against the profile's ambient provider.
    with monkeypatch.context() as absent:
        absent.setitem(server._methods, "session.resume", lambda rid, params: {"result": {"session_id": "missing"}})
        assert result(rig.call("onboarding.start", **selected))["managed_model_pending"] is True
    assert not submitted
    changed = {**selected, "model_id": "fixture-b"}
    assert "error" in rig.call("onboarding.start", **changed)
    assert not submitted

    rig.bind(sid)
    bound = result(rig.call("onboarding.start", **selected))
    assert bound["session_id"] == sid and not bound.get("managed_model_pending")
    assert len(submitted) == 1 and submitted[0]["display_kind"] == "hidden"
    assert not claims
    registry = get_registry()
    class ExpiredClock:
        @staticmethod
        def now(_tz=None):
            return datetime.now(UTC) + timedelta(hours=2)
    with patch("tui_gateway.managed_model_runtime.datetime", ExpiredClock):
        assert result(rig.call("onboarding.start", **selected))["managed_model_pending"] is True
    registry.clear_session(sid)
    assert result(rig.call("onboarding.start", **selected))["managed_model_pending"] is True
    assert len(submitted) == 1


def test_onboarding_rejects_missing_managed_identity_before_any_claim(managed_gateway, monkeypatch):
    rig = managed_gateway
    claims = []
    monkeypatch.setattr("hermes_cli.welcome_trial.claim_desktop_free_tier", lambda **kw: claims.append(kw))
    refused = rig.call("onboarding.start", model_source="aino", model_id="fixture-a")
    assert refused["error"]["code"] == 4002
    assert not claims and not rig.requests


def test_bound_onboarding_opening_reaches_only_the_selected_local_model(managed_gateway, monkeypatch):
    """Real onboarding.start → resume → prompt.submit → AIAgent/SDK; only the desktop name answer is simulated."""
    from hermes_cli.config import read_user_config_raw
    from tui_gateway import server_requests

    rig = managed_gateway
    home = Path(rig.db.db_path).parent
    monkeypatch.setattr(server, "_hermes_home", str(home))
    monkeypatch.setattr("agent.onboarding_facts.read_facts", lambda **kw: Facts(os="macos", locale="en"))
    claims, cards = [], []
    monkeypatch.setattr("hermes_cli.welcome_trial.claim_desktop_free_tier", lambda **kw: claims.append(kw))

    def answer_name(frame):
        cards.append(frame["params"])
        assert frame["method"] == "setup_beat" and frame["params"]["beat"] == "name"
        assert server_requests.resolve_response({
            "jsonrpc": "2.0", "id": frame["id"], "result": {"answer": {"name": "Local User"}},
        })
        return True

    monkeypatch.setattr(server_requests, "_answerable", lambda _sid: True)
    monkeypatch.setattr(server_requests, "_write", answer_name)
    config = read_user_config_raw(home / "config.yaml")
    origin = config["custom_providers"][0]["base_url"].removesuffix("/v1")
    selected = {"model_source": "aino", "model_id": "fixture-a", "platform_owner": {
        "platform_origin": origin, "user_id": "user-one"}}
    started = result(rig.call("onboarding.start", **selected))
    sid = started["session_id"]
    rig.sessions.append(sid)
    assert started["managed_model_pending"] is True and not rig.requests and not cards

    rig.bind(sid)
    opened = result(rig.call("onboarding.start", **selected))
    assert opened["session_id"] == sid and not opened.get("managed_model_pending")
    # Deferred startup hands the first worker off to the actual turn worker, as ordinary submit does.
    for _ in range(2):
        with server._sessions_lock:
            worker = server._sessions[sid]["_run_thread"]
        worker.join(timeout=30)
        assert not worker.is_alive(), "managed onboarding opening did not complete"
    session = server._sessions[sid]
    assert not session.get("agent_error") and not session["running"]
    assert len(cards) == 1 and not claims
    assert rig.requests
    assert all(path == "/v1/chat/completions" and auth == "Bearer fixture-secret-one"
               and body["model"] == "fixture-upstream" for path, auth, body in rig.requests)
    assert any(message.get("role") == "user" and "first-run onboarding" in str(message.get("content"))
               for message in rig.requests[0][2]["messages"])
    rows = rig.db.get_messages_as_conversation(started["stored_session_id"])
    assert any(row.get("role") == "assistant" and row.get("content") == "Local model finished." for row in rows)

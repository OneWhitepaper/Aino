"""Exercise managed bindings through the actual session/transport dispatcher."""
import json
from datetime import datetime, timedelta, UTC

import pytest

import tui_gateway.server as srv
from tui_gateway.managed_model_runtime import get_registry


class Peer:
    def __init__(self, user="gateway-user", read_only=False):
        self.auth_identity = {"provider": "fixture", "user_id": user, "read_only": read_only}

    def write(self, value):
        return True


@pytest.fixture
def rig(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    owner, controller, stranger = Peer(), Peer(), Peer("stranger")
    sessions = []

    def call(peer, method, **params):
        return srv.dispatch({"id": 1, "method": method, "params": params}, peer)

    def create(source="desktop", **extra):
        sid = result(call(owner, "session.create", source=source, cwd=str(tmp_path), **extra))["session_id"]
        sessions.append(sid)
        return sid

    try:
        yield call, create, owner, controller, stranger, tmp_path
    finally:
        for sid in sessions:
            with srv._sessions_lock:
                srv._pop_session_by_id(sid)


def result(response):
    assert "error" not in response, response
    return response["result"]


def prepare(call, sid, owner, controller):
    identity = {"platform_origin": "https://fixture.invalid", "user_id": "platform-user"}
    params = {"session_id": sid, "owner": identity, "model_id": "fixture-model"}
    ticket = result(call(owner, "session.managed_model_ticket", **params))["session_ticket"]
    claim = result(call(controller, "session.claim_managed_model", **params, session_ticket=ticket))
    return {
        **params, "binding_revision": claim["binding_revision"], "api_mode": "chat_completions",
        "model": "fixture-upstream", "capabilities": {"tools": True, "vision": False, "reasoning": False},
        "credential_id": "fixture-credential", "api_key": "test-secret-never-persist",
        "base_url": "https://fixture.invalid/v1",
        "expires_at": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
    }, ticket


def test_owned_delegation_rejects_strangers_replay_and_wrong_scope(rig):
    call, create, owner, controller, stranger, _ = rig
    sid = create()
    params, ticket = prepare(call, sid, owner, controller)
    for peer, method, extra in (
        (stranger, "session.bind_managed_model", {}),
        (controller, "session.bind_managed_model", {"profile": "missing-profile"}),
        (controller, "session.bind_managed_model", {"owner": {**params["owner"], "user_id": "other"}}),
        (controller, "session.bind_managed_model", {"expires_at": datetime.now(UTC).isoformat()}),
        (controller, "session.claim_managed_model", {"session_ticket": ticket}),
    ):
        assert "error" in call(peer, method, **(params | extra))
    response = result(call(controller, "session.bind_managed_model", **params))
    binding = get_registry().get(sid, srv._sessions[sid])
    assert binding.api_key == params["api_key"]
    assert params["api_key"] not in repr(binding) + json.dumps(response)
    assert "error" in call(stranger, "session.clear_managed_model", session_id=sid,
                           binding_revision=params["binding_revision"])
    assert "error" in call(stranger, "session.managed_model_ticket", **params)
    for peer, session_id in ((Peer(read_only=True), sid), (owner, create("cli"))):
        assert "error" in call(peer, "session.managed_model_ticket", **(params | {"session_id": session_id}))


def test_unpersisted_managed_session_resume_retains_selected_model(rig):
    from queue import Queue

    call, create, owner, _, _, _ = rig
    sid = create(model_source="aino", model_id="fixture-model")
    session = srv._sessions[sid]
    responses = Queue()
    owner.write = responses.put
    response = call(owner, "session.resume", session_id=session["session_key"], omit_messages=True)
    if response is None:
        response = responses.get(timeout=10)
    resumed = result(response)
    assert resumed["session_id"] == sid
    assert resumed["info"]["model_source"] == session["managed_model_params"]["model_source"]
    assert resumed["info"]["model_id"] == session["managed_model_params"]["model_id"]
    assert resumed["info"]["model_status"] == "awaiting_managed_credentials"
    assert session["agent"] is None


def test_shared_ordinary_session_selects_one_managed_authority(rig, monkeypatch):
    from pathlib import Path
    from queue import Queue

    call, create, owner, controller, stranger, home = rig
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.setattr(srv, "_schedule_agent_build", lambda sid: None)
    sid = create()
    session = srv._sessions[sid]
    responses = Queue()
    for peer in (controller, stranger):
        peer.write = responses.put
        response = call(peer, "session.resume", session_id=session["session_key"], omit_messages=True)
        if response is None:
            response = responses.get(timeout=10)
            while response.get("id") != 1:
                response = responses.get(timeout=10)
        assert result(response)["session_id"] == sid
    assert all(srv._session_transport_contains(session, peer) for peer in (owner, controller, stranger))

    result(call(owner, "config.set", session_id=sid, key="model", value="fixture-model", model_source="aino"))
    assert session["transport"] is owner
    assert set(session.get("viewers", {})) <= {owner}
    params, _ = prepare(call, sid, owner, controller)
    result(call(controller, "session.bind_managed_model", **params))
    assert get_registry().get(sid, session).owner.user_id == params["owner"]["user_id"]
    for peer in (controller, stranger):
        assert "error" in call(peer, "session.managed_model_ticket", **params)
        assert "error" in call(peer, "config.set", session_id=sid, key="model",
                               value="fixture-other", model_source="aino")
    assert "error" in call(stranger, "prompt.submit", session_id=sid, text="foreign prompt")
    assert session["transport"] is owner


def test_shared_ordinary_model_options_authorizes_members_after_viewer_leaves(rig, monkeypatch):
    from pathlib import Path
    from queue import Queue

    call, create, owner, viewer, stranger, home = rig
    monkeypatch.setattr(Path, "home", lambda: home)
    monkeypatch.setattr(srv, "_schedule_agent_build", lambda sid: None)
    monkeypatch.setattr("hermes_cli.model_switch.list_authenticated_providers", lambda **kwargs: [])
    sid = create()
    session = srv._sessions[sid]
    responses = Queue()
    for peer in (owner, viewer, stranger):
        peer.write = responses.put

    def request(peer, method, **params):
        response = call(peer, method, **params)
        if response is None:
            response = responses.get(timeout=10)
            while response.get("id") != 1:
                response = responses.get(timeout=10)
        return response

    result(request(viewer, "session.resume", session_id=session["session_key"], omit_messages=True))
    params = {"session_id": sid, "include_session_info": True}
    expected = result(request(owner, "model.options", **params))["session_info"]
    assert result(request(viewer, "model.options", **params))["session_info"] == expected
    assert request(stranger, "model.options", **params)["error"]["code"] == 4403
    srv._close_sessions_for_transport(viewer)
    assert result(request(owner, "model.options", **params))["session_info"] == expected
    assert request(viewer, "model.options", **params)["error"]["code"] == 4403


def test_renewal_keeps_active_binding_until_replaced_and_stale_clear_cannot_remove_it(rig):
    call, create, owner, controller, _, home = rig
    sid = create()
    first, _ = prepare(call, sid, owner, controller)
    result(call(controller, "session.bind_managed_model", **first))
    previous = get_registry().get(sid)
    second, _ = prepare(call, sid, owner, controller)
    assert get_registry().get(sid) is previous
    assert "error" in call(controller, "session.bind_managed_model", **first)
    result(call(controller, "session.bind_managed_model", **second))
    assert result(call(controller, "session.clear_managed_model", session_id=sid,
                       binding_revision=first["binding_revision"]))["cleared"] is False
    assert get_registry().get(sid).binding_revision == second["binding_revision"]
    get_registry().disconnect(controller)
    assert get_registry().get(sid) is None
    for path in home.rglob("*"):
        if path.is_file():
            assert first["api_key"].encode() not in path.read_bytes()


def test_claim_requires_same_gateway_principal_and_live_session_identity(rig):
    call, create, owner, controller, stranger, _ = rig
    sid = create()
    params = {"session_id": sid, "owner": {"platform_origin": "https://fixture.invalid", "user_id": "platform-user"},
              "model_id": "fixture-model"}
    ticket = result(call(owner, "session.managed_model_ticket", **params))["session_ticket"]
    assert "error" in call(stranger, "session.claim_managed_model", **params, session_ticket=ticket)
    old = srv._sessions[sid]
    srv._sessions[sid] = dict(old)
    assert "error" in call(controller, "session.claim_managed_model", **params, session_ticket=ticket)
    srv._sessions[sid] = old
    result(call(controller, "session.claim_managed_model", **params, session_ticket=ticket))
    with srv._sessions_lock:
        srv._pop_session_by_id(sid)
    assert get_registry().get(sid) is None
    assert "error" in call(controller, "session.claim_managed_model", **params, session_ticket=ticket)


def test_expiry_revokes_active_call_and_close_cleans_binding(rig, monkeypatch):
    import tui_gateway.managed_model_runtime as runtime
    call, create, owner, controller, stranger, _ = rig
    sid = create()
    params, _ = prepare(call, sid, owner, controller)
    result(call(controller, "session.bind_managed_model", **params))
    for peer, extra in ((stranger, {}), (owner, {}), (controller, {"model": "different-model"}),
                        (controller, {"binding_revision": params["binding_revision"] + 1})):
        assert "error" in call(peer, "session.renew_managed_model", **(params | extra))
    session = srv._sessions[sid]
    session["running"] = True
    cancelled = []
    monkeypatch.setattr(srv, "_interrupt_session_turn", lambda sid, sess: cancelled.append((sid, sess)))
    class FutureDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.now(tz) + timedelta(hours=2)
    monkeypatch.setattr(runtime, "datetime", FutureDatetime)
    assert get_registry().get(sid) is None
    assert cancelled == [(sid, session)]
    session["running"] = False


def test_model_options_reads_staged_and_bound_truth_without_activating_or_building(rig, monkeypatch):
    from queue import Queue

    call, create, owner, controller, stranger, home = rig
    sid = create(model_source="aino", model_id="fixture-initial")
    session = srv._sessions[sid]
    history = session["history"]
    monkeypatch.setattr("hermes_cli.inventory.build_model_options_payload", lambda *a, **kw: {"providers": []})
    responses = Queue()
    owner.write = responses.put
    stranger.write = responses.put

    def options(peer=owner, **extra):
        response = srv.dispatch({"id": 771, "method": "model.options", "params": {
            "session_id": sid, "include_session_info": True, **extra}}, peer)
        if response is not None:
            return response
        while True:
            response = responses.get(timeout=10)
            if response.get("id") == 771:
                return response

    result(call(owner, "config.set", session_id=sid, key="model", value="fixture-model", model_source="aino"))
    staged = result(options())
    assert staged["session_info"]["model_id"] == "fixture-model"
    assert staged["session_info"]["model_status"] == "awaiting_managed_credentials"
    assert "error" in options(stranger)
    params, _ = prepare(call, sid, owner, controller)
    rejected = call(controller, "session.bind_managed_model", **(params | {"model_id": "other-model"}))
    assert "error" in rejected
    assert result(options())["session_info"]["model_status"] == "awaiting_managed_credentials"
    result(call(controller, "session.bind_managed_model", **params))
    ready = result(options())
    assert ready["session_info"]["model_status"] == "ready"
    assert ready["session_info"]["platform_owner"] == params["owner"]
    assert params["api_key"] not in json.dumps(ready)
    assert "session_info" not in result(options(include_session_info=False))
    assert session["agent"] is None and session["history"] is history
    assert session["transport"] is owner

    byok_secret = "fixture-byok-secret"
    (home / "config.yaml").write_text(json.dumps({"custom_providers": [{
        "name": "fixture-byok", "base_url": "http://127.0.0.1:9/v1", "api_key": byok_secret,
        "models": ["fixture-byok-model"], "api_mode": "chat_completions",
    }]}))
    result(call(owner, "config.set", session_id=sid, key="model",
                value="fixture-byok-model --provider fixture-byok --session", confirm_expensive_model=True))
    override = session["model_override"]
    assert override["provider"] == "custom:fixture-byok"
    custom = result(options())["session_info"]
    assert (custom["provider"], custom["model"]) == (override["provider"], override["model"])
    assert not custom.get("model_source") and not custom.get("platform_owner")
    assert byok_secret not in json.dumps(custom) and "base_url" not in custom
    assert "error" in call(controller, "session.clear_managed_model", session_id=sid, binding_revision=0)
    assert result(options())["session_info"] == custom
    result(call(controller, "session.clear_managed_model", session_id=sid, binding_revision=params["binding_revision"]))
    assert result(options())["session_info"] == custom
    assert session["agent"] is None and session["history"] is history
    assert session["transport"] is owner

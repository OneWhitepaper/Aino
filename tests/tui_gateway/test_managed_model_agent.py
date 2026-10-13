"""Managed sessions use the real Agent and SDK against a loopback-only model."""

import json
import threading
from datetime import datetime, timedelta, UTC
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

import tui_gateway.server as srv
from hermes_state import SessionDB
from tui_gateway.managed_model_runtime import get_registry


class Peer:
    auth_identity = {"provider": "fixture", "user_id": "gateway-user"}

    def __init__(self):
        self.events = []
        self.condition = threading.Condition()

    def write(self, value):
        with self.condition:
            self.events.append(value)
            self.condition.notify_all()
        return True


def result(response):
    assert "error" not in response, response
    return response["result"]


@pytest.fixture
def managed_gateway(tmp_path, monkeypatch):
    requests = []
    request_headers = []
    response_status = {}
    response_usage = {}
    request_condition = threading.Condition()
    hold, entered, release = threading.Event(), threading.Event(), threading.Event()

    class Model(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/api/show":
                self.send_response(404)
                self.end_headers()
                return
            with request_condition:
                requests.append((self.path, self.headers.get("Authorization"), body))
                request_headers.append(dict(self.headers))
                request_condition.notify_all()
            if status := response_status.get(self.headers.get("Authorization")):
                status, code = status if isinstance(status, tuple) else (status, None)
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                error = ({"code": code, "message": "fixture refusal"} if code else {
                    "error": {"message": "fixture refusal", "type": "api_error",
                              "code": "upstream_auth_failed" if status == 401 else "insufficient_balance"}})
                self.wfile.write(json.dumps(error).encode())
                return
            if hold.is_set():
                entered.set()
                if not release.wait(timeout=5):
                    return
            if self.path in {"/v1/messages", "/v1/responses"}:
                from tests.tui_gateway.managed_protocol_fixture import events_for
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for event in events_for(self.path, body, tmp_path / "sample.txt"):
                    self.wfile.write(("event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n").encode())
                return
            has_result = not body.get("tools") or any(m.get("role") == "tool" for m in body["messages"])
            tool_call = {"id": "call-fixture", "type": "function", "function": {
                "name": "read_file", "arguments": json.dumps({"path": str(tmp_path / "sample.txt")})}}
            delta = {"content": "Local model finished."} if has_result else {
                "tool_calls": [{"index": 0, **tool_call}]}
            finish = "stop" if has_result else "tool_calls"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream" if body.get("stream") else "application/json")
            self.end_headers()
            if body.get("stream"):
                for data in ({"choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                             {"choices": [{"index": 0, "delta": {}, "finish_reason": finish}],
                              **({"usage": response_usage} if response_usage else {})}):
                    self.wfile.write(("data: " + json.dumps({"id": "fixture", "object": "chat.completion.chunk",
                        "created": 1, "model": body["model"], **data}) + "\n\n").encode())
                self.wfile.write(b"data: [DONE]\n\n")
            else:
                self.wfile.write(json.dumps({"id": "fixture", "object": "chat.completion", "created": 1,
                    "model": body["model"], "choices": [{"index": 0, "finish_reason": finish, "message": {
                        "role": "assistant", **({"content": "Local model finished."} if has_result else {
                            "content": None, "tool_calls": [tool_call]})}}],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 3, "total_tokens": 13}}).encode())

    # Actual config/file I/O lives inside the test home. No paid provider or credentials.
    (tmp_path / "sample.txt").write_text("fixture file content")
    (tmp_path / "config.yaml").write_text("model:\n  default: unused-byok\nagent:\n  max_turns: 4\n"
                                         "auxiliary:\n  title_generation:\n    enabled: false\n")
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_IGNORE_RULES", "1")
    db = SessionDB(tmp_path / "state.db")
    monkeypatch.setattr(srv, "_get_db", lambda: db)
    # Keep unrelated desktop/MCP integrations out of this protocol contract.
    monkeypatch.setattr(srv, "_load_enabled_toolsets", lambda platform=None: ["file"])
    monkeypatch.setattr(srv, "_start_session_services", lambda *args: None)
    monkeypatch.setattr(srv, "_schedule_mcp_late_refresh", lambda *args: None)
    http = ThreadingHTTPServer(("127.0.0.1", 0), Model)
    worker = threading.Thread(target=http.serve_forever, daemon=True)
    worker.start()
    origin = f"http://127.0.0.1:{http.server_port}"
    with (tmp_path / "config.yaml").open("a") as config:
        config.write(f"custom_providers:\n  - name: fixture-byok\n    base_url: {origin}/v1\n"
                     "    api_key: byok-fixture-key\n    model: fixture-byok-model\n")
    chat, controller = Peer(), Peer()
    sessions = []

    class Rig:
        request_id = 0
        protocol = "chat_completions"
        profile = ""

        def call(self, method, peer=chat, **params):
            if self.profile:
                params.setdefault("profile", self.profile)
            self.request_id += 1
            rid = self.request_id
            response = srv.dispatch({"id": rid, "method": method, "params": params}, peer)
            if response is not None:
                return response
            with peer.condition:
                assert peer.condition.wait_for(lambda: any(e.get("id") == rid for e in peer.events), timeout=10)
                return next(e for e in peer.events if e.get("id") == rid)

        def create(self):
            draft = result(self.call("session.create", source="desktop", cwd=str(tmp_path),
                                     model_source="aino", model_id="fixture-a"))
            sessions.append(draft["session_id"])
            return draft

        def bind(self, sid, key="fixture-secret-one", owner_id="user-one", model_id="fixture-a", vision=False,
                 context_window=None):
            params = {"session_id": sid, "model_id": model_id, "owner": {
                "platform_origin": origin, "user_id": owner_id}}
            ticket = result(self.call("session.managed_model_ticket", **params))["session_ticket"]
            revision = result(self.call("session.claim_managed_model", peer=controller,
                session_ticket=ticket, **params))["binding_revision"]
            payload = {**params, "binding_revision": revision, "api_key": key, "credential_id": "lease",
                "base_url": origin + "/v1", "model": "fixture-upstream" if model_id == "fixture-a" else "fixture-other",
                "api_mode": self.protocol,
                "context_window": context_window,
                "capabilities": {"tools": True, "vision": vision, "reasoning": False},
                "expires_at": (datetime.now(UTC) + timedelta(minutes=50)).isoformat()}
            result(self.call("session.bind_managed_model", peer=controller, **payload))
            return payload

        def submit(self, sid, text):
            response = result(self.call("prompt.submit", session_id=sid, text=text))
            assert response["status"] == "streaming"
            with srv._sessions_lock:
                thread = srv._sessions[sid]["_run_thread"]
            thread.join(timeout=20)
            assert not thread.is_alive(), "managed turn exceeded 20s"
            # The deferred-build waiter hands off to the actual turn worker.
            with srv._sessions_lock:
                thread = srv._sessions[sid]["_run_thread"]
            thread.join(timeout=20)
            assert not thread.is_alive(), "managed turn exceeded 20s"
            assert not srv._sessions[sid].get("agent_error")

    rig = Rig()
    rig.requests, rig.db, rig.chat, rig.controller, rig.sessions = requests, db, chat, controller, sessions
    rig.request_headers = request_headers
    rig.response_status = response_status
    rig.response_usage = response_usage
    rig.request_condition = request_condition
    rig.hold, rig.entered, rig.release = hold, entered, release
    try:
        yield rig
    finally:
        release.set()
        for sid in sessions:
            with srv._sessions_lock:
                session = srv._pop_session_by_id(sid)
            if session:
                srv._teardown_popped_session(session, end_reason="test")
        http.shutdown()
        http.server_close()
        worker.join(timeout=3)
        db.close()


@pytest.mark.parametrize("protocol,path", [("chat_completions", "/v1/chat/completions"),
    ("anthropic_messages", "/v1/messages"), ("responses", "/v1/responses")])
def test_managed_draft_runs_tool_roundtrip_and_renews_without_rebuilding(managed_gateway, tmp_path, protocol, path):
    f = managed_gateway
    f.protocol = protocol
    draft = f.create()
    sid = draft["session_id"]
    assert draft["info"]["model_status"] == "awaiting_managed_credentials"
    srv._start_agent_build(sid, srv._sessions[sid])
    assert srv._sessions[sid]["agent"] is None
    refused = f.call("prompt.submit", session_id=sid, text="not sent")
    assert refused["error"]["data"]["reason"] == "awaiting_managed_credentials"
    assert not f.requests
    assert f.db.get_session(draft["stored_session_id"]) is None
    lease = f.bind(sid)
    f.submit(sid, "Read sample.txt")
    session = srv._sessions[sid]
    agent = session["agent"]
    assert agent.provider == "aino"
    assert len(f.requests) >= 2
    assert all(endpoint == path and auth == "Bearer fixture-secret-one" for endpoint, auth, _ in f.requests)
    assert "fixture file content" in json.dumps(f.requests[1][2])
    history, tools = json.dumps(session["history"]), json.dumps(agent.tools)
    def system_prompt(body):
        return body.get("system") or body.get("instructions") or body["messages"][0]
    prompt = system_prompt(f.requests[-1][2])
    renewed = {**lease, "api_key": "fixture-secret-two",
               "expires_at": (datetime.now(UTC) + timedelta(minutes=55)).isoformat()}
    result(f.call("session.renew_managed_model", peer=f.controller, **renewed))
    assert session["agent"] is agent
    assert json.dumps(session["history"]) == history
    assert json.dumps(agent.tools) == tools
    f.submit(sid, "Continue")
    assert f.requests[-1][1] == "Bearer fixture-secret-two"
    assert system_prompt(f.requests[-1][2]) == prompt
    row = f.db.get_session(draft["stored_session_id"])
    metadata = json.loads(row["model_config"])
    assert metadata["model_source"] == "aino"
    assert metadata["platform_owner"] == lease["owner"]
    get_registry().disconnect(f.controller)
    count = len(f.requests)
    assert "error" in f.call("prompt.submit", session_id=sid, text="must not be sent")
    assert len(f.requests) == count
    for path in tmp_path.rglob("*"):
        if path.is_file():
            assert b"fixture-secret-" not in path.read_bytes()


@pytest.mark.parametrize("mode", [{}, {"lazy": True}, {"defer_history": True}, {"eager_build": True}])
def test_managed_history_never_falls_back_or_accepts_another_owner(managed_gateway, mode):
    f = managed_gateway
    draft = f.create()
    sid = draft["session_id"]
    lease = f.bind(sid)
    f.submit(sid, "Read sample.txt")
    result(f.call("session.close", session_id=sid))
    resumed = result(f.call("session.resume", session_id=draft["stored_session_id"], source="desktop", **mode))
    sid = resumed["session_id"]
    f.sessions.append(sid)
    assert resumed["info"]["model_status"] == "awaiting_managed_credentials"
    assert resumed["info"]["platform_owner"] == lease["owner"]
    assert "error" in f.call("prompt.submit", session_id=sid, text="not yet")
    other = {"session_id": sid, "model_id": "fixture-a", "owner": {**lease["owner"], "user_id": "user-two"}}
    assert "error" in f.call("session.managed_model_ticket", **other)
    f.bind(sid)
    f.submit(sid, "Continue the same conversation")
    assert f.requests[-1][2]["model"] == lease["model"]
    assert any(m.get("role") == "tool" for m in f.requests[-1][2]["messages"])


def test_managed_context_anchor_survives_reasoning_change_and_cold_resume(managed_gateway):
    from agent.usage_anchor import USAGE_ANCHOR_MODEL_CONFIG_KEY, anchored_context_tokens

    f = managed_gateway
    f.response_usage.update(prompt_tokens=1_000, completion_tokens=30, total_tokens=1_030)
    draft = f.create()
    sid, key = draft["session_id"], draft["stored_session_id"]
    f.bind(sid, context_window=372_000)
    f.submit(sid, "Read sample.txt")
    session = srv._sessions[sid]
    agent = session["agent"]
    anchor = f.db.get_session_model_config_value(key, USAGE_ANCHOR_MODEL_CONFIG_KEY)
    assert anchor is not None
    before = (agent._cached_system_prompt, json.dumps(session["history"]), json.dumps(agent.tools))

    result(f.call("config.set", session_id=sid, key="reasoning", value="high"))
    assert f.db.get_session_model_config_value(key, USAGE_ANCHOR_MODEL_CONFIG_KEY) == anchor
    assert (agent._cached_system_prompt, json.dumps(session["history"]), json.dumps(agent.tools)) == before
    requests_before_resume = len(f.requests)
    result(f.call("session.close", session_id=sid))
    resumed = result(f.call("session.resume", session_id=key, source="desktop", lazy=True))
    cold_sid = resumed["session_id"]
    f.sessions.append(cold_sid)
    cold_session = srv._sessions[cold_sid]
    assert cold_session["agent"] is None
    assert get_registry().get(cold_sid) is None
    expected = anchored_context_tokens(cold_session["history"], anchor)
    assert expected is not None and expected > 0
    usage = result(f.call("session.context_breakdown", session_id=cold_sid))
    assert usage["context_used"] == expected
    assert usage["context_source"] == "provider_usage"
    assert len(f.requests) == requests_before_resume


def test_branch_keeps_platform_identity_without_copying_authority(managed_gateway):
    f = managed_gateway
    sid = f.create()["session_id"]
    lease = f.bind(sid)
    f.submit(sid, "Read sample.txt")
    branch = result(f.call("session.branch", session_id=sid, name="Fixture branch"))
    child = branch["session_id"]
    f.sessions.append(child)
    assert branch["info"]["model_status"] == "awaiting_managed_credentials"
    assert branch["info"]["platform_owner"] == lease["owner"]
    assert get_registry().get(child) is None
    assert "error" in f.call("prompt.submit", session_id=child, text="not bound")
    f.bind(child)
    f.submit(child, "Continue this branch")
    row = f.db.get_session(branch["stored_session_id"])
    assert json.loads(row["model_config"])["platform_owner"] == lease["owner"]
    for extra, expected_source in (({}, "aino"), ({"model": "fixture-byok-model", "provider": "custom:fixture-byok"}, None)):
        seeded = result(f.call("session.create", source="desktop", parent_session_id=srv._sessions[sid]["session_key"],
            messages=[{"role": "user", "content": "seed"}, {"role": "assistant", "content": "reply"}], **extra))
        f.sessions.append(seeded["session_id"])
        row = f.db.get_session(seeded["stored_session_id"])
        assert json.loads(row["model_config"]).get("model_source") == expected_source


def test_explicit_byok_switch_releases_platform_authority_and_persists_new_source(managed_gateway):
    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid)
    f.submit(sid, "Read sample.txt")
    value = "fixture-byok-model --provider custom:fixture-byok --session"
    result(f.call("config.set", session_id=sid, key="model", value=value, confirm_expensive_model=True))
    assert get_registry().get(sid) is None
    session = srv._sessions[sid]
    assert not session.get("managed_model_params")
    assert not getattr(session["agent"], "_managed_model_metadata", None)
    f.submit(sid, "Continue using my model")
    assert f.requests[-1][1] == "Bearer byok-fixture-key"
    row = f.db.get_session(session["session_key"])
    assert json.loads(row["model_config"]).get("model_source") != "aino"
    unbound = f.create()["session_id"]
    result(f.call("config.set", session_id=unbound, key="model", value=value, confirm_expensive_model=True))
    assert not srv._sessions[unbound].get("managed_model_params")
    f.submit(unbound, "Continue without a platform lease")
    assert f.requests[-1][1] == "Bearer byok-fixture-key"


def test_cancellation_does_not_replay_a_paid_platform_request(managed_gateway):
    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid)
    f.hold.set()
    result(f.call("prompt.submit", session_id=sid, text="Read sample.txt"))
    assert f.entered.wait(timeout=10)
    result(f.call("session.interrupt", session_id=sid))
    f.release.set()
    with srv._sessions_lock:
        thread = srv._sessions[sid]["_run_thread"]
    thread.join(timeout=10)
    assert not thread.is_alive()
    assert len(f.requests) == 1
    assert not srv._sessions[sid]["running"]


def test_managed_model_switch_requires_confirmation_then_new_owned_binding(managed_gateway):
    f = managed_gateway
    sid = f.create()["session_id"]
    original = f.bind(sid)
    f.submit(sid, "Read sample.txt")
    selection = dict(session_id=sid, key="model", value="fixture-b", model_source="aino")
    confirmation = result(f.call("config.set", **selection))
    assert confirmation["confirm_required"] is True
    assert get_registry().get(sid).model_id == original["model_id"]
    result(f.call("config.set", **selection, confirm_expensive_model=True))
    assert "error" in f.call("prompt.submit", session_id=sid, text="not yet")
    f.bind(sid, model_id="fixture-b", key="fixture-secret-new-model")
    agent = srv._sessions[sid]["agent"]
    f.submit(sid, "Continue with the selected model")
    assert f.requests[-1][2]["model"] == "fixture-other"
    assert f.requests[-1][1] == "Bearer fixture-secret-new-model"
    assert agent.provider == "aino"
    row = f.db.get_session(srv._sessions[sid]["session_key"])
    assert json.loads(row["model_config"])["model_id"] == "fixture-b"
    assert "error" in f.call("session.renew_managed_model", peer=f.controller, **original)


def test_bound_context_owns_parent_child_switch_and_renewal_without_changing_prompt(managed_gateway):
    from agent.model_metadata import save_context_length
    from tools.delegate_tool import _build_child_agent

    f = managed_gateway
    sid = f.create()["session_id"]
    lease = f.bind(sid, context_window=372_000)
    cold = result(f.call("session.context_breakdown", session_id=sid))
    assert cold["context_max"] == lease["context_window"]
    assert cold["model"] == lease["model"]
    assert cold["context_source"] == "unknown"
    # An older generic cache must not override the authenticated catalog, even for the same route.
    save_context_length(lease["model"], lease["base_url"], 1_000_000)
    f.submit(sid, "Read sample.txt")
    session = srv._sessions[sid]
    agent = session["agent"]
    assert agent.context_compressor.context_length == lease["context_window"]
    child = _build_child_agent(0, "Review fixture", None, ["file"], None, 3, 1, agent)
    try:
        assert child.context_compressor.context_length == lease["context_window"]
        before = (agent._cached_system_prompt, json.dumps(session["history"]), json.dumps(agent.tools))
        renewed = {**lease, "context_window": 248_000,
                   "expires_at": (datetime.now(UTC) + timedelta(minutes=55)).isoformat()}
        result(f.call("session.renew_managed_model", peer=f.controller, **renewed))
        assert agent.context_compressor.context_length == renewed["context_window"]
        assert child.context_compressor.context_length == renewed["context_window"]
        assert (agent._cached_system_prompt, json.dumps(session["history"]), json.dumps(agent.tools)) == before

        other_sid = f.create()["session_id"]
        other_lease = f.bind(other_sid, context_window=196_000)
        f.submit(other_sid, "Read sample.txt")
        assert srv._sessions[other_sid]["agent"].context_compressor.context_length == other_lease["context_window"]
        assert agent.context_compressor.context_length == renewed["context_window"]
        assert child.context_compressor.context_length == renewed["context_window"]

        result(f.call("config.set", session_id=sid, key="model", value="fixture-b", model_source="aino",
                      confirm_expensive_model=True))
        switched = f.bind(sid, model_id="fixture-b", context_window=128_000)
        assert agent.context_compressor.context_length == switched["context_window"]
    finally:
        with agent._active_children_lock:
            agent._active_children.remove(child)
        child.close()


def test_named_profile_build_and_reset_keep_the_platform_runtime(managed_gateway, tmp_path):
    from hermes_cli.profiles import get_profile_dir
    f = managed_gateway
    f.profile = "managed-fixture"
    profile = get_profile_dir(f.profile)
    assert profile.is_relative_to(tmp_path)
    profile.mkdir(parents=True)
    (profile / "config.yaml").write_text((tmp_path / "config.yaml").read_text())
    draft = f.create()
    sid = draft["session_id"]
    f.bind(sid)
    f.submit(sid, "Read sample.txt")
    session = srv._sessions[sid]
    assert session["profile_home"] == str(profile)
    assert f.db.get_session(draft["stored_session_id"]) is None
    assert session["agent"]._session_db.get_session(draft["stored_session_id"])
    old = session["agent"]
    info = srv._reset_session_agent(sid, session)
    assert info["provider"] == "aino"
    assert session["agent"] is not old
    assert session["agent"].api_key() == "fixture-secret-one"
    assert session["history"] == []
    old.close()

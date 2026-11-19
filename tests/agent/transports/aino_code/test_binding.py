"""Code sessions use Aino's selected route without borrowing a Codex login."""

import asyncio
import json
import re
import threading
import tomllib
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest
import httpx

from agent import codex_runtime
from agent.transports import codex_app_server_session
from agent.auxiliary_billing_scope import BillingScope, ManagedCredential, billing_scope
from agent.runtime_scope import bind_profile_scope
from agent.secret_scope import get_secret
from agent.transports.aino_code.binding import CodeModelBinding
from agent.transports.codex_app_server import CodexAppServerClient
from agent.transports.codex_app_server_session import CodexAppServerSession
from hermes_constants import get_hermes_home
from hermes_cli.runtime_provider import resolve_runtime_provider
from hermes_cli.web_models import CustomEndpointUpdate
from hermes_cli.web_routers.config_env import upsert_custom_endpoint, validate_custom_endpoint
from hermes_state import SessionDB
from run_agent import AIAgent


class RecordingClient:
    def __init__(self, **kwargs):
        self.spawn = kwargs
        self.requests = []

    def initialize(self, **_kwargs):
        return {}

    def request(self, method, params=None, timeout=None):
        self.requests.append((method, params))
        return {"thread": {"id": "code-thread"}}

    def close(self):
        pass


def code_agent(**overrides):
    values = dict(execution_mode="code", api_mode="codex_responses", provider="aino",
                  model="vendor/model-900k", base_url="http://127.0.0.1:9911/v1",
                  api_key="real-provider-fixture-secret", session_id="code-session",
                  session_cwd="/tmp", _codex_session=None, _client_kwargs={},
                  tool_progress_callback=None, _cached_system_prompt="Hermes-only tool instructions")
    return SimpleNamespace(**(values | overrides))


def selected_provider(client):
    config = tomllib.loads("\n".join(client.spawn["extra_args"][1::2]))
    return config["model_providers"][config["model_provider"]]


def test_code_initialization_failure_returns_an_actionable_turn_result():
    agent = code_agent(api_mode="images_generations")
    result = codex_runtime.run_codex_app_server_turn(
        agent, user_message="hello", original_user_message="hello", messages=[],
        should_review_memory=False, effective_task_id="code-session", turn_id="incompatible-model")
    assert result["completed"] is False and result["api_calls"] == 0
    assert "supports Responses" in result["final_response"]
    assert "Code mode" in result["final_response"]
    assert agent._codex_session is None


@pytest.mark.parametrize('projectless', [False, True])
def test_code_uses_private_home_and_selected_route_without_exposing_provider_key(monkeypatch, projectless):
    clients = []

    def factory(**kwargs):
        client = RecordingClient(**kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(codex_app_server_session, "CodexAppServerClient", factory)
    workspace = get_hermes_home() / 'code' / 'workspaces' / 'fixture'
    agent = code_agent(**({'session_cwd': str(workspace)} if projectless else {}))
    try:
        codex_runtime._ensure_codex_session(agent)
        agent._codex_session.ensure_started()
        client = clients[0]
        assert client.spawn["codex_home"] == str(get_hermes_home() / "code")
        start = next(params for method, params in client.requests if method == "thread/start")
        assert start["model"] == "vendor/model-900k"
        provider = selected_provider(client)
        config = tomllib.loads('\n'.join(client.spawn['extra_args'][1::2]))
        if projectless:
            assert config['project_root_markers'] == []
        else:
            assert 'project_root_markers' not in config
        assert provider["requires_openai_auth"] is False
        assert provider["wire_api"] == "responses"
        assert provider["base_url"].startswith("http://127.0.0.1:")
        assert "developerInstructions" not in start
        assert "real-provider-fixture-secret" not in json.dumps(client.spawn | {"requests": client.requests})
        assert not (get_hermes_home() / "code" / "auth.json").exists()
        assert not (get_hermes_home() / "code" / "config.toml").exists()
    finally:
        codex_runtime._close_codex_session(agent)


@pytest.fixture
def upstream():
    requests = []
    settings = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            data = json.dumps({"data": [{"id": "gpt-5.4"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append({"headers": dict(self.headers), "body": body, "path": self.path})
            if self.path.startswith("http://"):
                self.send_response(502)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if body.get("input") == "reject-and-echo" or settings.get("error"):
                payload = json.dumps({"error": {"message": dict(self.headers)}}).encode()
                self.send_response(settings.get("error", 401))
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("X-Request-ID", "fixture-request-401")
                self.end_headers()
                self.wfile.write(payload)
                return
            if self.path == "/v1/chat/completions" and settings.get("chat_reply"):
                frame = {"choices": [{"index": 0, "delta": {"content": "fixture bridged reply"}, "finish_reason": "stop"}]}
                self.write_sse(f"data: {json.dumps(frame)}\n\ndata: [DONE]\n\n")
                return
            message = {"id": "msg-fixture", "type": "message", "role": "assistant", "status": "completed",
                       "phase": "final_answer", "content": [{"type": "output_text", "text": "fixture reply", "annotations": []}]}
            outputs = [item.get('output', '') for item in body.get('input', [])
                       if isinstance(item, dict) and item.get('type') == 'function_call_output']
            running = re.search(r'Process running with session ID (\d+)', str(outputs[-1])) if outputs else None
            command = None
            if settings.get('workflow') and running:
                message = {'id': f'fc-fixture-{len(requests)}', 'type': 'function_call',
                           'call_id': f'call-fixture-{len(requests)}', 'name': 'write_stdin',
                           'arguments': json.dumps({'session_id': int(running[1]), 'chars': '', 'yield_time_ms': 1000})}
            elif self.path == '/v1/responses' and settings.get('commands'):
                command = settings['commands'].pop(0)
            elif settings.get("coding") and self.path == "/v1/responses" and not settings.get("code_sent"):
                settings["code_sent"] = True
                command = "printf code-fixture > fixture.txt"
            if command is not None:
                names = {tool.get("name") for tool in body.get("tools", [])}
                variants = {
                    "exec_command": {"cmd": command, "yield_time_ms": 1000},
                    "shell_command": {"command": command},
                    "shell": {"command": ["/bin/sh", "-c", command]},
                }
                name = next((name for name in variants if name in names), "missing-native-shell-tool")
                message = {"id": f"fc-fixture-{len(requests)}", "type": "function_call", "call_id": f"call-fixture-{len(requests)}",
                           "name": name, "arguments": json.dumps(variants.get(name, {}))}
            items = [message]
            started = []
            if self.path == "/v1/responses" and message["type"] == "message" and settings.pop("hosted_search", False):
                items.insert(0, {"id": "ws_fixture", "type": "web_search_call", "status": "completed",
                                 "action": {"type": "search", "query": "native search trace"}})
                started.append({"type": "response.output_item.added", "output_index": 0,
                                "item": {"id": "ws_fixture", "type": "web_search_call", "status": "in_progress"}})
            events = [
                {"type": "response.created", "response": {"id": "resp-fixture", "status": "in_progress", "output": []}},
                *started,
                *({"type": "response.output_item.done", "output_index": i, "item": item} for i, item in enumerate(items)),
                {"type": "response.completed", "response": {"id": "resp-fixture", "status": "completed", "output": items,
                 "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}},
            ]
            if settings.get("incomplete_stream"):
                events = events[:-1]
            self.write_sse("".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events))

        def write_sse(self, data):
            payload = data.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", requests, settings
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


@pytest.fixture
def code_session(monkeypatch, upstream):
    clients = []

    def client_factory(**kwargs):
        client = RecordingClient(**kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(codex_app_server_session, "CodexAppServerClient", client_factory)
    agents = []

    def start(**overrides):
        agent = code_agent(base_url=upstream[0], **overrides)
        agents.append(agent)
        codex_runtime._ensure_codex_session(agent)
        agent._codex_session.ensure_started()
        binding = getattr(agent, "_code_model_binding", None)
        assert binding is not None, "Code must bind the selected Aino route"
        provider = selected_provider(clients[-1])
        token = clients[-1].spawn["env"][provider["env_key"]]
        return agent, binding, provider["base_url"], {"Authorization": f"Bearer {token}"}

    yield start
    for agent in agents:
        codex_runtime._close_codex_session(agent)


def test_selected_third_party_receives_its_key_and_streams_unchanged(code_session, upstream):
    _agent, binding, base, headers = code_session(_client_kwargs={"default_headers": {"X-Tenant": "tenant-fixture"}})
    with binding.turn_context(), httpx.Client(trust_env=False) as client:
        response = client.post(base + "/responses", headers=headers | {"Cookie": "not-upstream", "X-Aino-Model-ID": "spoof"},
                               json={"model": "vendor/model-900k", "input": "hello", "stream": True})
    assert response.status_code == 200
    assert '"text": "fixture reply"' in response.text
    assert "event: response.completed\n" in response.text
    sent = httpx.Headers(upstream[1][0]["headers"])
    assert sent["Authorization"] == "Bearer real-provider-fixture-secret"
    assert sent["X-Tenant"] == "tenant-fixture"
    assert "cookie" not in sent and "X-Aino-Model-ID" not in sent


def test_managed_requests_reuse_live_credentials_and_current_turn_scope(code_session, upstream):
    identity = ["first-fixture-secret", "platform-model", 1]
    credential = ManagedCredential(lambda: identity[0], "user", "code-session", "vendor/model-900k",
                                   upstream[0], "codex_responses", False,
                                   get_request_identity=lambda: tuple(identity))
    _agent, binding, base, headers = code_session(api_key=credential)
    for turn, key in (("turn-one", "first-fixture-secret"), ("turn-two", "renewed-fixture-secret")):
        identity[0] = key
        scope_token = billing_scope.set(BillingScope("aino", "user", "code-session", turn, "chat"))
        try:
            with binding.turn_context(), httpx.Client(trust_env=False) as client:
                response = client.post(base + "/responses", headers=headers,
                                       json={"model": "vendor/model-900k", "input": "hello"})
            assert response.status_code == 200
        finally:
            billing_scope.reset(scope_token)
    sent = [httpx.Headers(request["headers"]) for request in upstream[1]]
    assert [headers["Authorization"] for headers in sent] == ["Bearer first-fixture-secret", "Bearer renewed-fixture-secret"]
    assert [headers["X-Aino-Turn-Id"] for headers in sent] == ["turn-one", "turn-two"]
    assert all(headers["X-Aino-Model-ID"] == "platform-model" for headers in sent)
    assert all(headers["X-Aino-Session-Id"] == "code-session" for headers in sent)


def test_parallel_profiles_keep_separate_code_homes_and_selected_provider_credentials(upstream, tmp_path, monkeypatch):
    default_home = get_hermes_home()
    monkeypatch.setenv("CODE_PROVIDER_API_KEY", "default-profile-fixture-secret")
    bindings = {}
    homes = {name: tmp_path / name for name in ("alpha", "beta")}
    try:
        for name, home in homes.items():
            home.mkdir()
            (home / ".env").write_text(f"CODE_PROVIDER_API_KEY={name}-fixture-secret\n")
            with bind_profile_scope(home, hydrate_secrets=False):
                bindings[name] = CodeModelBinding(code_agent(
                    provider=name, model=f"{name}-model", base_url=upstream[0] + f"/{name}",
                    api_key=lambda: get_secret("CODE_PROVIDER_API_KEY"),
                ))
        assert bindings["alpha"].home == homes["alpha"] / "code"
        assert bindings["beta"].home == homes["beta"] / "code"
        assert not (default_home / "code").exists()

        def send(name):
            relay = bindings[name].relay
            with httpx.Client(trust_env=False) as client:
                return client.post(relay.base_url + "/responses", headers={"Authorization": "Bearer " + relay.token},
                                   json={"model": f"{name}-model", "input": "hello"}).status_code

        with ExitStack() as turns:
            for name, home in homes.items():
                with bind_profile_scope(home, hydrate_secrets=False):
                    turns.enter_context(bindings[name].turn_context())
            assert get_hermes_home() == default_home
            with ThreadPoolExecutor(max_workers=2) as pool:
                assert list(pool.map(send, homes)) == [200, 200]
        sent = sorted((request["path"], request["body"]["model"], httpx.Headers(request["headers"])["Authorization"])
                      for request in upstream[1])
        assert sent == [("/v1/alpha/responses", "alpha-model", "Bearer alpha-fixture-secret"),
                        ("/v1/beta/responses", "beta-model", "Bearer beta-fixture-secret")]
    finally:
        for binding in bindings.values():
            binding.close()


@pytest.mark.parametrize("case", ["missing-token", "wrong-model", "wrong-path", "inactive-turn"])
def test_relay_rejects_unscoped_or_unrelated_requests(code_session, upstream, case):
    _agent, binding, base, headers = code_session()
    path = "/chat/completions" if case == "wrong-path" else "/responses"
    body = {"model": "unselected-model" if case == "wrong-model" else "vendor/model-900k", "input": "hi"}
    if case == "missing-token":
        headers = {}
    with httpx.Client(trust_env=False) as client:
        if case == "inactive-turn":
            response = client.post(base + path, headers=headers, json=body)
        else:
            with binding.turn_context():
                response = client.post(base + path, headers=headers, json=body)
    assert response.status_code >= 400
    assert upstream[1] == []


def test_closing_code_session_releases_its_model_route(code_session):
    agent, _binding, base, headers = code_session()
    codex_runtime._close_codex_session(agent)
    with httpx.Client(trust_env=False, timeout=1) as client, pytest.raises(httpx.ConnectError):
        client.post(base + "/responses", headers=headers, json={"model": "vendor/model-900k"})


@pytest.mark.parametrize("action", ["close", "release_clients"])
@pytest.mark.parametrize("session_state", ["running", "close-fails", "not-started"])
def test_agent_teardown_releases_code_relay_even_without_a_healthy_child(code_session, monkeypatch, action, session_state):
    source, binding, base, headers = code_session()
    agent = AIAgent.__new__(AIAgent)
    vars(agent).update(vars(source))
    agent.client = None
    agent._active_children_lock = threading.Lock()
    agent._active_children = set()
    agent._end_session_on_close = False
    agent._session_messages = []
    monkeypatch.setattr("run_agent.cleanup_vm", lambda _task_id: None)
    monkeypatch.setattr("run_agent.cleanup_browser", lambda _task_id: None)

    def failed_close():
        raise RuntimeError("child already unavailable")

    if session_state == "close-fails":
        monkeypatch.setattr(agent._codex_session, "close", failed_close)
    elif session_state == "not-started":
        agent._codex_session = None
    try:
        getattr(agent, action)()
        getattr(agent, action)()
        with httpx.Client(trust_env=False, timeout=1) as client, pytest.raises(httpx.ConnectError):
            client.post(base + "/responses", headers=headers, json={"model": "vendor/model-900k"})
        assert not binding.relay.thread.is_alive()
        assert binding.relay.client.is_closed
        assert agent._code_model_binding is None
        assert agent._codex_session is None
    finally:
        binding.close()


def test_changing_selected_model_retires_the_old_scoped_route(code_session):
    agent, old_binding, _base, _headers = code_session()
    agent.model = "new-selected-model"
    codex_runtime._ensure_codex_session(agent)
    assert agent._code_model_binding is not old_binding
    assert old_binding.relay.closed is True
    assert agent._code_model_binding.route.model == "new-selected-model"


def test_loopback_model_endpoint_bypasses_an_unrelated_system_proxy(code_session, monkeypatch):
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
    monkeypatch.setenv("ALL_PROXY", "http://127.0.0.1:9")
    monkeypatch.setenv("NO_PROXY", "")
    _agent, binding, base, headers = code_session()
    with binding.turn_context(), httpx.Client(trust_env=False) as client:
        response = client.post(base + "/responses", headers=headers, json={"model": "vendor/model-900k", "input": "hi"})
    assert response.status_code == 200


def test_upstream_error_does_not_echo_provider_header_secrets(code_session, caplog):
    _agent, binding, base, headers = code_session(_client_kwargs={"default_headers": {"X-Tenant-Key": "tenant-fixture-secret"}})
    with binding.turn_context(), httpx.Client(trust_env=False) as client:
        response = client.post(base + "/responses", headers=headers,
                               json={"model": "vendor/model-900k", "input": "reject-and-echo"})
    assert response.status_code == 401
    assert "tenant-fixture-secret" not in response.text
    assert "real-provider-fixture-secret" not in response.text
    assert response.json()["error"]["code"] == "upstream_http_error"
    assert "fixture-request-401" in response.text
    assert "upstream_http_error" in caplog.text
    assert "tenant-fixture-secret" not in caplog.text
    assert "real-provider-fixture-secret" not in caplog.text


@pytest.mark.parametrize("error,code", [
    (httpx.ConnectError("secret-bearing-url"), "upstream_connection_error"),
    (httpx.ReadTimeout("secret-bearing-url"), "upstream_timeout"),
    (RuntimeError("secret-bearing-url"), "request_preparation_error"),
])
def test_relay_classifies_failures_without_logging_exception_secrets(code_session, monkeypatch, caplog, error, code):
    _agent, binding, base, headers = code_session()

    def fail(*_args, **_kwargs):
        raise error

    monkeypatch.setattr(binding.relay, "request", fail)
    with binding.turn_context(), httpx.Client(trust_env=False) as client:
        response = client.post(base + "/responses", headers=headers,
                               json={"model": "vendor/model-900k", "input": "hello"})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == code
    assert code in caplog.text
    assert "secret-bearing-url" not in response.text + caplog.text


def test_bundled_codex_completes_a_turn_using_only_the_local_selected_route(upstream, tmp_path, codex_test_binary):
    workspace = tmp_path / "project"
    workspace.mkdir()
    agent = code_agent(model="gpt-5.4", base_url=upstream[0], session_cwd=str(workspace))
    binding = CodeModelBinding(agent)
    session = CodexAppServerSession(cwd=str(workspace), model=agent.model,
                                   codex_bin=codex_test_binary,
                                   **binding.session_options(CodexAppServerClient))
    try:
        with binding.turn_context():
            turn = session.run_turn("Reply with fixture reply.", model=agent.model, turn_timeout=25)
        assert turn.error is None, turn.error
        assert turn.final_text == "fixture reply"
        assert upstream[1]
        assert all(httpx.Headers(request["headers"])["Authorization"] == "Bearer real-provider-fixture-secret"
                   for request in upstream[1])
        assert not (binding.home / "auth.json").exists()
    finally:
        session.close()
        binding.close()


def test_bundled_code_relay_never_routes_loopback_through_a_proxy(upstream, tmp_path, codex_test_binary, monkeypatch):
    proxy = upstream[0].removesuffix("/v1")
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        monkeypatch.setenv(name, proxy)
    monkeypatch.setenv("NO_PROXY", "existing.internal")
    monkeypatch.setenv("no_proxy", "other.internal")
    workspace = tmp_path / "project"
    workspace.mkdir()
    agent = code_agent(model="vendor/model-900k", base_url=upstream[0], session_cwd=str(workspace))
    binding = CodeModelBinding(agent)

    def client(**kwargs):
        kwargs["extra_args"] += ["-c", "model_providers.aino_code.request_max_retries=0",
                                 "-c", "model_providers.aino_code.stream_max_retries=0"]
        return CodexAppServerClient(**kwargs)

    session = CodexAppServerSession(cwd=str(workspace), model=agent.model, codex_bin=codex_test_binary,
                                   **binding.session_options(client))
    try:
        with binding.turn_context():
            turn = session.run_turn("Reply with fixture reply.", model=agent.model, turn_timeout=15)
        assert turn.error is None, turn.error
        assert turn.final_text == "fixture reply"
        assert upstream[1] and all(request["path"] == "/v1/responses" for request in upstream[1])
    finally:
        session.close()
        binding.close()


@pytest.mark.parametrize("failure", ["http_error", "incomplete_stream"])
def test_bundled_managed_code_does_not_replay_an_ambiguous_inference(upstream, tmp_path, codex_test_binary, failure):
    upstream[2].update({"error": 502} if failure == "http_error" else {"incomplete_stream": True})
    workspace = tmp_path / "project"
    workspace.mkdir()
    credential = ManagedCredential(lambda: "managed-fixture-secret", "user", "code-session", "vendor/model-900k",
                                   upstream[0], "codex_responses", False)
    agent = code_agent(base_url=upstream[0], api_key=credential, session_cwd=str(workspace))
    binding = CodeModelBinding(agent)
    session = CodexAppServerSession(cwd=str(workspace), model=agent.model, codex_bin=codex_test_binary,
                                   **binding.session_options(CodexAppServerClient))
    scope_token = billing_scope.set(BillingScope("aino", "user", "code-session", "turn-one", "chat"))
    try:
        with binding.turn_context():
            turn = session.run_turn("Reply with fixture reply.", model=agent.model, turn_timeout=10)
        assert len(upstream[1]) == 1, "An uncertain billed inference must not be automatically replayed"
        assert turn.error
        if failure == "http_error":
            assert "HTTP 502" in turn.error
        assert "managed-fixture-secret" not in turn.error
    finally:
        billing_scope.reset(scope_token)
        session.close()
        binding.close()


def test_bundled_codex_executes_native_tools_and_resumes_its_thread(upstream, tmp_path, codex_test_binary):
    workspace = tmp_path / "project"
    workspace.mkdir()
    upstream[2]["coding"] = True
    agent = code_agent(model="gpt-5.4", base_url=upstream[0], session_cwd=str(workspace))
    events = []
    thread_id = None
    for prompt in ("Create fixture.txt containing code-fixture.", "Continue this same conversation."):
        binding = CodeModelBinding(agent)
        session = CodexAppServerSession(cwd=str(workspace), model=agent.model, codex_bin=codex_test_binary,
                                       approval_callback=lambda *_args, **_kwargs: "once", on_event=events.append,
                                       resume_thread_id=thread_id, **binding.session_options(CodexAppServerClient))
        try:
            with binding.turn_context():
                turn = session.run_turn(prompt, model=agent.model, turn_timeout=25)
            assert turn.error is None, turn.error
            assert turn.final_text == "fixture reply"
            assert turn.thread_id
            if thread_id:
                assert turn.thread_id == thread_id
            else:
                assert turn.tool_iterations >= 1, {
                    "file_created": (workspace / "fixture.txt").exists(),
                    "methods": sorted({note.get("method") for note in events}),
                    "items": [note.get("params", {}).get("item", {}).get("type") for note in events if note.get("method") == "item/completed"],
                    "outputs": [item.get("output") for request in upstream[1] for item in request["body"].get("input", [])
                                if isinstance(item, dict) and item.get("type") == "function_call_output"],
                }
                assert (workspace / "fixture.txt").read_text() == "code-fixture"
                thread_id = turn.thread_id
        finally:
            session.close()
            binding.close()
    assert len(upstream[1]) >= 3
    assert any(note.get("params", {}).get("item", {}).get("type") == "commandExecution" for note in events)
    assert not (binding.home / "auth.json").exists()
    assert all(b"real-provider-fixture-secret" not in path.read_bytes() for path in binding.home.rglob("*") if path.is_file())


def test_code_model_switch_resumes_history_after_hosted_web_search(upstream, tmp_path, codex_test_binary, monkeypatch):
    base_url, requests, settings = upstream
    settings.update(commands=["printf code-fixture >> fixture.txt"], hosted_search=True, chat_reply=True)
    workspace = tmp_path / "project"
    workspace.mkdir()
    monkeypatch.chdir(workspace)
    code_home = get_hermes_home() / "code"
    code_home.mkdir()
    (code_home / "config.toml").write_text('web_search = "live"\n')
    (get_hermes_home() / "config.yaml").write_text(json.dumps({
        "model": {"codex_bin": codex_test_binary}, "approvals": {"mode": "off"},
        "auxiliary": {"title_generation": {"model_upgrade_enabled": False}},
    }))
    sid = "code-switch"

    with SessionDB(tmp_path / "state.db") as db:
        def run(model, mode, prompt, history=None):
            key = "fixture-key-" + model
            scope = BillingScope("aino", "fixture-user", sid, model + "-turn", "chat")
            credential = ManagedCredential(lambda: key, scope.user_id, sid, model, base_url, mode, False,
                                           model_id=model + "-catalog")
            agent = AIAgent(model=model, api_mode=mode, provider="aino", base_url=base_url, api_key=credential,
                           enabled_toolsets=[], quiet_mode=True, skip_context_files=True, skip_memory=True,
                           skip_background_review=True, load_soul_identity=False, save_trajectories=False,
                           session_db=db, session_id=sid, platform="gui", cwd=str(workspace))
            agent.execution_mode = "code"
            token = billing_scope.set(scope)
            try:
                result = agent.run_conversation(prompt, conversation_history=history)
                assert result["completed"], result.get("error") or result["final_response"]
                return result["final_response"]
            finally:
                billing_scope.reset(token)
                agent.close()

        first_prompt = "Look up the marker and record it in fixture.txt."
        assert run("gpt-5.4", "codex_responses", first_prompt) == "fixture reply"
        thread_id = db.get_session_model_config_value(sid, "codex_thread_id")
        assert thread_id
        assert (workspace / "fixture.txt").read_text() == "code-fixture"
        rollout = next((code_home / "sessions").rglob(f"*{thread_id}.jsonl"))
        kinds = [record["payload"].get("type") for record in map(json.loads, rollout.read_text().splitlines())
                 if record["type"] == "response_item"]
        assert "web_search_call" in kinds

        db.update_session_model(sid, "glm-5.3-flash", "aino", base_url=base_url, api_mode="chat_completions")
        followup = "What did I ask you to look up?"
        assert run("glm-5.3-flash", "chat_completions", followup, db.get_messages_as_conversation(sid)) == "fixture bridged reply"
        assert db.get_session_model_config_value(sid, "codex_thread_id") == thread_id

    inference = [request for request in requests if request["path"].startswith("/v1/")]
    assert [request["path"] for request in inference] == ["/v1/responses"] * 2 + ["/v1/chat/completions"]
    assert (workspace / "fixture.txt").read_text() == "code-fixture"
    bridged = inference[-1]
    assert bridged["body"]["model"] == "glm-5.3-flash"
    headers = httpx.Headers(bridged["headers"])
    assert headers["Authorization"] == "Bearer fixture-key-glm-5.3-flash"
    assert headers["X-Aino-Model-ID"] == "glm-5.3-flash-catalog"
    assert headers["X-Aino-Session-Id"] == sid and headers["X-Aino-Turn-Id"] == "glm-5.3-flash-turn"
    messages = bridged["body"]["messages"]
    assert any(m["role"] == "user" and first_prompt in json.dumps(m["content"]) for m in messages)
    assert any(m["role"] == "assistant" and "fixture reply" in json.dumps(m["content"]) for m in messages)
    assert any(m["role"] == "tool" for m in messages)
    assert messages[-1] == {"role": "user", "content": [{"type": "text", "text": followup}]}
    assert "native search trace" not in json.dumps(bridged["body"])


def test_native_code_finishes_edit_verify_review_workflow_on_the_selected_route(upstream, tmp_path, codex_test_binary):
    workspace = tmp_path / 'workflow'
    workspace.mkdir()
    upstream[2]['workflow'] = True
    upstream[2]['commands'] = [
        'printf code-fixture > fixture.txt',
        'test "$(cat fixture.txt)" = code-fixture && printf "verification passed"',
        'git diff --no-index -- /dev/null fixture.txt; result=$?; test "$result" -le 1',
    ]
    agent = code_agent(model='gpt-5.4', base_url=upstream[0], session_cwd=str(workspace))
    binding = CodeModelBinding(agent)
    completed = []
    bridge = codex_runtime.make_codex_app_server_event_bridge(SimpleNamespace(
        tool_complete_callback=lambda *args: completed.append(args)))
    session = CodexAppServerSession(cwd=str(workspace), model=agent.model, codex_bin=codex_test_binary,
        approval_callback=lambda *_args, **_kwargs: 'once', on_event=bridge, **binding.session_options(CodexAppServerClient))
    try:
        with binding.turn_context():
            result = session.run_turn('Implement the reviewed requirements, verify and inspect the diff.',
                                      model=agent.model, turn_timeout=30)
        assert result.error is None, result.error
        assert (workspace / 'fixture.txt').read_text() == 'code-fixture'
        outputs = [item.get('output') for request in upstream[1] for item in request['body'].get('input', [])
                   if isinstance(item, dict) and item.get('type') == 'function_call_output']
        assert 'verification passed' in json.dumps(outputs)
        assert '+code-fixture' in json.dumps(outputs), outputs
        assert result.tool_iterations >= 3
        receipts = [json.loads(row[3]) for row in completed if row[1] == 'exec_command']
        assert any('verification passed' in row['output'] and row['exit_code'] == 0 for row in receipts)
        assert all(row['duration_s'] >= 0 for row in receipts)
        assert all(request['body']['model'] == 'gpt-5.4' for request in upstream[1])
        assert all(httpx.Headers(request['headers'])['Authorization'] == 'Bearer real-provider-fixture-secret'
                   for request in upstream[1])
    finally:
        session.close()
        binding.close()


def test_native_apply_patch_keeps_reviewable_evidence(upstream, tmp_path, codex_test_binary):
    workspace = tmp_path / "patch-project"
    workspace.mkdir()
    # Match upstream app-server's apply-patch acceptance fixture: native shell
    # interception owns patch execution and emits the fileChange lifecycle.
    upstream[2]["commands"] = ["apply_patch <<'PATCH'\n*** Begin Patch\n*** Add File: native.txt\n+native patch works\n*** End Patch\nPATCH"]
    agent = code_agent(model="gpt-5.4", base_url=upstream[0], session_cwd=str(workspace))
    binding = CodeModelBinding(agent)
    completed = []
    bridge = codex_runtime.make_codex_app_server_event_bridge(SimpleNamespace(
        tool_complete_callback=lambda *args: completed.append(args)))
    session = CodexAppServerSession(cwd=str(workspace), model=agent.model, codex_bin=codex_test_binary,
        approval_callback=lambda *_args, **_kwargs: "once", on_event=bridge,
        **binding.session_options(CodexAppServerClient))
    try:
        with binding.turn_context():
            result = session.run_turn("Create native.txt using apply_patch", model=agent.model, turn_timeout=30)
        assert result.error is None, result.error
        assert (workspace / "native.txt").exists(), {
            "tools": [{"name": t.get("name"), "type": t.get("type")} for t in upstream[1][0]["body"].get("tools", [])],
            "outputs": [i for r in upstream[1] for i in r["body"].get("input", [])
                        if "output" in i.get("type", "")], "completed": completed}
        assert (workspace / "native.txt").read_text() == "native patch works\n"
        receipt = json.loads(next(row[3] for row in completed if row[1] == "apply_patch"))
        assert receipt["success"] is True
        assert "+native patch works" in receipt["changes"][0]["diff"]
        assert any(json.loads(msg["content"]) == receipt for msg in result.projected_messages if msg["role"] == "tool")
    finally:
        session.close()
        binding.close()


@pytest.mark.parametrize('projectless', [False, True])
@pytest.mark.parametrize('custom_auto', [False, True])
def test_code_agent_runs_native_file_edit_with_selected_route_and_closes_relay(upstream, tmp_path, codex_test_binary, monkeypatch, projectless, custom_auto):
    if projectless:
        from gateway.session_policy import build_policy
        policy = build_policy({'source': 'gui', 'execution_mode': 'code', 'toolsets': []}, {},
                              session_id='native-code-conversation')
        workspace = Path(policy.cwd)
        (workspace.parent / '.git').mkdir()
        (workspace.parent / 'AGENTS.md').write_text('UNRELATED_PARENT_PROJECT_INSTRUCTIONS')
    else:
        workspace = tmp_path / "project"
        workspace.mkdir()
    monkeypatch.chdir(workspace)
    (get_hermes_home() / "config.yaml").write_text(json.dumps({
        "model": {"codex_bin": codex_test_binary}, "approvals": {"mode": "off"},
    }))
    route = dict(model="gpt-5.4", api_mode="codex_responses", provider="openai",
                 api_key="real-provider-fixture-secret", base_url=upstream[0])
    if custom_auto:
        draft = CustomEndpointUpdate(id="native-fixture", name="Native fixture", model="gpt-5.4",
            api_key="real-provider-fixture-secret", base_url=upstream[0], api_mode="")
        detected = asyncio.run(validate_custom_endpoint(draft))
        assert detected["ok"] and detected["detected_api_mode"] == "codex_responses"
        upsert_custom_endpoint(draft.model_copy(update={"api_mode": detected["detected_api_mode"]}))
        runtime = resolve_runtime_provider(requested="native-fixture", target_model="gpt-5.4")
        route = {name: runtime[name] for name in route}
    upstream[2]["coding"] = True
    agent = AIAgent(
        **route,
        enabled_toolsets=[], quiet_mode=True, skip_context_files=True, skip_memory=True,
        skip_background_review=True, load_soul_identity=False, save_trajectories=False,
        session_id="native-code-conversation", platform="gui", cwd=str(workspace),
    )
    agent.execution_mode = "code"
    binding = None
    try:
        result = agent.run_conversation("Create fixture.txt containing code-fixture.")
        assert result.get("error") is None, result
        assert result["completed"] is True, result
        assert result["final_response"] == "fixture reply"
        assert (workspace / "fixture.txt").exists(), json.dumps({
            "requests": [{"path": request["path"], "tools": [tool.get("name") for tool in request["body"].get("tools", [])],
                          "outputs": [item.get("output") for item in request["body"].get("input", [])
                                      if isinstance(item, dict) and item.get("type") == "function_call_output"]}
                         for request in upstream[1]],
        })
        assert (workspace / "fixture.txt").read_text() == "code-fixture"
        responses = [request for request in upstream[1] if request["path"] == "/v1/responses"]
        assert len(responses) >= 2
        assert 'UNRELATED_PARENT_PROJECT_INSTRUCTIONS' not in json.dumps(responses)
        assert all(request["body"]["model"] == "gpt-5.4" for request in responses)
        assert all(httpx.Headers(request["headers"])["Authorization"] == "Bearer real-provider-fixture-secret"
                   for request in responses)
        assert any(message.get("role") == "tool" for message in result["messages"])
        binding = agent._code_model_binding
    finally:
        agent.close()
    assert binding is not None
    with httpx.Client(trust_env=False, timeout=1) as client, pytest.raises(httpx.ConnectError):
        client.post(binding.relay.base_url + "/responses", json={"model": "gpt-5.4"})
    assert not binding.relay.thread.is_alive()
    assert agent._code_model_binding is None


@pytest.mark.parametrize("mode", ["bedrock_converse", "images_generations", "codex_app_server"])
def test_code_rejects_unsupported_wire_protocol_before_spawning(mode):
    agent = code_agent(api_mode=mode)
    try:
        with pytest.raises(ValueError, match="Responses"):
            codex_runtime._ensure_codex_session(agent)
        assert agent._codex_session is None
    finally:
        codex_runtime._close_codex_session(agent)

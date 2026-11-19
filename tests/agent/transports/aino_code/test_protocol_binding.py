"""Real Codex uses Chat/Messages without moving a user's request or billing route."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import httpx
import pytest

from agent.codex_runtime import make_codex_app_server_event_bridge

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential, billing_scope
from agent.transports.aino_code.binding import CodeModelBinding
from agent.transports.codex_app_server import CodexAppServerClient
from agent.transports.codex_app_server_session import CodexAppServerSession


@pytest.fixture
def upstream():
    recorded, options = [], {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if self.path == "/api/show":
                self.send_response(404)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            recorded.append({"body": body, "path": self.path, "headers": dict(self.headers)})
            anthro = self.path.endswith("/messages")
            tools = body.get("tools") or []
            tools = tools if anthro else [tool["function"] for tool in tools]
            should_call = options.get("tools") and bool(tools) and not options.get("sent")
            if should_call:
                options["sent"] = True
                names = {tool["name"] for tool in tools}
                name = next((x for x in ("exec_command", "shell_command", "shell") if x in names), "unknown")
                args = {"exec_command": {"cmd": "printf protocol-ok > bridge.txt", "yield_time_ms": 1000},
                        "shell_command": {"command": "printf protocol-ok > bridge.txt"},
                        "shell": {"command": ["/bin/sh", "-c", "printf protocol-ok > bridge.txt"]}}.get(name, {})
            if anthro:
                content = [{"type": "thinking", "thinking": "fixture reasoning", "signature": "fixture-signature"},
                           {"type": "tool_use", "id": "call-1", "name": name, "input": args}] if should_call else [
                               {"type": "text", "text": "bridge reply"}]
                frames = [{"type": "message_start", "message": {"id": "fixture-msg", "usage": {"input_tokens": 4}}}]
                for index, block in enumerate(content):
                    frames.extend([{"type": "content_block_start", "index": index, "content_block": block},
                                   {"type": "content_block_stop", "index": index}])
                frames.extend([{"type": "message_delta", "delta": {"stop_reason": "tool_use" if should_call else "end_turn"},
                                "usage": {"output_tokens": 5}}, {"type": "message_stop"}])
            else:
                delta = {"reasoning_content": "fixture reasoning", "tool_calls": [{"index": 0, "id": "call-1",
                    "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]} if should_call else {
                        "content": "bridge reply"}
                frames = [{"choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                          {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls" if should_call else "stop"}],
                           "usage": {"prompt_tokens": 4, "completion_tokens": 5}}, "[DONE]"]
            if options.get("incomplete"):
                frames = frames[:1]
            data = "".join("data: " + (frame if isinstance(frame, str) else json.dumps(frame)) + "\n\n" for frame in frames).encode()
            self.send_response(options.get("status", 200))
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", recorded, options
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def _agent(mode, base, workspace, credential="fixture-direct-secret"):
    return SimpleNamespace(execution_mode="code", api_mode=mode, model="fixture-model", provider="custom:fixture",
                           base_url=base, api_key=credential, session_id="bridge-session", session_cwd=str(workspace),
                           _client_kwargs={})


@pytest.mark.parametrize("base,key,header", [
    ("https://api.kimi.com/coding", "fixture-kimi-key", "x-api-key"),
    ("https://api.minimax.io/anthropic", "fixture-minimax-key", "authorization"),
    ("https://api.anthropic.com", "sk-ant-oat01-fixture", "authorization"),
])
def test_anthropic_http_auth_matches_existing_provider_conventions(tmp_path, monkeypatch, base, key, header):
    from agent import anthropic_adapter
    monkeypatch.setattr(anthropic_adapter, "_get_claude_code_version", lambda: "fixture-version")
    binding = CodeModelBinding(_agent("anthropic_messages", base, tmp_path, key))
    try:
        # Build only: no request is sent to these real provider hostnames.
        request = binding.relay.request(SimpleNamespace(headers={}), "/v1/messages", b'{"model":"fixture-model"}')
        assert request.headers[header] == (key if header == "x-api-key" else "Bearer " + key)
        if "kimi" in base or key.startswith("sk-ant-oat01"):
            assert request.headers.get("user-agent") and "python-httpx" not in request.headers["user-agent"]
        if key.startswith("sk-ant-oat01"):
            assert "oauth-2025-04-20" in request.headers.get("anthropic-beta", "")
    finally:
        binding.close()


@pytest.mark.parametrize("mode,path", [("chat_completions", "/v1/chat/completions"), ("anthropic_messages", "/v1/messages")])
def test_existing_selected_protocol_is_adapted_without_changing_model_or_destination(upstream, tmp_path, mode, path):
    binding = CodeModelBinding(_agent(mode, upstream[0], tmp_path))
    try:
        with binding.turn_context(), httpx.Client(trust_env=False) as client:
            response = client.post(binding.relay.base_url + "/responses", headers={"Authorization": "Bearer " + binding.relay.token},
                                   json={"model": "fixture-model", "input": "hello", "stream": True})
        assert response.status_code == 200, response.text
        assert "response.completed" in response.text and "bridge reply" in response.text
        assert len(upstream[1]) == 1
        request = upstream[1][0]
        assert request["path"] == path and request["body"]["model"] == "fixture-model"
        assert (httpx.Headers(request["headers"])["authorization"] == "Bearer fixture-direct-secret" if mode == "chat_completions"
                else httpx.Headers(request["headers"])["x-api-key"] == "fixture-direct-secret")
    finally:
        binding.close()


@pytest.mark.parametrize("mode", ["chat_completions", "anthropic_messages"])
def test_unsupported_code_shape_is_rejected_locally_without_a_model_request(upstream, tmp_path, mode):
    binding = CodeModelBinding(_agent(mode, upstream[0], tmp_path))
    try:
        with binding.turn_context(), httpx.Client(trust_env=False) as client:
            response = client.post(binding.relay.base_url + "/responses", headers={"Authorization": "Bearer " + binding.relay.token},
                                   json={"model": "fixture-model", "input": "hello", "tools": [{"type": "web_search"}]})
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "unsupported_code_request"
        assert not upstream[1]
    finally:
        binding.close()


@pytest.mark.parametrize("mode", ["chat_completions", "anthropic_messages"])
def test_native_codex_executes_a_tool_and_resumes_with_original_protocol(upstream, tmp_path, codex_test_binary, mode):
    upstream[2]["tools"] = True
    workspace = tmp_path / "project"
    workspace.mkdir()
    agent = _agent(mode, upstream[0], workspace)
    thread_id = None
    completed = []
    bridge = make_codex_app_server_event_bridge(SimpleNamespace(
        tool_complete_callback=lambda *args: completed.append(args)))
    for prompt in ("Write bridge.txt", "Continue the same conversation"):
        binding = CodeModelBinding(agent)
        session = CodexAppServerSession(cwd=str(workspace), model=agent.model, codex_bin=codex_test_binary,
                                       approval_callback=lambda *_args, **_kwargs: "once", resume_thread_id=thread_id,
                                       on_event=bridge,
                                       **binding.session_options(CodexAppServerClient))
        try:
            with binding.turn_context():
                turn = session.run_turn(prompt, model=agent.model, turn_timeout=25)
            assert turn.error is None, turn.error
            assert turn.final_text == "bridge reply"
            if thread_id is None:
                with binding.turn_context():
                    compacted = session.compact_thread(turn_timeout=25)
                assert compacted.error is None, compacted.error
                assert compacted.compacted
            if thread_id:
                assert turn.thread_id == thread_id
            thread_id = turn.thread_id
        finally:
            session.close()
            binding.close()
    assert (workspace / "bridge.txt").read_text() == "protocol-ok"
    command = next(row for row in completed if row[1] == "exec_command")
    assert "bridge.txt" in command[2]["command"]
    assert json.loads(command[3])["exit_code"] == 0
    assert json.loads(command[3])["duration_s"] >= 0
    assert len(upstream[1]) >= 3
    followup = upstream[1][1]["body"]["messages"]
    if mode == "chat_completions":
        assert any(m.get("reasoning_content") == "fixture reasoning" and m.get("tool_calls") for m in followup)
        assert any(m["role"] == "tool" and m["tool_call_id"] == "call-1" for m in followup)
    else:
        assert any(b.get("signature") == "fixture-signature" for m in followup for b in m["content"])
        assert any(b.get("type") == "tool_result" and b.get("tool_use_id") == "call-1" for m in followup for b in m["content"])


@pytest.mark.parametrize("mode", ["chat_completions", "anthropic_messages"])
def test_managed_adapter_keeps_billing_identity_and_does_not_replay_failure(upstream, tmp_path, codex_test_binary, mode):
    upstream[2]["incomplete"] = True
    credential = ManagedCredential(lambda: "fixture-managed-secret", "fixture-user", "bridge-session", "fixture-model",
                                   upstream[0], mode, False, model_id="catalog-glm")
    binding = CodeModelBinding(_agent(mode, upstream[0], tmp_path, credential))
    session = CodexAppServerSession(cwd=str(tmp_path), model="fixture-model", codex_bin=codex_test_binary,
                                   **binding.session_options(CodexAppServerClient))
    token = billing_scope.set(BillingScope("aino", "fixture-user", "bridge-session", "turn-1", "chat"))
    try:
        with binding.turn_context():
            turn = session.run_turn("reply", model="fixture-model", turn_timeout=15)
        assert turn.error
        assert len(upstream[1]) == 1
        headers = httpx.Headers(upstream[1][0]["headers"])
        assert headers["Authorization"] == "Bearer fixture-managed-secret" and "x-api-key" not in headers
        assert headers["X-Aino-Model-ID"] == "catalog-glm"
        assert headers["X-Aino-Turn-Id"] == "turn-1" and headers["X-Aino-Session-Id"] == "bridge-session"
    finally:
        billing_scope.reset(token)
        session.close()
        binding.close()


@pytest.mark.parametrize("mode", ["chat_completions", "anthropic_messages"])
def test_real_aino_agent_keeps_codex_execution_with_a_chat_or_messages_model(upstream, tmp_path, codex_test_binary, monkeypatch, mode):
    from hermes_constants import get_hermes_home
    from run_agent import AIAgent

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.chdir(workspace)
    (get_hermes_home() / "config.yaml").write_text(json.dumps({
        "model": {"codex_bin": codex_test_binary}, "approvals": {"mode": "off"},
        "custom_providers": [{"name": "fixture", "base_url": upstream[0], "api_mode": mode,
                              "extra_headers": {"X-Fixture-Tenant": "original-tenant", "User-Agent": "FixtureAgent/1.0"}}]}))
    upstream[2]["tools"] = True
    agent = AIAgent(model="fixture-model", provider="openai", api_mode=mode, base_url=upstream[0],
                   api_key="fixture-direct-secret", enabled_toolsets=[], quiet_mode=True, skip_context_files=True,
                   skip_memory=True, skip_background_review=True, load_soul_identity=False, save_trajectories=False,
                   session_id="bridge-full-agent", platform="gui", cwd=str(workspace))
    agent.execution_mode = "code"
    try:
        result = agent.run_conversation("Write bridge.txt with the specified fixture text.")
        assert result["completed"] and not result.get("error"), result
        assert result["final_response"] == "bridge reply"
        assert (workspace / "bridge.txt").exists(), upstream[1]
        assert (workspace / "bridge.txt").read_text() == "protocol-ok"
        assert all(request["body"]["model"] == "fixture-model" for request in upstream[1])
        for request in upstream[1]:
            headers = httpx.Headers(request["headers"])
            assert headers.get("X-Fixture-Tenant") == "original-tenant"
            assert headers["User-Agent"] == "FixtureAgent/1.0"
            assert ("authorization" in headers) != ("x-api-key" in headers)
    finally:
        agent.close()

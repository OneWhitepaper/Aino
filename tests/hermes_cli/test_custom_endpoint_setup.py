"""Setup probes use the entered route and require completed inference evidence."""

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from hermes_cli.config import load_config, save_config, save_env_value
from hermes_cli.runtime_provider import resolve_runtime_provider
from hermes_cli.web_models import CustomEndpointUpdate
from hermes_cli.web_routers import config_env


@pytest.fixture
def endpoint():
    routes, requests = {}, []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def handle_request(self):
            payload = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            requests.append((self.command, self.path, dict(self.headers), payload))
            status, body, content_type = routes.get(
                (self.command, self.path), (404, {"error": {"type": "not_found"}}, "application/json"))
            data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = handle_request

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    root = f"http://127.0.0.1:{server.server_port}"
    try:
        yield SimpleNamespace(root=root, base=root + "/tenant/v1", routes=routes, requests=requests)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def completed_reply(mode):
    replies = {
        "chat_completions": {"id": "chat-fixture", "object": "chat.completion", "choices": [{
            "message": {"role": "assistant", "content": "OK"}, "finish_reason": "stop"}]},
        "anthropic_messages": {"id": "msg-fixture", "type": "message", "role": "assistant",
            "content": [{"type": "text", "text": "OK"}], "stop_reason": "end_turn"},
    }
    if mode in replies:
        return 200, replies[mode], "application/json"
    item = {"id": "msg-fixture", "type": "message", "role": "assistant", "status": "completed",
            "content": [{"type": "output_text", "text": "OK"}]}
    return sse_reply([
        {"type": "response.output_item.done", "item": item},
        {"type": "response.completed", "response": {
            "id": "resp-fixture", "object": "response", "status": "completed", "output": [item]}},
    ])


def sse_reply(events):
    return 200, "".join("data: " + json.dumps(event) + "\n\n" for event in events), "text/event-stream"


def validate(base, **overrides):
    return asyncio.run(config_env.validate_custom_endpoint(CustomEndpointUpdate(**{
        "name": "Setup", "base_url": base, "model": "fixture-model", "api_key": "fixture-key",
        "api_mode": "", **overrides})))


@pytest.mark.parametrize("base_path, route, mode", [
    ("/tenant/v1", "responses", "codex_responses"),
    ("/tenant/v1", "chat/completions", "chat_completions"),
    ("/tenant/v1", "messages", "anthropic_messages"),
    ("/tenant/v4", "chat/completions", "chat_completions"),
    ("/api/coding/paas/v4", "chat/completions", "chat_completions"),
])
def test_pasted_inference_url_validates_and_saves_the_same_base(endpoint, base_path, route, mode):
    base = endpoint.root + base_path
    endpoint.routes["POST", base_path + "/" + route] = completed_reply(mode)
    pasted = base + "/" + route + "/"
    result = validate(pasted)
    assert result["ok"] is True, result
    assert result["resolved_base_url"] == base
    assert result["detected_api_mode"] == mode
    config_env.upsert_custom_endpoint(CustomEndpointUpdate(name="Setup", base_url=pasted,
        model="fixture-model", api_key="fixture-key", api_mode=result["detected_api_mode"]))
    runtime = resolve_runtime_provider(requested="custom:setup", target_model="fixture-model")
    assert runtime["base_url"] == base
    assert runtime["api_mode"] == mode
    assert runtime["api_key"] == "fixture-key"
    assert all(path.startswith(base_path.removesuffix("/v1") + "/") for _, path, _, _ in endpoint.requests)


@pytest.mark.parametrize("mode", ["", "anthropic_messages"])
def test_anthropic_base_without_v1_uses_runtime_messages_path_without_catalog(endpoint, mode):
    endpoint.routes["POST", "/tenant/anthropic/v1/messages"] = completed_reply("anthropic_messages")
    result = validate(endpoint.root + "/tenant/anthropic", api_mode=mode)
    assert result["ok"] is True, result
    assert result["transport_checked"] == "anthropic_messages"
    posts = [(path, headers) for method, path, headers, _ in endpoint.requests if method == "POST"]
    assert len(posts) == 1
    assert posts[0][0] == "/tenant/anthropic/v1/messages"
    assert posts[0][1]["x-api-key"] == "fixture-key"


@pytest.mark.parametrize("status", [401, 403, 429])
def test_catalog_auth_or_quota_failure_stops_without_alternate_requests(endpoint, status):
    endpoint.routes["GET", "/tenant/v1/models"] = status, {"error": {"type": "permission_denied"}}, "application/json"
    endpoint.routes["GET", "/tenant/models"] = 200, {"data": [{"id": "fixture-model"}]}, "application/json"
    endpoint.routes["POST", "/tenant/responses"] = completed_reply("codex_responses")
    result = validate(endpoint.base)
    assert result["ok"] is False, result
    assert not result.get("detected_api_mode")
    assert [(method, path) for method, path, _, _ in endpoint.requests] == [("GET", "/tenant/v1/models")]


@pytest.mark.parametrize("error", ["authentication_error", "permission_error", "insufficient_quota", "rate_limit_error"])
@pytest.mark.parametrize("wire", ["json", "sse", "sse_completed"])
def test_inference_error_body_does_not_replay_under_another_protocol(endpoint, error, wire):
    payload = {"error": {"type": error, "message": "fixture-key must not be echoed"}}
    endpoint.routes["POST", "/tenant/v1/responses"] = (
        (200, payload, "application/json") if wire == "json" else sse_reply([
            {"type": "response.completed" if wire == "sse_completed" else "response.failed",
             "response": {"status": "failed", **payload}}]))
    endpoint.routes["POST", "/tenant/v1/chat/completions"] = completed_reply("chat_completions")
    result = validate(endpoint.base)
    assert result["ok"] is False, result
    assert not result.get("detected_api_mode")
    assert "fixture-key" not in result["message"]
    assert [path for method, path, _, _ in endpoint.requests if method == "POST"] == ["/tenant/v1/responses"]


@pytest.mark.parametrize("mode, route, field, value", [
    ("chat_completions", "chat/completions", "finish_reason", "length"),
    ("chat_completions", "chat/completions", "finish_reason", "content_filter"),
    ("anthropic_messages", "messages", "stop_reason", "max_tokens"),
    ("anthropic_messages", "messages", "stop_reason", "pause_turn"),
])
def test_partial_text_with_noncompleted_stop_reason_is_not_protocol_evidence(endpoint, mode, route, field, value):
    status, payload, content_type = completed_reply(mode)
    (payload["choices"][0] if mode == "chat_completions" else payload)[field] = value
    endpoint.routes["POST", "/tenant/v1/" + route] = status, payload, content_type
    result = validate(endpoint.base)
    assert result["ok"] is False, result
    assert not result.get("detected_api_mode")


def test_responses_completion_requires_completed_assistant_item(endpoint):
    item = {"id": "msg-fixture", "type": "message", "role": "assistant", "status": "in_progress",
            "content": [{"type": "output_text", "text": "partial"}]}
    endpoint.routes["POST", "/tenant/v1/responses"] = sse_reply([
        {"type": "response.output_item.done", "item": item},
        {"type": "response.completed", "response": {"id": "resp-fixture", "status": "completed", "output": [item]}},
    ])
    result = validate(endpoint.base)
    assert result["ok"] is False, result


@pytest.mark.parametrize("target", ["same", "other_origin", "other_path"])
@pytest.mark.parametrize("base_path, route, mode", [
    ("/tenant/v1", "responses", "codex_responses"),
    ("/tenant/v4", "chat/completions", "chat_completions"),
    ("/api/coding/paas/v4", "chat/completions", "chat_completions"),
])
def test_pasted_url_does_not_expand_saved_credential_scope(endpoint, target, base_path, route, mode):
    base = endpoint.root + base_path
    endpoint.routes["POST", base_path + "/" + route] = completed_reply(mode)
    cfg = load_config()
    cfg["providers"] = {"setup": {"name": "Setup", "base_url": base, "model": "fixture-model",
        "key_env": "SETUP_FIXTURE_KEY", "extra_headers": {"X-Tenant-Key": "fixture-header-key"}}}
    save_config(cfg)
    save_env_value("SETUP_FIXTURE_KEY", "fixture-key")
    pasted = {
        "same": base + "/" + route,
        "other_origin": base.replace("127.0.0.1", "localhost") + "/" + route,
        "other_path": endpoint.root + "/another-tenant" + base_path + "/" + route,
    }[target]
    result = validate(pasted, id="setup", api_key=None)
    if target == "same":
        assert result["ok"] is True, result
        assert result["resolved_base_url"] == base
    assert endpoint.requests
    for _, _, headers, _ in endpoint.requests:
        assert ("fixture-key" in headers.get("Authorization", "") or headers.get("x-api-key") == "fixture-key") == (target == "same")
        assert (headers.get("X-Tenant-Key") == "fixture-header-key") == (target == "same")
    if target != "same":
        with pytest.raises(HTTPException, match="API key"):
            config_env.upsert_custom_endpoint(CustomEndpointUpdate(id="setup", name="Setup", base_url=pasted,
                model="fixture-model", api_key=None))
        assert load_config()["providers"]["setup"]["base_url"] == base


@pytest.mark.parametrize("base, key, auth_header, identity", [
    ("https://api.anthropic.com", "sk-ant-api-fixture", "x-api-key", None),
    ("https://api.anthropic.com", "sk-ant-oat01-fixture", "Authorization", "oauth"),
    ("https://api.minimax.io/anthropic", "fixture-key", "Authorization", None),
    ("https://api.kimi.com/coding", "fixture-key", "x-api-key", "kimi"),
])
def test_anthropic_probe_auth_variants_match_runtime_identity(endpoint, monkeypatch, base, key, auth_header, identity):
    from agent import anthropic_adapter

    # Version discovery can run an installed CLI; this test exercises its headers.
    monkeypatch.setattr(anthropic_adapter, "_get_claude_code_version", lambda: "2.0.0")
    headers = config_env._protocol_probe_headers(key, base, "anthropic_messages", {})
    endpoint.routes["POST", "/tenant/v1/messages"] = completed_reply("anthropic_messages")

    async def send():
        async with config_env._endpoint_probe_client(endpoint.base, 3) as client:
            return await config_env._verify_protocol_reply(client, endpoint.base, "anthropic_messages", "fixture-model", headers)

    assert asyncio.run(send()).verified
    sent = {key.lower(): value for key, value in endpoint.requests[0][2].items()}
    assert sent[auth_header.lower()] == (f"Bearer {key}" if auth_header == "Authorization" else key)
    assert ("x-api-key" in sent) != ("authorization" in sent)
    if identity == "oauth":
        assert sent["user-agent"].startswith("claude-code/")
        assert sent["x-app"] == "cli"
        assert "oauth-2025-04-20" in sent["anthropic-beta"]
    elif identity == "kimi":
        assert sent["user-agent"] == anthropic_adapter._attribution_headers()["User-Agent"]


def test_pasted_messages_url_selects_anthropic_catalog_auth(endpoint):
    endpoint.routes["GET", "/tenant/v1/models"] = 200, {"data": [{"id": "fixture-model"}]}, "application/json"
    endpoint.routes["POST", "/tenant/v1/responses"] = 401, {"error": {"type": "authentication_error"}}, "application/json"
    endpoint.routes["POST", "/tenant/v1/messages"] = completed_reply("anthropic_messages")
    result = validate(endpoint.base + "/messages")
    assert result["ok"] and result["detected_api_mode"] == "anthropic_messages", result
    assert endpoint.requests[0][2].get("x-api-key") == "fixture-key"
    assert [path for method, path, _, _ in endpoint.requests if method == "POST"] == ["/tenant/v1/messages"]


@pytest.mark.parametrize("status", [200, 400])
def test_catalog_error_envelope_is_not_a_model_catalog_or_reason_to_replay(endpoint, status):
    endpoint.routes["GET", "/tenant/v1/models"] = status, {"error": {"code": "insufficient_quota"}}, "application/json"
    endpoint.routes["GET", "/tenant/models"] = 200, {"data": [{"id": "fixture-model"}]}, "application/json"
    endpoint.routes["POST", "/tenant/v1/responses"] = completed_reply("codex_responses")
    result = validate(endpoint.base)
    assert result["ok"] is False, result
    assert len(endpoint.requests) == 1


@pytest.mark.parametrize("final_output", [[], [{"type": "message", "role": "assistant", "status": "in_progress"}]])
def test_responses_final_payload_must_confirm_the_completed_reply(endpoint, final_output):
    item = {"id": "msg-fixture", "type": "message", "role": "assistant", "status": "completed",
            "content": [{"type": "output_text", "text": "OK"}]}
    endpoint.routes["POST", "/tenant/v1/responses"] = sse_reply([
        {"type": "response.output_item.done", "item": item},
        {"type": "response.completed", "response": {
            "id": "resp-fixture", "status": "completed", "output": final_output}},
    ])
    result = validate(endpoint.base)
    assert result["ok"] is False, result


@pytest.mark.parametrize("mode, route", [
    ("codex_responses", "responses"), ("chat_completions", "chat/completions"),
    ("anthropic_messages", "messages"),
])
@pytest.mark.parametrize("status", [200, 400, 401, 429])
def test_explicit_mode_without_typed_model_requires_completed_reply(endpoint, mode, route, status):
    endpoint.routes["GET", "/tenant/v1/models"] = 200, {"data": [{"id": "fixture-model"}]}, "application/json"
    endpoint.routes["POST", "/tenant/v1/" + route] = status, {"error": {"type": "insufficient_quota"}}, "application/json"
    result = validate(endpoint.base, model="", api_mode=mode)
    assert result["ok"] is False, result
    assert not result.get("detected_api_mode")
    assert [path for method, path, _, _ in endpoint.requests if method == "POST"] == ["/tenant/v1/" + route]

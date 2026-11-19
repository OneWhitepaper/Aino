"""Automatic transport selection proves inference, not a URL guess or HTTP 200."""

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest
import httpx

from agent.transports.aino_code.relay import CodeModelRoute
from hermes_cli.runtime_provider import resolve_runtime_provider
from hermes_cli.web_models import CustomEndpointUpdate
from hermes_cli.web_routers.config_env import upsert_custom_endpoint, validate_custom_endpoint


@pytest.fixture
def protocol_endpoint():
    settings = {"responses": "complete", "chat/completions": 404, "messages": 404, "models": 200}
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, body, content_type="application/json"):
            data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self.reply(settings["models"], {"data": [] if settings.get("empty_catalog") else [{"id": "fixture-model"}]})

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            route = self.path.removeprefix("/v1/")
            seen.append((route, payload, dict(self.headers)))
            value = settings.get(route, 404)
            if isinstance(value, int):
                self.reply(value, {"error": {"message": "secret-fixture-key MUST NOT appear in diagnostics"}})
            elif value == "html":
                self.reply(200, "<html>login</html>", "text/html")
            elif route == "responses":
                if value == "nested-json":
                    self.reply(200, 'data: {"type":"response.output_item.done","item":'
                               + '[' * 2000 + '0' + ']' * 2000 + '}\n\n', "text/event-stream")
                    return
                item = {"id": "msg-fixture", "type": "message", "role": "assistant",
                        "content": [{"type": "output_text", "text": "OK"}], "status": "completed"}
                if value == "malformed-item":
                    item = {"content": [{"text": "OK"}]}
                elif value == "user-item":
                    item["role"] = "user"
                elif value == "list-text":
                    item["content"][0]["text"] = [{"text": "OK"}]
                events = [{"type": "response.output_item.done", "item": item, "output_index": 0}]
                if value == "invalid-type":
                    events = [{"type": []}]
                if value != "incomplete":
                    events.append({"type": "response.completed", "response": {
                        "id": "resp-fixture", "object": "response", "status": "completed", "output": [item]}})
                newline = settings.get("newline", "\r\n")
                self.reply(200, "".join("data: " + json.dumps(event) + newline * 2 for event in events),
                           "text/event-stream")
            elif route == "chat/completions":
                self.reply(200, {"id": "chatcmpl-fixture", "object": "chat.completion", "choices": [{
                    "message": {"role": "assistant", "content": "OK"}, "finish_reason": "stop"}]})
            else:
                self.reply(200, {"id": "msg-fixture", "type": "message", "role": "assistant",
                    "content": [{"type": "text", "text": "OK"}], "stop_reason": "end_turn"})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", settings, seen
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def probe(base, **overrides):
    return asyncio.run(validate_custom_endpoint(CustomEndpointUpdate(**{
        "name": "Fixture", "base_url": base, "api_key": "secret-fixture-key",
        "model": "fixture-model", "api_mode": "", **overrides})))


@pytest.mark.parametrize("available, expected", [
    ({"chat/completions": "complete"}, "codex_responses"),
    ({"responses": 405, "chat/completions": "complete"}, "chat_completions"),
    ({"responses": "incomplete", "chat/completions": "complete"}, "chat_completions"),
    ({"responses": 404, "messages": "complete"}, "anthropic_messages"),
])
def test_auto_detects_actual_model_protocol_and_saved_route_uses_it(protocol_endpoint, available, expected):
    base, settings, seen = protocol_endpoint
    settings.update(available)
    result = probe(base)
    assert result["ok"] is True, result
    assert result.get("detected_api_mode") == expected, result
    assert all(body["model"] == "fixture-model" and not body.get("tools") for _, body, _ in seen)
    assert all("secret-fixture-key" not in value for value in result.values() if isinstance(value, str))
    upsert_custom_endpoint(CustomEndpointUpdate(name="Fixture", id="fixture", base_url=base,
        model="fixture-model", api_key="secret-fixture-key", api_mode=result["detected_api_mode"], make_default=True))
    runtime = resolve_runtime_provider(requested="fixture", target_model="fixture-model")
    assert runtime["api_mode"] == expected
    assert runtime["base_url"] == base and runtime["api_key"] == "secret-fixture-key"
    if expected == "codex_responses":
        route = CodeModelRoute.from_agent(SimpleNamespace(**(runtime | {"model": "fixture-model"})))
        assert route.base_url == base and route.model == "fixture-model"
        assert [path for path, _, _ in seen] == ["responses"]
    if expected == "anthropic_messages":
        assert seen[-1][2].get("x-api-key") == "secret-fixture-key"
        assert "Authorization" not in seen[-1][2]


@pytest.mark.parametrize("response", ["html", "incomplete", "invalid-type", "malformed-item", "user-item", "list-text", "nested-json", 400, 401, 403, 429, 502])
def test_unconfirmed_response_is_not_persistable_protocol_evidence(protocol_endpoint, response):
    base, settings, seen = protocol_endpoint
    settings["responses"] = response
    result = probe(base)
    assert result["ok"] is False, result
    assert not result.get("detected_api_mode")
    assert result["message"] and "secret-fixture-key" not in result["message"]
    assert result["models"] == ["fixture-model"]
    if response in (401, 403, 429):
        assert len(seen) == 1, "auth/rate limit failures must not fan out into more paid attempts"


@pytest.mark.parametrize("catalog", ["missing", "empty"])
def test_auto_can_verify_typed_model_when_catalog_is_not_exposed(protocol_endpoint, catalog):
    base, settings, _ = protocol_endpoint
    settings.update({"models": 404} if catalog == "missing" else {"empty_catalog": True})
    result = probe(base)
    assert result["ok"] is True, result
    assert result["detected_api_mode"] == "codex_responses"


def test_catalog_without_selected_model_does_not_claim_protocol_detection(protocol_endpoint):
    base, _, seen = protocol_endpoint
    result = probe(base, model="")
    assert result["ok"] is True and result["models"] == ["fixture-model"]
    assert not result.get("detected_api_mode")
    assert not seen, "do not send inference to an arbitrary first model from the catalog"


@pytest.mark.parametrize("newline", ["\n", "\r\n", "\r"])
def test_responses_detection_accepts_sse_line_endings(protocol_endpoint, newline):
    base, settings, _ = protocol_endpoint
    settings["newline"] = newline
    result = probe(base)
    assert result["ok"] and result.get("detected_api_mode") == "codex_responses", result


def test_explicit_protocol_is_not_replaced_by_a_different_supported_protocol(protocol_endpoint):
    base, _, seen = protocol_endpoint
    result = probe(base, api_mode="chat_completions")
    assert result["ok"] is False
    assert result["transport_checked"] == "chat_completions"
    assert [path for path, _, _ in seen] == ["chat/completions"]


def test_protocol_probe_bounds_sse_bytes_before_waiting_for_a_line(monkeypatch):
    from hermes_cli.web_routers import config_env

    consumed = []

    class OversizedLine(httpx.AsyncByteStream):
        async def __aiter__(self):
            for index in range(8):
                consumed.append(index)
                yield b"x" * (64 * 1024)

    def handler(request):
        if request.method == "GET":
            return httpx.Response(200, json={"data": [{"id": "fixture-model"}]})
        if request.url.path.endswith("/responses"):
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=OversizedLine())
        return httpx.Response(404)

    monkeypatch.setattr(config_env, "_endpoint_probe_client", lambda *_:
        httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    result = probe("http://fixture.test/v1")
    assert not result["ok"] and not result.get("detected_api_mode")
    assert len(consumed) <= 3, "the byte ceiling must apply before an SSE newline or EOF arrives"

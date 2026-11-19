"""Custom endpoint validation must authenticate like the saved model route."""

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


@pytest.fixture
def endpoint_server():
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, payload):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def authorized(self):
            if self.path.startswith("/anthropic/"):
                ok = (self.headers.get("x-api-key") == "endpoint-fixture-secret"
                      and bool(self.headers.get("anthropic-version"))
                      and not self.headers.get("Authorization"))
            else:
                ok = self.headers.get("Authorization") == "Bearer endpoint-fixture-secret"
            seen.append({"path": self.path, "method": self.command, "authorized": ok,
                         "credential_sent": bool(self.headers.get("Authorization") or self.headers.get("x-api-key"))})
            return ok

        def do_GET(self):
            if not self.authorized():
                self.reply(401, {"error": {"message": "missing required credential"}})
                return
            self.reply(200, {"object": "list", "data": [{"id": "audit-model", "object": "model"}]})

        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            if not self.authorized():
                self.reply(401, {"error": {"message": "missing required credential"}})
                return
            if self.path not in ("/bearer/v1/chat/completions", "/anthropic/v1/messages"):
                self.reply(404, {"error": {"message": "unknown route"}})
                return
            if self.path.startswith("/anthropic/"):
                self.reply(200, {"id": "msg-audit", "type": "message", "role": "assistant",
                    "model": "audit-model", "content": [{"type": "text", "text": "ok"}],
                    "stop_reason": "end_turn", "stop_sequence": None,
                    "usage": {"input_tokens": 1, "output_tokens": 1}})
            else:
                self.reply(200, {"id": "chatcmpl-audit", "object": "chat.completion", "created": 0,
                    "model": "audit-model", "choices": [{"index": 0, "finish_reason": "stop",
                    "message": {"role": "assistant", "content": "ok"}}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", seen
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def configured_endpoint(monkeypatch, base_url, mode):
    from hermes_cli.web_routers import config_env
    from hermes_cli.web_models import CustomEndpointUpdate
    from hermes_cli.runtime_provider import resolve_runtime_provider

    monkeypatch.setattr(config_env, "_record_custom_endpoint_setup", lambda *_args: None)
    result = config_env.upsert_custom_endpoint(CustomEndpointUpdate(
        id="probe", name="Probe", base_url=base_url, model="audit-model",
        api_key="endpoint-fixture-secret", api_mode=mode))
    assert result["ok"]
    runtime = resolve_runtime_provider(requested="probe", target_model="audit-model")
    assert runtime["base_url"] == base_url
    assert runtime["api_mode"] == mode
    return CustomEndpointUpdate, config_env, runtime


def test_saved_key_connection_test_matches_working_model_request(monkeypatch, endpoint_server):
    from openai import OpenAI

    root, seen = endpoint_server
    base = root + "/bearer/v1"
    Body, routes, runtime = configured_endpoint(monkeypatch, base, "chat_completions")
    with OpenAI(api_key=runtime["api_key"], base_url=base, max_retries=0, timeout=3) as client:
        reply = client.chat.completions.create(model="audit-model", messages=[{"role": "user", "content": "hi"}])
        assert reply.choices[0].message.content == "ok"
    result = asyncio.run(routes.validate_custom_endpoint(Body(
        id="probe", name="Probe", base_url=base, model="audit-model",
        api_mode="chat_completions")))
    assert result["ok"] is True, {"validation": result, "requests": seen}
    assert all(request["authorized"] for request in seen)


@pytest.mark.parametrize("api_key", [None, "endpoint-fixture-secret"])
def test_anthropic_connection_test_uses_working_protocol_auth(monkeypatch, endpoint_server, api_key):
    from agent.anthropic_adapter import build_anthropic_client

    root, seen = endpoint_server
    base = root + "/anthropic/v1"
    Body, routes, runtime = configured_endpoint(monkeypatch, base, "anthropic_messages")
    with build_anthropic_client(api_key=runtime["api_key"], base_url=base, timeout=3) as client:
        reply = client.messages.create(model="audit-model", max_tokens=1,
            messages=[{"role": "user", "content": "hi"}])
        assert reply.content[0].text == "ok"
    result = asyncio.run(routes.validate_custom_endpoint(Body(
        id="probe", name="Probe", base_url=base, model="audit-model",
        api_mode="anthropic_messages", api_key=api_key)))
    assert result["ok"] is True, {"validation": result, "requests": seen}
    assert all(request["authorized"] for request in seen)


def test_explicit_bearer_key_validation_control(monkeypatch, endpoint_server):
    root, _seen = endpoint_server
    base = root + "/bearer/v1"
    Body, routes, _runtime = configured_endpoint(monkeypatch, base, "chat_completions")
    result = asyncio.run(routes.validate_custom_endpoint(Body(
        id="probe", name="Probe", base_url=base, model="audit-model",
        api_mode="chat_completions", api_key="endpoint-fixture-secret")))
    assert result["ok"] is True


@pytest.mark.parametrize("profile", [None, "secondary"])
@pytest.mark.parametrize("api_mode", ["", "chat_completions"])
@pytest.mark.parametrize("storage", ["key_env", "api_ref", "legacy", "direct", "builtin_name", "inline_and_env"])
def test_saved_credential_follows_the_requested_profile(endpoint_server, profile, storage, api_mode):
    from starlette.testclient import TestClient
    from hermes_constants import get_hermes_home
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from hermes_cli.web_server_profiles import _config_profile_scope

    root, seen = endpoint_server
    base = root + "/bearer/v1"
    main_home = get_hermes_home()
    selected_home = main_home if profile is None else main_home / "profiles" / profile
    selected_home.mkdir(parents=True, exist_ok=True)
    entry = {"name": "Probe", "base_url": base, "model": "audit-model", "key_env": "PROBE_API_KEY"}
    endpoint_id, config = {
        "key_env": ("probe", {"model": {}, "providers": {"probe": entry}}),
        "api_ref": ("probe", {"model": {}, "providers": {"probe": {
            **entry, "key_env": "", "api_key": "${PROBE_API_KEY}"}}}),
        "legacy": ("probe", {"model": {}, "custom_providers": [entry]}),
        "direct": ("custom", {"model": {**entry, "provider": "custom", "default": "audit-model"}}),
        "builtin_name": ("openai", {"model": {}, "providers": {"openai": entry}}),
        "inline_and_env": ("probe", {"model": {}, "providers": {"probe": {
            **entry, "api_key": "endpoint-fixture-secret"}}}),
    }[storage]
    (main_home / ".env").write_text("PROBE_API_KEY=wrong-profile-fixture\n")
    (main_home / "config.yaml").write_text(json.dumps(config))
    env_key = "other-env-fixture-secret" if storage == "inline_and_env" else "endpoint-fixture-secret"
    (selected_home / ".env").write_text(f"PROBE_API_KEY={env_key}\n")
    (selected_home / "config.yaml").write_text(json.dumps(config))

    # The runtime's pool can select an inline credential before key_env. The probe
    # must reuse that resolver, rather than inventing its own credential precedence.
    with _config_profile_scope(profile):
        runtime = resolve_runtime_provider(
            requested="custom" if storage == "direct" else f"custom:{endpoint_id}", target_model="audit-model")
        assert runtime["api_key"] == "endpoint-fixture-secret"

    client = TestClient(app)
    try:
        response = client.post("/api/providers/custom-endpoints/validate",
            headers={_SESSION_HEADER_NAME: _SESSION_TOKEN}, params={"profile": profile} if profile else {},
            json={"id": endpoint_id, "name": "Probe", "base_url": base, "model": "audit-model",
                  "api_mode": api_mode})
    finally:
        client.close()
    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True, {"result": response.json(), "requests": seen}
    if not api_mode:
        assert response.json()["detected_api_mode"] == "chat_completions"
    assert "endpoint-fixture-secret" not in response.text


@pytest.mark.parametrize("change", ["origin", "id", "explicit_empty", "replacement"])
def test_probe_never_borrows_a_saved_key_for_another_target(monkeypatch, endpoint_server, change):
    root, seen = endpoint_server
    base = root + "/bearer/v1"
    Body, routes, _runtime = configured_endpoint(monkeypatch, base, "chat_completions")
    overrides = {
        "origin": {"base_url": base.replace("127.0.0.1", "localhost")},
        "id": {"id": "new-endpoint"},
        "explicit_empty": {"api_key": ""},
        "replacement": {"api_key": "replacement-fixture-secret"},
    }[change]
    result = asyncio.run(routes.validate_custom_endpoint(Body(**{
        "id": "probe", "name": "Probe", "base_url": base, "model": "audit-model",
        "api_mode": "chat_completions", **overrides})))
    assert result["ok"] is False
    assert seen and all(not request["authorized"] for request in seen)
    assert all(request["credential_sent"] == (change == "replacement") for request in seen)


def test_saved_pool_credential_uses_the_same_runtime_resolution(endpoint_server):
    from starlette.testclient import TestClient
    from hermes_cli.config import load_config, save_config
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from hermes_cli.web_models import CustomEndpointUpdate
    from hermes_cli.web_routers.config_env import validate_custom_endpoint

    root, seen = endpoint_server
    base = root + "/bearer/v1"
    cfg = load_config()
    cfg["providers"] = {"probe": {"name": "Probe", "base_url": base, "model": "audit-model"}}
    save_config(cfg)
    client = TestClient(app)
    try:
        response = client.post("/api/credentials/pool", headers={_SESSION_HEADER_NAME: _SESSION_TOKEN},
            json={"provider": "probe", "api_key": "endpoint-fixture-secret"})
    finally:
        client.close()
    assert response.status_code == 200, response.text
    assert resolve_runtime_provider(requested="custom:probe")["api_key"] == "endpoint-fixture-secret"

    result = asyncio.run(validate_custom_endpoint(CustomEndpointUpdate(
        id="probe", name="Probe", base_url=base, model="audit-model")))
    assert result["ok"] is True, {"validation": result, "requests": seen}
    assert all(request["authorized"] for request in seen)

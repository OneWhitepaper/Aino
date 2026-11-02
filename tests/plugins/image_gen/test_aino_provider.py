"""Aino reuses the image tool with a separate, session-bound image lease."""

import base64
import importlib
import json
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest


PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082")


@pytest.fixture
def rig(tmp_path, monkeypatch):
    from agent.auxiliary_billing_scope import BillingScope, billing_scope
    from tui_gateway.managed_model_runtime import ManagedModelOwner

    (tmp_path / "config.yaml").write_text(json.dumps({
        "image_gen": {"provider": "aino", "model": "image-catalog-id"}}))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    token = billing_scope.set(BillingScope("aino", "account-1", str(uuid4()), str(uuid4()), "chat"))
    binding = SimpleNamespace(
        session_id="image-session", owner=ManagedModelOwner("https://aino.invalid", "account-1"),
        model_id="image-catalog-id", model="upstream-image", api_mode="images_generations",
        capabilities={"tools": False, "vision": False, "reasoning": False, "image_generation": True},
        credential_id="image-lease", api_key="image-secret", base_url="https://aino.invalid/v1",
        expires_at=datetime.now(UTC) + timedelta(minutes=5), binding_revision=7, purpose="image")
    try:
        yield SimpleNamespace(binding=binding, home=tmp_path, scope=billing_scope.get())
    finally:
        billing_scope.reset(token)


@contextmanager
def image_scope(binding):
    from tui_gateway.managed_image_runtime import managed_image_scope
    with managed_image_scope(lambda: binding):
        yield


def plugin():
    return importlib.import_module("plugins.image_gen.aino").AinoImageGenProvider()


def test_image_lease_drives_existing_tool_cache_and_billing(rig, monkeypatch):
    from agent.image_gen_registry import register_provider
    from tools.image_generation_tool import _handle_image_generate

    requests = []
    def serve(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}],
                                         "usage": {"input_tokens": 1, "output_tokens": 2}})
    monkeypatch.setattr("agent.process_bootstrap.build_keepalive_http_client",
                        lambda *_args, **_kwargs: httpx.Client(transport=httpx.MockTransport(serve)))
    provider = plugin()
    monkeypatch.setattr("tools.image_generation_tool._get_plugin_provider", lambda *_a, **_k: provider)
    register_provider(provider)
    with image_scope(rig.binding):
        result = json.loads(_handle_image_generate({"prompt": "一只橙色的小猫", "aspect_ratio": "square"}))
    assert result["success"] is True and result["provider"] == "aino"
    assert Path(result["image"]).read_bytes() == PNG
    assert Path(result["image"]).is_relative_to(rig.home / "cache" / "generated" / "images")
    assert len(requests) == 1
    request = requests[0]
    assert request.url.path == "/v1/images/generations"
    assert request.headers["authorization"] == "Bearer image-secret"
    assert request.headers["x-aino-purpose"] == "image"
    assert request.headers["x-aino-turn-id"] == rig.scope.turn_id
    assert json.loads(request.content) == {"model": "upstream-image", "prompt": "一只橙色的小猫",
                                           "size": "1024x1024", "n": 1}
    assert rig.scope.calls.snapshot()["calls"][0]["purpose"] == "image"
    assert "image-secret" not in json.dumps(result)


def test_missing_image_lease_never_falls_back_to_chat_or_nous(rig, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "unrelated-chat-key")
    monkeypatch.setenv("FAL_KEY", "unrelated-fal-key")
    with image_scope(None):
        result = plugin().generate("一只猫")
    assert result["success"] is False
    assert result["error_type"] == "auth_required"
    assert "Aino" in result["error"]


@pytest.mark.parametrize("status", [402, 429, 500])
def test_billed_image_failure_is_not_retried_or_leaked(rig, monkeypatch, status):
    requests = []
    def serve(request):
        requests.append(request)
        return httpx.Response(status, json={"error": {"message": "image-secret internal upstream detail"}})
    monkeypatch.setattr("agent.process_bootstrap.build_keepalive_http_client",
                        lambda *_args, **_kwargs: httpx.Client(transport=httpx.MockTransport(serve)))
    with image_scope(rig.binding):
        result = plugin().generate("一只猫")
    assert result["success"] is False and len(requests) == 1
    assert "image-secret" not in json.dumps(result)
    assert "internal upstream detail" not in json.dumps(result)


def test_image_provider_rejects_model_override(rig):
    with image_scope(rig.binding):
        wrong_model = plugin().generate("一只猫", model="different-catalog-id")
    assert wrong_model["error_type"] == "model_unavailable"


def test_byok_chat_keeps_aino_image_charge_receipt(rig, monkeypatch):
    from agent.auxiliary_billing_scope import BillingScope, billing_scope
    from tui_gateway.managed_model_usage import current_usage_metadata

    token = billing_scope.set(BillingScope("turn", None, "byok-session", str(uuid4()), "chat"))
    def serve(_request):
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(PNG).decode()}]})
    monkeypatch.setattr("agent.process_bootstrap.build_keepalive_http_client",
                        lambda *_a, **_k: httpx.Client(transport=httpx.MockTransport(serve)))
    try:
        with image_scope(rig.binding):
            assert plugin().generate("一只猫")["success"] is True
        metadata = current_usage_metadata()
        assert metadata["billing"]["user_id"] == "account-1"
        assert metadata["billing"]["calls"][0]["purpose"] == "image"
        assert metadata["non_aino_model_calls"] is True
    finally:
        billing_scope.reset(token)

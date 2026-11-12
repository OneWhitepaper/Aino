"""Device identities retain private binding scope without a lease deadline."""

from dataclasses import replace
import time

import httpx
import pytest

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential
from tui_gateway.managed_model_runtime import ManagedBindingError, ManagedModelRegistry, resolve_managed_runtime
from tui_gateway.methods_managed_model import _binding


def device_payload():
    return {
        "owner": {"platform_origin": "https://aino.invalid", "user_id": "account"},
        "model_id": "image-subscription-chat",
        "model": "actual-model",
        "api_mode": "chat_completions",
        "capabilities": {"tools": True, "vision": False, "reasoning": False},
        "credential_id": "device-record",
        "credential_type": "device",
        "credential_version": 1,
        "api_key": "private-device-secret",
        "base_url": "https://aino.invalid/v1",
        "expires_at": None,
        "binding_revision": 1,
    }


def test_device_binding_keeps_identity_and_capacity_after_twenty_four_hours():
    binding = _binding(device_payload(), "sid")
    runtime = resolve_managed_runtime(binding, now=time.time() + 24 * 3600)
    assert runtime["api_key"] == "private-device-secret"
    assert runtime["model"] == "actual-model"
    registry = ManagedModelRegistry()
    peer, controller = object(), object()
    session = {"transport": peer, "managed_model_params": {
        "model_id": binding.model_id, "platform_owner": {
            "platform_origin": binding.owner.platform_origin, "user_id": binding.owner.user_id}}}
    try:
        ticket = registry.issue("sid", session, peer, binding.owner, binding.model_id)
        revision = registry.claim("sid", session, controller, ticket, binding.owner, binding.model_id)
        bound = replace(binding, binding_revision=revision)
        registry.bind(bound, session, controller)
        assert registry.get("sid", session) is bound
        assert registry._active[("sid", "chat")].timer is None
        assert registry.get("sid", {**session}) is None
    finally:
        registry.clear_session("sid")


@pytest.mark.parametrize("change", [{"credential_type": "lease"}, {"credential_type": "unknown"}])
def test_null_expiration_does_not_upgrade_legacy_or_unknown_credentials(change):
    with pytest.raises(ManagedBindingError):
        _binding(device_payload() | change, "sid")


def test_device_key_catalog_identity_survives_auxiliary_and_delegated_requests():
    credential = ManagedCredential(lambda: "secret", "account", "session", "actual-model",
                                   "https://aino.invalid/v1", "chat_completions", False,
                                   scope=BillingScope("aino", "account", "session", "turn", "chat"),
                                   model_id="selected-subscription-option")
    for task in ("chat", "compression", "title_generation", "delegation"):
        request = httpx.Request("POST", "https://aino.invalid/v1/chat/completions",
                                json={"model": "actual-model"},
                                headers={"X-Aino-Model-ID": "untrusted-cheaper-option"})
        credential.for_task(task).prepare_request(request)
        assert request.headers["X-Aino-Model-ID"] == "selected-subscription-option"
        assert request.headers["Authorization"] == "Bearer secret"


def test_permanent_image_binding_resolves_only_inside_its_live_turn():
    from agent.managed_image_provider import current_image_binding, managed_image_scope

    binding = _binding(device_payload() | {
        "purpose": "image", "api_mode": "images_generations",
        "capabilities": {"tools": False, "vision": False, "reasoning": False, "image_generation": True},
    }, "sid")
    with managed_image_scope(lambda: binding):
        assert current_image_binding() is binding
    assert current_image_binding() is None

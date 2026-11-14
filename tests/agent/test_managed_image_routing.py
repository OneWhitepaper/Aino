"""Session-managed image capabilities come from the authenticated model binding."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from agent import image_routing
from agent.auxiliary_billing_scope import ManagedCredential
from agent.auxiliary_client import scoped_runtime_main
from tools.vision_tools import _native_tool_result_images


def managed_runtime(vision, user_id="account-a", model="managed-vision-model"):
    def unused_key():
        raise AssertionError("A capability check must not resolve credentials")

    key = ManagedCredential(
        unused_key, user_id, "session-" + user_id, model,
        "https://inference.example.invalid/v1", "chat_completions", vision,
    )
    return {"provider": "aino", "model": model, "base_url": key.base_url, "api_key": key}


@pytest.fixture(autouse=True)
def no_external_capability_probes(monkeypatch):
    # These models are intentionally absent from vendor catalogs; the binding is authoritative.
    monkeypatch.setattr(image_routing, "_VISION_PROBES", ())


@pytest.mark.parametrize("vision", [True, False])
def test_managed_binding_controls_user_and_tool_image_routing(vision):
    runtime = managed_runtime(vision)
    with scoped_runtime_main(runtime):
        assert image_routing._lookup_supports_vision("aino", runtime["model"], {}) is vision
        assert image_routing.decide_image_input_mode("aino", runtime["model"], {}) == (
            "native" if vision else "text"
        )
        assert _native_tool_result_images("aino", runtime["model"], {}) is vision


@pytest.mark.parametrize("vision", [True, False])
def test_previous_byok_capability_cannot_override_managed_binding(vision):
    runtime = managed_runtime(vision)
    cfg = {"model": {"provider": "custom", "supports_vision": not vision}}
    with scoped_runtime_main(runtime):
        assert image_routing._lookup_supports_vision("aino", runtime["model"], cfg) is vision


@pytest.mark.parametrize("provider,model", [
    ("other-provider", "managed-vision-model"),
    ("aino", "different-model"),
])
def test_managed_capability_does_not_leak_to_another_route(provider, model):
    with scoped_runtime_main(managed_runtime(True)):
        assert image_routing._lookup_supports_vision(provider, model, {}) is None


@pytest.mark.parametrize("runtime", [
    {},
    {"provider": "aino", "model": "managed-vision-model", "api_key": "unmanaged-key"},
    {**managed_runtime(True), "provider": "custom"},
    {**managed_runtime(True), "model": "other-model"},
])
def test_missing_or_mismatched_binding_preserves_unknown(runtime):
    with scoped_runtime_main(runtime):
        assert image_routing._lookup_supports_vision("aino", "managed-vision-model", {}) is None


@pytest.mark.parametrize("cfg,expected", [
    ({"agent": {"image_input_mode": "text"}}, "text"),
    ({"agent": {"image_input_mode": "native"}}, "native"),
    ({"auxiliary": {"vision": {"provider": "custom", "model": "vision-helper"}}}, "text"),
])
def test_explicit_image_routing_strategy_still_wins(cfg, expected):
    with scoped_runtime_main(managed_runtime(True)):
        assert image_routing.decide_image_input_mode("aino", "managed-vision-model", cfg) == expected


def test_false_capability_still_blocks_tool_images_in_forced_native_mode():
    with scoped_runtime_main(managed_runtime(False)):
        cfg = {"agent": {"image_input_mode": "native"}}
        assert not _native_tool_result_images("aino", "managed-vision-model", cfg)


def test_concurrent_accounts_keep_their_own_capabilities():
    barrier = Barrier(2)

    def route(user_id, vision):
        with scoped_runtime_main(managed_runtime(vision, user_id)):
            barrier.wait(timeout=5)
            return image_routing.decide_image_input_mode("aino", "managed-vision-model", {})

    with scoped_runtime_main({}), ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(route, "account-a", True)
        second = pool.submit(route, "account-b", False)
        assert first.result(timeout=5) == "native"
        assert second.result(timeout=5) == "text"
        assert image_routing._lookup_supports_vision("aino", "managed-vision-model", {}) is None

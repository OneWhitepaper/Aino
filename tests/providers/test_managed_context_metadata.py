"""A managed credential's metadata stays with its exact authenticated model route."""

from types import SimpleNamespace

from agent.auxiliary_billing_scope import ManagedCredential
from providers.base import ProviderProfile


def test_managed_profile_reads_live_route_metadata_without_resolving_a_secret():
    limit = [128_000]

    def unexpected_key():
        raise AssertionError("Metadata lookup must not resolve a credential")

    credential = ManagedCredential(
        unexpected_key, "owner", "session", "model", "https://aino.invalid/v1", "chat_completions", False,
        get_context_window=lambda: limit[0],
    )
    managed = ProviderProfile(name="managed-test", auth_type="session_managed")
    assert managed.get_model_context_length("model", base_url="https://aino.invalid/v1/", api_key=credential) == 128_000
    limit[0] = 256_000
    assert managed.get_model_context_length("model", base_url="https://aino.invalid/v1", api_key=credential) == 256_000
    assert managed.get_model_context_length("another", base_url="https://aino.invalid/v1", api_key=credential) is None
    assert managed.get_model_context_length("model", base_url="https://foreign.invalid/v1", api_key=credential) is None
    assert managed.get_model_context_length("model", base_url="https://aino.invalid/v1", api_key="plain") is None
    impostor = SimpleNamespace(model="model", base_url="https://aino.invalid/v1", get_context_window=unexpected_key)
    assert managed.get_model_context_length("model", base_url="https://aino.invalid/v1", api_key=impostor) is None
    for name in ("unknown", "openai", "custom"):
        ordinary = ProviderProfile(name=name)
        assert ordinary.get_model_context_length("model", base_url="https://aino.invalid/v1", api_key=credential) is None

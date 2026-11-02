"""An official provider and a saved endpoint with its name remain independent routes."""

import json
from types import SimpleNamespace

import pytest

from hermes_cli import inventory, model_switch_providers, providers


def _saved_provider():
    return {
        "deepseek": {
            "name": "DeepSeek",
            "api": "https://relay.example/v1",
            "key_env": "SAVED_DEEPSEEK_KEY",
            "models": ["saved-model"],
            "discover_models": False,
            "extra_headers": {"X-Saved-Endpoint": "saved-header"},
        },
    }


def _build(current_provider=""):
    return model_switch_providers._PickerBuild(
        current_provider=current_provider, current_base_url="", current_model="", max_models=None,
        for_picker=False, force_fresh_nous_tier=False, probe_custom_providers=False,
        probe_current_custom_provider=False, refresh=False, excluded=set(), curated={},
    )


def test_catalog_retains_official_and_saved_endpoint_with_separate_selection(monkeypatch):
    monkeypatch.setattr(model_switch_providers._PickerBuild, "discover_endpoint", lambda *a, **kw: (None, False, False))
    b = _build("deepseek")
    b.add_builtin_row("deepseek", "DeepSeek", True, ["official-model"], "built-in")

    model_switch_providers._lap_user_provider_rows(b, _saved_provider())
    inventory._apply_custom_aliases(b.results)

    official, saved = b.results
    assert (official["slug"], official["models"], official["is_current"]) == ("deepseek", ["official-model"], True)
    assert (saved["slug"], saved["models"], saved["is_current"]) == ("custom:deepseek", ["saved-model"], False)
    assert "deepseek" not in saved["aliases"]
    assert "custom:deepseek" in saved["aliases"]


def test_unconfigured_official_row_is_not_suppressed_by_saved_endpoint(monkeypatch):
    monkeypatch.setattr(model_switch_providers._PickerBuild, "discover_endpoint", lambda *a, **kw: (None, False, False))
    b = _build("custom:deepseek")
    model_switch_providers._lap_user_provider_rows(b, _saved_provider())
    ctx = inventory.ConfigContext("custom:deepseek", "saved-model", "https://relay.example/v1", _saved_provider(), [])
    skeletons = inventory._append_unconfigured_rows(b.results, ctx)

    assert b.results[0]["slug"] == "custom:deepseek"
    assert b.results[0]["is_current"] is True
    assert any(row["slug"] == "deepseek" for row in skeletons)


@pytest.mark.parametrize("has_endpoint", [True, False])
def test_official_models_accept_metadata_extensions_but_not_saved_endpoint_models(monkeypatch, has_endpoint):
    from hermes_cli.auth import PROVIDER_REGISTRY
    config = _saved_provider()
    if not has_endpoint:
        config["deepseek"].pop("api")
    monkeypatch.setattr(model_switch_providers, "_iter_builtin_candidates", lambda *a: [
        ("deepseek", "deepseek", PROVIDER_REGISTRY["deepseek"], ("DEEPSEEK_API_KEY",)),
    ])
    monkeypatch.setattr(model_switch_providers, "_any_env", lambda *a: True)
    monkeypatch.setattr(model_switch_providers, "_live_or_curated_ids", lambda *a, **kw: ["official-model"])
    monkeypatch.setattr("agent.models_dev.get_provider_info", lambda *a: SimpleNamespace(name="DeepSeek"))
    b = _build()

    model_switch_providers._lap_builtin_rows(b, {}, config)

    assert ("saved-model" in b.results[0]["models"]) is (not has_endpoint)
    assert "official-model" in b.results[0]["models"]


@pytest.mark.parametrize("provider,url,expected", [
    ("deepseek", "https://api.deepseek.com/v1", True),
    ("deepseek", "https://relay.example/v1", False),
    ("custom:deepseek", "https://relay.example/v1", True),
])
def test_route_ownership_matches_official_and_saved_identity(provider, url, expected):
    from hermes_cli.config import get_compatible_custom_providers
    from hermes_cli.route_identity import provider_owns_route

    config = {"providers": _saved_provider()}
    config["custom_providers"] = get_compatible_custom_providers(config)
    assert provider_owns_route(provider, url, config) is expected


@pytest.mark.parametrize("surface", ["runtime", "switch"])
def test_resolver_matches_runtime_for_official_and_saved_credentials(tmp_path, monkeypatch, surface):
    from hermes_cli.config import get_compatible_custom_providers
    from hermes_cli.runtime_provider import resolve_runtime_provider

    home = tmp_path / "identity-home"
    home.mkdir()
    config = {"model": {"provider": "custom:deepseek", "default": "saved-model"}, "providers": _saved_provider()}
    (home / "config.yaml").write_text(json.dumps(config))
    (home / ".env").write_text("DEEPSEEK_API_KEY=official-secret\nSAVED_DEEPSEEK_KEY=saved-secret\n")
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("SAVED_DEEPSEEK_KEY", "saved-secret")
    custom = get_compatible_custom_providers(config)

    official_definition = providers.resolve_provider_full("deepseek", config["providers"], custom)
    saved_definition = providers.resolve_provider_full("custom:deepseek", config["providers"], custom)
    assert official_definition.source != "user-config"
    assert saved_definition.source == "user-config"
    assert saved_definition.id == "custom:deepseek"
    def resolve(provider, model):
        if surface == "runtime":
            return resolve_runtime_provider(requested=provider, target_model=model)
        from hermes_cli.model_switch import switch_model
        result = switch_model(model, current_provider="openrouter", current_model="old",
                              explicit_provider=provider, user_providers=config["providers"], custom_providers=custom)
        assert result.success, result.error_message
        return {"base_url": result.base_url, "api_key": result.api_key}

    monkeypatch.setattr("hermes_cli.model_switch.resolve_alias", lambda *_a, **_k: None)
    monkeypatch.setattr("hermes_cli.model_switch.list_provider_models", lambda *_a, **_k: [])
    validations = []
    def validate(_model, provider, **kwargs):
        validations.append((provider, kwargs.get("headers") or {}))
        return {"accepted": True, "persist": True, "recognized": True}
    monkeypatch.setattr("hermes_cli.models_validate.validate_requested_model", validate)
    monkeypatch.setattr("hermes_cli.model_switch.get_model_info", lambda *_a, **_k: None)
    monkeypatch.setattr("hermes_cli.model_switch.get_model_capabilities", lambda *_a, **_k: None)
    official = resolve("deepseek", "official-model")
    saved = resolve("custom:deepseek", "saved-model")
    assert (official["base_url"], official["api_key"]) == ("https://api.deepseek.com/v1", "official-secret")
    assert (saved["base_url"], saved["api_key"]) == ("https://relay.example/v1", "saved-secret")
    if surface == "switch":
        assert validations == [("deepseek", {}), ("custom:deepseek", {"X-Saved-Endpoint": "saved-header"})]


@pytest.mark.parametrize("provider,accepted", [("deepseek", False), ("custom:deepseek", True)])
def test_rejected_official_model_does_not_borrow_saved_catalog(monkeypatch, provider, accepted):
    from hermes_cli.config import get_compatible_custom_providers
    from hermes_cli.model_switch import switch_model

    monkeypatch.setattr("hermes_cli.model_switch.resolve_alias", lambda *_a, **_k: None)
    monkeypatch.setattr("hermes_cli.model_switch.list_provider_models", lambda *_a, **_k: [])
    monkeypatch.setattr("hermes_cli.models_validate.validate_requested_model", lambda *_a, **_k: {
        "accepted": False, "persist": False, "recognized": False, "message": "model unavailable"})
    monkeypatch.setattr("hermes_cli.model_switch.get_model_info", lambda *_a, **_k: None)
    monkeypatch.setattr("hermes_cli.model_switch.get_model_capabilities", lambda *_a, **_k: None)
    monkeypatch.setattr("hermes_cli.runtime_provider.resolve_runtime_provider", lambda **_k: {
        "api_key": "fixture-key", "base_url": "https://api.deepseek.com/v1", "api_mode": "chat_completions"})
    user = _saved_provider()
    result = switch_model("saved-model", current_provider="openrouter", current_model="old",
                          explicit_provider=provider, user_providers=user,
                          custom_providers=get_compatible_custom_providers({"providers": user}))
    assert result.success is accepted

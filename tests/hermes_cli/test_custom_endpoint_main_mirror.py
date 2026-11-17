"""Editing an active endpoint keeps its main-route mirror and credential ownership together."""

import pytest


def _configured_endpoint(monkeypatch, provider="probe", main_provider="probe", main_url=None):
    from hermes_cli.config import custom_endpoint_key_env, load_config, save_config, save_env_value
    from hermes_cli.model_switch import ModelSwitchResult
    from hermes_cli.web_routers import config_env

    old_url = "https://old.example/v1"
    slot = custom_endpoint_key_env(provider)
    cfg = load_config()
    cfg["providers"] = {provider: {"name": provider, "base_url": old_url, "model": "entry-model", "key_env": slot}}
    cfg["model"] = {"provider": main_provider, "base_url": main_url or old_url,
                    "default": "active-model", "key_env": slot}
    save_config(cfg)
    save_env_value(slot, "old-endpoint-secret")
    monkeypatch.setattr(config_env, "_record_custom_endpoint_setup", lambda home: None)
    monkeypatch.setattr(config_env, "_validated_main_model_selection", lambda cfg, provider, model, base_url:
        ModelSwitchResult(success=True, new_model=model, target_provider=provider, base_url=base_url,
                          api_mode="chat_completions", is_global=True))
    return config_env, slot


@pytest.mark.parametrize("make_default", [False, True])
@pytest.mark.parametrize("key", ["replacement-secret", ""])
@pytest.mark.parametrize("endpoint,main_provider", [("probe", "probe"), ("Probe", "custom:probe"),
                                                   ("deepseek", "custom:deepseek")])
def test_edit_refreshes_the_active_named_endpoint_mirror(
        _isolate_hermes_home, monkeypatch, make_default, key, endpoint, main_provider):
    from hermes_cli.config import get_env_value, load_config
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from hermes_cli.web_models import CustomEndpointUpdate

    config_env, slot = _configured_endpoint(monkeypatch, endpoint, main_provider)
    response = config_env.upsert_custom_endpoint(CustomEndpointUpdate(
        id=endpoint, name=endpoint, base_url="https://new.example/v1", model="new-model",
        api_key=key, make_default=make_default))

    assert response["ok"] is True
    model = load_config()["model"]
    assert model["base_url"] == "https://new.example/v1"
    assert model["default"] == ("new-model" if make_default else "active-model")
    assert get_env_value(slot) == (key or None)
    assert bool(model.get("key_env")) == bool(key)
    runtime = resolve_runtime_provider()
    assert runtime["base_url"] == "https://new.example/v1"
    assert runtime["api_key"] == (key or "no-key-required")


@pytest.mark.parametrize("consumer", ["independent-model", "official-model", "fallback"])
def test_endpoint_edit_preserves_independent_secret_consumers(_isolate_hermes_home, monkeypatch, consumer):
    from fastapi import HTTPException

    from hermes_cli.config import get_env_value, load_config, save_config
    from hermes_cli.web_models import CustomEndpointUpdate

    endpoint = "deepseek" if consumer == "official-model" else "probe"
    main_url = "https://independent.example/v1" if consumer == "independent-model" else None
    config_env, slot = _configured_endpoint(monkeypatch, endpoint, endpoint, main_url)
    if consumer == "fallback":
        cfg = load_config()
        cfg["fallback_model"] = {"provider": "custom", "base_url": "https://fallback.example/v1", "key_env": slot}
        save_config(cfg)
    original = load_config()

    with pytest.raises(HTTPException) as error:
        config_env.upsert_custom_endpoint(CustomEndpointUpdate(
            id=endpoint, name=endpoint, base_url="https://new.example/v1", model="new-model",
            api_key="replacement-secret", make_default=consumer == "fallback"))

    assert error.value.status_code == 400
    assert get_env_value(slot) == "old-endpoint-secret"
    assert load_config() == original


def test_endpoint_edit_keeps_a_separate_main_credential(_isolate_hermes_home, monkeypatch):
    from hermes_cli.config import load_config, save_config, save_env_value
    from hermes_cli.web_models import CustomEndpointUpdate

    config_env, _ = _configured_endpoint(monkeypatch)
    cfg = load_config()
    cfg["model"]["key_env"] = "SEPARATE_MAIN_KEY"
    save_env_value("SEPARATE_MAIN_KEY", "separate-main-secret")
    save_config(cfg)
    original_main = cfg["model"].copy()

    config_env.upsert_custom_endpoint(CustomEndpointUpdate(
        id="probe", name="renamed", base_url="https://old.example/v1", model="new-model"))

    assert load_config()["model"] == original_main


def test_same_route_endpoint_edit_keeps_the_main_api_mode(_isolate_hermes_home, monkeypatch):
    from hermes_cli.config import load_config, save_config
    from hermes_cli.web_models import CustomEndpointUpdate

    config_env, _ = _configured_endpoint(monkeypatch)
    cfg = load_config()
    cfg["model"]["api_mode"] = "anthropic_messages"
    save_config(cfg)

    config_env.upsert_custom_endpoint(CustomEndpointUpdate(
        id="probe", name="renamed", base_url="https://old.example/v1", model="new-model",
        api_key="replacement-secret"))

    assert load_config()["model"]["api_mode"] == "anthropic_messages"

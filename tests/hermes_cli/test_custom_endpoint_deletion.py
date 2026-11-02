"""Deleting a saved endpoint removes its owned credentials without touching other routes."""

import json
from pathlib import Path

import pytest


@pytest.fixture
def client(monkeypatch, _isolate_hermes_home):
    from starlette.testclient import TestClient
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app

    monkeypatch.setattr("hermes_cli.observability.shared_metrics_setup.record_provider_setup_done", lambda *a, **k: None)
    monkeypatch.setattr("hermes_cli.model_cost_guard.expensive_model_warning", lambda *a, **k: None)
    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return client


def _credential(identity, source, url):
    return {"id": identity, "source": source, "auth_type": "api_key", "access_token": f"test-{identity}", "base_url": url}


def test_delete_clears_owned_pool_credentials_but_preserves_same_slug_official_account(client):
    from hermes_cli.auth import _load_auth_store, write_credential_pool
    from hermes_cli.config import custom_endpoint_key_env, get_env_value, load_config, save_config, save_env_value

    url = "https://api.deepseek.com/v1"
    key_env = custom_endpoint_key_env("deepseek")
    save_env_value(key_env, "test-custom-key")
    cfg = load_config()
    cfg["providers"] = {"deepseek": {"name": "deepseek", "base_url": url, "model": "custom-model", "key_env": key_env}}
    cfg["model"] = {"provider": "custom:deepseek", "base_url": url, "key_env": key_env, "default": "custom-model"}
    save_config(cfg)
    official = _credential("official", "env:DEEPSEEK_API_KEY", url)
    manual = _credential("official-manual", "manual", url)
    write_credential_pool("deepseek", [official, manual, _credential("custom-seed", "config:deepseek", url)])
    write_credential_pool("custom:deepseek", [
        _credential("legacy-custom", "config:deepseek", url),
        _credential("custom-manual", "manual", url),
        _credential("unrelated-route", "manual", "https://other.example/v1"),
    ])

    response = client.delete("/api/providers/custom-endpoints/deepseek")

    assert response.status_code == 200, response.text
    assert response.json()["endpoints"] == []
    cfg = load_config()
    assert "deepseek" not in cfg.get("providers", {})
    assert not cfg["model"].get("base_url")
    assert not get_env_value(key_env)
    pools = _load_auth_store()["credential_pool"]
    assert {row["id"] for row in pools["deepseek"]} == {"official", "official-manual"}
    assert {row["id"] for row in pools["custom:deepseek"]} == {"unrelated-route"}


def test_delete_same_slug_custom_endpoint_preserves_the_official_default(client):
    from hermes_cli.config import load_config, save_config, save_env_value, get_env_value

    cfg = load_config()
    cfg["providers"] = {"deepseek": {"name": "deepseek", "base_url": "https://proxy.example/v1", "model": "proxy-model"}}
    official = {"provider": "deepseek", "default": "official-model", "key_env": "DEEPSEEK_API_KEY"}
    cfg["model"] = official.copy()
    save_env_value("DEEPSEEK_API_KEY", "test-official-key")
    save_config(cfg)

    response = client.delete("/api/providers/custom-endpoints/deepseek")

    assert response.status_code == 200, response.text
    assert load_config()["model"] == official
    assert get_env_value("DEEPSEEK_API_KEY") == "test-official-key"


@pytest.mark.parametrize("shared_url", [False, True])
def test_delete_same_name_endpoint_prunes_only_its_unshared_route_credentials(client, shared_url):
    from hermes_cli.auth import _load_auth_store, write_credential_pool
    from hermes_cli.config import custom_endpoint_key_env, get_env_value, load_config, save_config, save_env_value

    removed_url = "https://removed.example/v1"
    retained_url = removed_url if shared_url else "https://retained.example/v1"
    removed_key = custom_endpoint_key_env("alpha")
    retained_key = custom_endpoint_key_env("beta")
    save_env_value(removed_key, "test-alpha-key")
    save_env_value(retained_key, "test-beta-key")
    cfg = load_config()
    cfg["providers"] = {
        "alpha": {"name": "Proxy", "base_url": removed_url, "model": "old-model", "key_env": removed_key},
        "beta": {"name": "Proxy", "base_url": retained_url, "model": "retained-model", "key_env": retained_key},
    }
    save_config(cfg)
    write_credential_pool("custom:proxy", [
        _credential("alpha-credential", "config:Proxy", removed_url),
        _credential("beta-credential", "config:Proxy", retained_url),
    ])

    response = client.delete("/api/providers/custom-endpoints/alpha")

    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()["endpoints"]} == {"beta"}
    assert not get_env_value(removed_key)
    assert get_env_value(retained_key) == "test-beta-key"
    expected = {"alpha-credential", "beta-credential"} if shared_url else {"beta-credential"}
    assert {row["id"] for row in _load_auth_store()["credential_pool"]["custom:proxy"]} == expected


@pytest.mark.parametrize("make_default", [False, True])
def test_saved_official_name_endpoint_activates_its_explicit_custom_route(client, make_default):
    from hermes_cli.config import load_config

    response = client.post("/api/providers/custom-endpoints", json={
        "id": "deepseek", "name": "deepseek", "base_url": "https://proxy.example/v1",
        "api_key": "test-custom-key", "model": "custom-model", "make_default": make_default,
    })
    assert response.status_code == 200, response.text
    if not make_default:
        response = client.post("/api/providers/custom-endpoints/deepseek/activate")
        assert response.status_code == 200, response.text
        assert response.json()["provider"] == "custom:deepseek"
    model = load_config()["model"]
    assert model["provider"] == "custom:deepseek"
    assert model["base_url"] == "https://proxy.example/v1"
    assert model["default"] == "custom-model"


@pytest.mark.parametrize("shared", [False, True, "template"])
def test_delete_legacy_endpoint_cleans_its_host_key_unless_another_route_uses_it(client, shared):
    from hermes_cli.config import custom_endpoint_key_env, get_env_value, load_config, save_config, save_env_value

    key_env = custom_endpoint_key_env("127.0.0.1_8001")
    url = "http://127.0.0.1:8001/v1"
    save_env_value(key_env, "test-legacy-key")
    cfg = load_config()
    cfg["custom_providers"] = [{"name": "Old Box", "base_url": url, "model": "old-model", "key_env": key_env}]
    cfg["model"] = {"provider": "custom", "base_url": url, "key_env": key_env, "default": "old-model"}
    if shared:
        key = {"api_key": f"${{{key_env}}}"} if shared == "template" else {"key_env": key_env}
        cfg["providers"] = {"other": {"name": "Other", "base_url": "https://other.example/v1", **key, "model": "other-model"}}
    save_config(cfg)

    response = client.delete("/api/providers/custom-endpoints/old-box")

    assert response.status_code == 200, response.text
    assert {row["id"] for row in response.json()["endpoints"]} == ({"other"} if shared else set())
    cfg = load_config()
    assert cfg.get("custom_providers") == []
    assert not cfg["model"].get("base_url")
    assert get_env_value(key_env) == ("test-legacy-key" if shared else None)


def test_profile_delete_never_removes_the_global_credential_fallback(client, monkeypatch, tmp_path):
    from hermes_cli import profiles

    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    root = tmp_path / ".hermes"
    root.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(root))
    url = "https://proxy.example/v1"
    endpoint = {"name": "Proxy", "base_url": url, "model": "model"}
    root_config = json.dumps({"providers": {"proxy": endpoint}})
    root_auth = json.dumps({"credential_pool": {"custom:proxy": [_credential("root-account", "config:Proxy", url)]}})
    root.joinpath("config.yaml").write_text(root_config, encoding="utf-8")
    root.joinpath("auth.json").write_text(root_auth, encoding="utf-8")
    worker = profiles.get_profile_dir("worker")
    worker.mkdir(parents=True)
    worker.joinpath("config.yaml").write_text(root_config, encoding="utf-8")

    response = client.delete("/api/providers/custom-endpoints/proxy?profile=worker")

    assert response.status_code == 200, response.text
    assert response.json()["endpoints"] == []
    assert root.joinpath("config.yaml").read_text(encoding="utf-8") == root_config
    assert root.joinpath("auth.json").read_text(encoding="utf-8") == root_auth

"""profiles.create inherits the launch profile's model together with the custom gateway backing it.

``_inherit_launch_model`` pins the launch ``model`` into the new profile through the same
validated path as ``/api/model/set``, and that validation runs inside the new profile's home. A
launch model on a custom ``providers:`` gateway is therefore only valid once the gateway
definition is already in the profile — writing it after the pin never ran (#101885 / #94071).
"""

from __future__ import annotations

from pathlib import Path

import hermes_yaml as yaml
import pytest

from hermes_cli.config import DEFAULT_CONFIG, atomic_config_write, read_user_config_raw
import tui_gateway.server as srv


@pytest.mark.parametrize(
    "schema,provider",
    [
        ("providers", "custom:my-gateway"),
        ("custom_providers", "custom:my-gateway"),
    ],
)
def test_inherit_launch_model_carries_a_custom_provider_gateway(
    monkeypatch, tmp_path, schema, provider
):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("FAKE_GW_TOKEN", "gw-FAKE-111")
    endpoint = {
        "name": "my-gateway",
        "base_url": "http://127.0.0.1:11434/v1",
        "api_key": "${FAKE_GW_TOKEN}",
    }
    unrelated = {"name": "unrelated", "base_url": "http://127.0.0.1:11435/v1"}
    catalog = (
        {"my-gateway": endpoint, "unrelated": unrelated}
        if schema == "providers"
        else [endpoint, unrelated]
    )
    atomic_config_write(
        home / "config.yaml",
        {
            "model": {"provider": provider, "default": "my-finetune"},
            schema: catalog,
            "_config_version": DEFAULT_CONFIG["_config_version"],
        },
    )
    profile = home / "profiles" / "scout"
    profile.mkdir(parents=True)
    retained = {
        "name": "retained",
        "base_url": "http://127.0.0.1:11436/v1",
        "api_key": "${RETAINED_TOKEN}",
    }
    # Same identity under another key: runtime takes the first alias match, so it must not survive.
    stale = {"name": "my-gateway", "base_url": "http://127.0.0.1:11437/v1"}
    retained_catalog = (
        {"stale": stale, "retained": retained}
        if schema == "providers"
        else [stale, retained]
    )
    atomic_config_write(
        profile / "config.yaml",
        {
            "tts": {"provider": "edge"},
            schema: retained_catalog,
            "_config_version": DEFAULT_CONFIG["_config_version"],
        },
    )

    assert srv._inherit_launch_model(profile) is True

    cfg = yaml.safe_load((profile / "config.yaml").read_text(encoding="utf-8"))
    assert (cfg["model"]["provider"], cfg["model"]["default"]) == (
        provider,
        "my-finetune",
    )
    expected = (
        {"my-gateway": endpoint, "retained": retained}
        if schema == "providers"
        else [endpoint, retained]
    )
    assert cfg[schema] == expected
    # The gateway travels as the launch file wrote it: the ref, never the launch secret.
    copied = (
        cfg["providers"]["my-gateway"]
        if schema == "providers"
        else cfg["custom_providers"][0]
    )
    assert copied["api_key"] == "${FAKE_GW_TOKEN}"


@pytest.mark.parametrize("written", ["http://127.0.0.1:11434/v1", "${LAB_URL}"])
def test_inherit_launch_model_pins_a_bare_custom_endpoint(monkeypatch, tmp_path, written):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    for var in ("CUSTOM_BASE_URL", "OPENAI_BASE_URL"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("LAB_URL", "http://127.0.0.1:11434/v1")
    # Hermetic: the pin probes the endpoint's /models.
    monkeypatch.setattr("hermes_cli.models.probe_api_models", lambda *a, **k: {"models": ["llama3"]})
    atomic_config_write(
        home / "config.yaml",
        {
            "model": {"provider": "custom", "default": "llama3", "base_url": written},
            "_config_version": DEFAULT_CONFIG["_config_version"],
        },
    )
    profile = home / "profiles" / "scout"
    profile.mkdir(parents=True)
    # Voice mirroring writes config.yaml before inheritance runs (#85755).
    atomic_config_write(
        profile / "config.yaml",
        {"tts": {"provider": "edge"}, "_config_version": DEFAULT_CONFIG["_config_version"]},
    )

    assert srv._inherit_launch_model(profile) is True

    model = read_user_config_raw(profile / "config.yaml")["model"]
    # The launch file's spelling travels: a ${VAR} URL stays a ref, never the launch value.
    assert (model["provider"], model["default"], model["base_url"]) == ("custom", "llama3", written)


def test_inherit_launch_model_preserves_explicit_profile_selection(
    monkeypatch, tmp_path
):
    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    atomic_config_write(
        home / "config.yaml", {"model": {"provider": "nous", "default": "launch-model"}}
    )
    profile = home / "profiles" / "scout"
    profile.mkdir(parents=True)
    selected = {"model": {"provider": "openrouter", "default": "profile-model"}}
    atomic_config_write(profile / "config.yaml", selected)
    before = read_user_config_raw(profile / "config.yaml")

    assert srv._inherit_launch_model(profile) is False
    assert read_user_config_raw(profile / "config.yaml") == before


@pytest.fixture
def clone_source_and_launch(tmp_path, monkeypatch):
    """The user clones default while another workspace uses a third-party model."""
    home = tmp_path / ".hermes"
    launch = home / "profiles" / "launch"
    launch.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(launch))
    monkeypatch.setattr(srv, "_hermes_home", launch)
    atomic_config_write(
        home / "config.yaml",
        {
            "model": {"provider": "", "default": ""},
            "providers": {
                "source-gateway": {"base_url": "http://127.0.0.1:11435/v1"},
            },
            "_config_version": DEFAULT_CONFIG["_config_version"],
        },
    )
    atomic_config_write(
        launch / "config.yaml",
        {
            "model": {"provider": "custom:launch-gateway", "default": "launch-model"},
            "providers": {
                "launch-gateway": {"base_url": "http://127.0.0.1:11434/v1"},
            },
            "_config_version": DEFAULT_CONFIG["_config_version"],
        },
    )
    return home


def _create_profile_model(params):
    response = srv._methods["profiles.create"](
        1, {"name": "scout", "no_alias": True, **params}
    )
    assert "error" not in response, response.get("error")
    result = response["result"]
    assert result["ok"] is True
    return result, read_user_config_raw(Path(result["path"]) / "config.yaml")


@pytest.mark.parametrize("source_has_model", [False, True])
def test_create_respects_explicit_clone_source_model(clone_source_and_launch, source_has_model):
    home = clone_source_and_launch
    source = read_user_config_raw(home / "config.yaml")
    if source_has_model:
        source["model"] = {"provider": "custom:source-gateway", "default": "source-model"}
        atomic_config_write(home / "config.yaml", source)

    result, created = _create_profile_model({"clone_from": "default"})

    # An empty runtime model is intentional for a desktop-managed Aino default. It must not
    # silently become the model of the workspace that happened to host this creation RPC.
    assert created["model"] == source["model"]
    assert "launch-gateway" not in created.get("providers", {})
    assert result["mirrored"]["model_inherited"] is False


def test_create_allows_explicit_model_override_of_clone_source(clone_source_and_launch):
    result, created = _create_profile_model({
        "clone_from": "default", "provider": "custom:source-gateway", "model": "chosen-model",
    })

    assert result["model_set"] is True
    assert created["model"]["provider"] == "custom:source-gateway"
    assert created["model"]["default"] == "chosen-model"
    assert result["mirrored"]["model_inherited"] is False


def test_clone_snapshots_complete_model_configuration_independently(clone_source_and_launch):
    home = clone_source_and_launch
    source_path = home / "config.yaml"
    source = read_user_config_raw(source_path)
    inherited = {
        "model": {"provider": "", "default": "", "context_length": 131072},
        "agent": {"reasoning_effort": "high", "service_tier": "normal", "max_turns": 40},
        "context": {"engine": "compressor"},
        "compression": {"enabled": True, "threshold": 0.78, "threshold_tokens": 80000},
        "auxiliary": {
            "compression": {"provider": "auto", "model": "", "reasoning_effort": "low"},
            "vision": {"provider": "custom:source-gateway", "model": "vision-model"},
        },
        "fallback_providers": [{"provider": "custom:source-gateway", "model": "backup-model"}],
        "image_gen": {"provider": "aino", "model": "aino-image-model", "quality": "auto"},
    }
    source.update(inherited)
    atomic_config_write(source_path, source)
    source_before = read_user_config_raw(source_path)

    result, created = _create_profile_model({"clone_from": "default"})

    for section, value in inherited.items():
        assert created[section] == value, section
    assert created["providers"] == source_before["providers"]

    # A clone is a one-time settings snapshot. A Bot can subsequently customize
    # every model section without mutating the original workspace's settings.
    child_path = Path(result["path"]) / "config.yaml"
    created["agent"]["reasoning_effort"] = "low"
    created["model"]["context_length"] = 65536
    created["compression"]["threshold"] = 0.65
    created["auxiliary"]["vision"]["model"] = "bot-vision-model"
    created["fallback_providers"][0]["model"] = "bot-backup-model"
    created["image_gen"]["model"] = "bot-image-model"
    atomic_config_write(child_path, created)
    assert read_user_config_raw(child_path) == created
    assert read_user_config_raw(source_path) == source_before

    source_before["image_gen"]["quality"] = "high"
    atomic_config_write(source_path, source_before)
    assert read_user_config_raw(child_path)["image_gen"]["quality"] == "auto"


def test_create_without_clone_keeps_launch_model_inheritance(clone_source_and_launch):
    _, created = _create_profile_model({"clone_from": None, "no_skills": True})

    assert created["model"]["provider"] == "custom:launch-gateway"
    assert created["model"]["default"] == "launch-model"
    assert "launch-gateway" in created["providers"]

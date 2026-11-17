"""Responses replay policy survives named/legacy custom-provider configuration reads."""

import pytest

from hermes_cli.config import (
    _custom_provider_entry_to_provider_config,
    atomic_config_write,
    get_compatible_custom_providers,
    load_config_readonly,
)
from hermes_cli.runtime_provider_custom import (
    _apply_custom_provider_extras,
    _get_named_custom_provider,
)


@pytest.mark.parametrize("value", [False, True])
@pytest.mark.parametrize("legacy", [False, True])
def test_replay_policy_roundtrips_config_and_named_runtime(tmp_path, monkeypatch, value, legacy):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    entry = {
        "name": "relay",
        "base_url": "https://relay.example/v1",
        "api_mode": "codex_responses",
        "responses_replay_item_ids": value,
    }
    config = {"custom_providers": [entry]} if legacy else {"providers": {"relay": entry}}
    atomic_config_write(tmp_path / "config.yaml", config)

    loaded = load_config_readonly()
    compatible = get_compatible_custom_providers(loaded)
    assert compatible[0]["responses_replay_item_ids"] is value
    named = _get_named_custom_provider("custom:relay", config=loaded, resolve_credentials=False)
    assert named["responses_replay_item_ids"] is value
    runtime = {}
    _apply_custom_provider_extras(named, "fixture-model", runtime)
    assert runtime["responses_replay_item_ids"] is value

    migrated = _custom_provider_entry_to_provider_config(compatible[0], provider_key="relay")
    assert migrated["responses_replay_item_ids"] is value
    assert get_compatible_custom_providers({"providers": {"relay": migrated}})[0][
        "responses_replay_item_ids"
    ] is value


@pytest.mark.parametrize("value", [None, "false", "true", 0, 1, {}, []])
@pytest.mark.parametrize("legacy", [False, True])
def test_replay_policy_requires_boolean_and_stays_absent_by_default(value, legacy):
    entry = {"name": "relay", "base_url": "https://relay.example/v1"}
    config = {"custom_providers": [entry]} if legacy else {"providers": {"relay": entry}}
    assert "responses_replay_item_ids" not in get_compatible_custom_providers(config)[0]
    entry["responses_replay_item_ids"] = value

    compatible = get_compatible_custom_providers(config)
    assert "responses_replay_item_ids" not in compatible[0]
    named = _get_named_custom_provider("custom:relay", config=config, resolve_credentials=False)
    assert "responses_replay_item_ids" not in named
    runtime = {}
    _apply_custom_provider_extras(named, "fixture-model", runtime)
    assert "responses_replay_item_ids" not in runtime

"""Capability defaults follow canonical config without overriding explicit operator intent."""
import pytest
import yaml

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_history import _setup


@pytest.mark.parametrize('default_enabled', [False, True])
def test_missing_capability_setting_uses_canonical_default_but_invalid_or_false_refuses(
        runtime_env, monkeypatch, default_enabled):
    from hermes_cli.config_defaults import DEFAULT_CONFIG

    _, _, _, home, _ = runtime_env
    _, rpc, call, _ = _setup(runtime_env, monkeypatch)
    monkeypatch.setitem(DEFAULT_CONFIG['conversations'], 'enabled', default_enabled)
    config_path = home / 'config.yaml'
    config = yaml.safe_load(config_path.read_text())
    for settings in ({}, {'storage': {}}):
        config['conversations'] = settings
        config_path.write_text(yaml.safe_dump(config))
        before = config_path.read_bytes()
        assert call('capabilities')['enabled'] is DEFAULT_CONFIG['conversations']['enabled']
        assert config_path.read_bytes() == before
    del config['conversations']
    config_path.write_text(yaml.safe_dump(config))
    assert call('capabilities')['enabled'] is DEFAULT_CONFIG['conversations']['enabled']
    for settings in (None, [], 'true', {'enabled': False}, {'enabled': None},
                     {'enabled': 1}, {'enabled': 'true'}, {'enabled': []}):
        config['conversations'] = settings
        config_path.write_text(yaml.safe_dump(config))
        result = rpc('capabilities')
        assert 'error' in result or result['result']['enabled'] is False
    config['conversations'] = {'enabled': True}
    config_path.write_text(yaml.safe_dump(config))
    assert call('capabilities')['enabled'] is True

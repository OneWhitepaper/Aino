"""Conversation capability requires its General runtime, not every optional expert."""
import pytest
import yaml

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401


@pytest.mark.parametrize('explicit', [True, False])
def test_general_environment_gates_capability_but_optional_expert_does_not(runtime_env, monkeypatch, explicit):
    from hermes_cli.config_defaults import DEFAULT_CONFIG
    from tui_gateway.conversation_service import ConversationService
    server, store, _install, home, _root = runtime_env
    monkeypatch.setitem(DEFAULT_CONFIG['conversations'], 'enabled', True)
    config_path = home / 'config.yaml'
    config = yaml.safe_load(config_path.read_text())
    if not explicit:
        config.pop('conversations')
    config['terminal']['backend'] = 'docker'
    config_path.write_text(yaml.safe_dump(config))
    service = ConversationService(server, db_path=store.db_path)
    capabilities = service.capabilities()
    assert capabilities['enabled'] is False
    assert 'local terminal' in capabilities['reason']
    config['terminal']['backend'] = 'local'
    config_path.write_text(yaml.safe_dump(config))
    expert_path = home / 'profiles' / 'writer' / 'config.yaml'
    expert = yaml.safe_load(expert_path.read_text())
    expert['terminal']['backend'] = 'docker'
    expert_path.write_text(yaml.safe_dump(expert))
    assert service.capabilities()['enabled'] is True
    rows = {row['participant']['profile']: row for row in service.catalog()}
    assert rows['default']['available'] is True
    assert rows['writer']['available'] is False
    config['conversations'] = {'enabled': False}
    config_path.write_text(yaml.safe_dump(config))
    assert service.capabilities()['enabled'] is False

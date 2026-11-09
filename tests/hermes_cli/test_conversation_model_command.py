"""Conversation model commands must not guess a provider or rewrite profile defaults."""
import argparse
from contextlib import asynccontextmanager
import json
from types import SimpleNamespace

import pytest


def _parse(*argv):
    from hermes_cli.subcommands.model import build_model_parser
    parser = argparse.ArgumentParser()
    build_model_parser(parser.add_subparsers(), cmd_model=lambda _: None)
    return parser.parse_args(['model', *argv])


def test_available_models_can_be_listed_without_an_interactive_picker():
    args = _parse('--list', '--json')
    assert args.list_models is True
    assert args.json is True


def test_select_is_mutually_exclusive_with_listing():
    with pytest.raises(SystemExit):
        _parse('--list', '--set', 'available-model')


def test_model_command_accepts_exact_candidate_and_explicit_provider():
    args = _parse('--set', 'available-model', '--provider', 'aino', '--json')
    assert args.set_model == 'available-model'
    assert args.provider == 'aino'


def test_command_refuses_to_choose_an_arbitrary_session(monkeypatch, capsys):
    from hermes_cli.conversation_model import conversation_model_command
    monkeypatch.delenv('HERMES_SESSION_ID', raising=False)
    with pytest.raises(SystemExit) as exc:
        conversation_model_command(SimpleNamespace(list_models=True, set_model=None, provider=None, json=True))
    assert exc.value.code == 1
    assert json.loads(capsys.readouterr().out)['error'] == 'no_current_session'


@pytest.mark.parametrize('key', ['model', 'model.provider', 'model.default', 'model.name', 'model.base_url'])
def test_agent_model_config_write_refuses_before_changing_defaults(tmp_path, monkeypatch, key):
    from hermes_cli.config import set_config_value
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setenv('HERMES_SESSION_ID', 'own-running-session')
    monkeypatch.setenv('HERMES_SESSION_PLATFORM', 'local')
    config = tmp_path / 'config.yaml'
    original = 'model:\n  provider: aino\n  default: built-in-model\n'
    config.write_text(original)
    with pytest.raises(SystemExit):
        set_config_value(key, 'alibaba')
    assert config.read_text() == original


def test_agent_model_config_unset_also_keeps_default(tmp_path, monkeypatch):
    from hermes_cli.config import unset_config_value
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setenv('HERMES_SESSION_ID', 'own-running-session')
    monkeypatch.setenv('HERMES_SESSION_PLATFORM', 'bot_room')
    config = tmp_path / 'config.yaml'
    original = 'model:\n  provider: aino\n  default: built-in-model\n'
    config.write_text(original)
    with pytest.raises(SystemExit):
        unset_config_value('model')
    assert config.read_text() == original


def test_scoped_cli_uses_current_profile_session_without_resuming_or_creating(tmp_path, monkeypatch, capsys):
    from hermes_cli.conversation_model import conversation_model_command
    from hermes_cli import gateway_client, gateway_runtime
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setenv('HERMES_SESSION_ID', 'exact-member-session')
    endpoint = object()
    calls = []

    def discover(home):
        assert home == tmp_path
        return SimpleNamespace(state='ready', endpoint=endpoint)

    class Client:
        async def rpc(self, method, **params):
            calls.append((method, params))
            return {'status': 'scheduled', 'effective': 'next_message',
                    'selection': {'model_id': 'catalog-choice', 'model_source': 'aino', 'provider': 'aino'}}

    @asynccontextmanager
    async def connect(*, endpoint):
        assert endpoint is not None
        yield Client()

    monkeypatch.setattr(gateway_runtime, 'discover_gateway_endpoint', discover)
    monkeypatch.setattr(gateway_client, 'connect_gateway', connect)
    conversation_model_command(_parse('--set', 'catalog-choice', '--provider', 'aino', '--json'))
    assert calls == [('model.session', {'session_id': 'exact-member-session', 'action': 'select',
                                       'query': 'catalog-choice', 'provider': 'aino', '_timeout': 45})]
    assert json.loads(capsys.readouterr().out)['effective'] == 'next_message'
    assert not (tmp_path / 'config.yaml').exists()


def test_offline_command_keeps_previous_route_and_does_not_start_owner(tmp_path, monkeypatch, capsys):
    from hermes_cli.conversation_model import conversation_model_command
    from hermes_cli import gateway_runtime
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setenv('HERMES_SESSION_ID', 'exact-member-session')
    monkeypatch.setattr(gateway_runtime, 'discover_gateway_endpoint',
                        lambda home: SimpleNamespace(state='absent', endpoint=None))
    monkeypatch.setattr(gateway_runtime, 'ensure_gateway_runtime',
                        lambda *_a, **_k: pytest.fail('A conversation command must not start a new owner'))
    with pytest.raises(SystemExit) as exc:
        conversation_model_command(_parse('--list', '--json'))
    assert exc.value.code == 1
    assert json.loads(capsys.readouterr().out)['status'] == 'unavailable'
    assert not (tmp_path / 'config.yaml').exists()


def test_explicit_outside_conversation_config_administration_remains_supported(tmp_path, monkeypatch):
    from hermes_cli.config import set_config_value
    from hermes_cli.config_backend import read_config_doc_readonly
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.delenv('HERMES_SESSION_ID', raising=False)
    set_config_value('model.provider', 'configured-provider')
    assert read_config_doc_readonly(tmp_path / 'config.yaml')['model']['provider'] == 'configured-provider'

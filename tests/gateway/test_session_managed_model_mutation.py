"""Managed catalog picks use the canonical model mutation and a fresh binding."""

import json
import sqlite3
from dataclasses import asdict
from types import SimpleNamespace

import pytest

from gateway.session_mutation_model import prepare_model
from gateway.session_policy import LocalSessionPolicy, restore_policy
from hermes_state_mutations import validate_action
from hermes_state_runtime import RuntimeStoreError


def _prepared(source='gui'):
    policy = LocalSessionPolicy(
        source=source, platform='desktop' if source == 'gui' else 'cli',
        cwd='/workspace', model='old', toolsets=(),
        config_json=json.dumps({'model': {'provider': 'custom', 'default': 'old',
                                           'base_url': 'https://old.example/v1', 'api_key': None},
                                'agent': {'max_turns': 4}}),
        request_json=json.dumps({'source': source}),
        terminal_json=json.dumps({'TERMINAL_CWD': '/workspace'}))
    return {'snapshot': {'receipt': {'session_id': 's', 'policy': asdict(policy)}}}


def test_managed_model_payload_is_closed():
    validate_action('model', {'model': 'catalog-id', 'model_source': 'aino'})
    for payload in (
        {'model': '', 'model_source': 'aino'},
        {'model': ' catalog-id ', 'model_source': 'aino'},
        {'model': 'catalog-id', 'model_source': 'aino', 'provider': 'other'},
        {'model': 'catalog-id', 'model_source': 'other'},
    ):
        with pytest.raises(RuntimeStoreError):
            validate_action('model', payload)


@pytest.mark.asyncio
async def test_managed_pick_freezes_identity_without_old_route_or_credential():
    prepared = _prepared()
    result = await prepare_model(SimpleNamespace(), None,
                                 {'model': 'catalog-id', 'model_source': 'aino'}, prepared)
    policy = restore_policy(result['policy'])

    assert policy.model == 'catalog-id'
    assert policy.config()['model'] == {
        'provider': 'aino', 'default': 'catalog-id', 'model_source': 'aino', 'model_id': 'catalog-id'}
    assert policy.config()['agent'] == {'max_turns': 4}
    assert policy.credential_ref is None and policy.config_secret_ref is None
    assert policy.request_json == prepared['snapshot']['receipt']['policy']['request_json']

    with pytest.raises(RuntimeStoreError, match='managed_binding_forbidden'):
        await prepare_model(SimpleNamespace(), None, {'model': 'catalog-id', 'model_source': 'aino'},
                            _prepared(source='cli'))


@pytest.mark.asyncio
async def test_managed_pick_stays_selected_when_the_session_follows_profile(monkeypatch):
    from gateway import session_policy

    prepared = _prepared()
    prepared['snapshot']['receipt']['policy']['request_json'] = json.dumps(
        {'source': 'gui', 'follow_profile_config': True})
    managed = await prepare_model(SimpleNamespace(), None,
                                  {'model': 'catalog-id', 'model_source': 'aino'}, prepared)
    policy = restore_policy(managed['policy'])
    monkeypatch.setattr(session_policy, 'profile_config', lambda _authority: {
        'model': {'provider': 'custom', 'default': 'new-profile-default'},
        'agent': {'service_tier': 'priority'}})

    config, model = policy.effective(SimpleNamespace())
    assert model == 'catalog-id'
    assert config['model']['provider'] == 'aino'
    assert config['model']['model_id'] == 'catalog-id'
    assert config['agent']['service_tier'] == 'priority'


@pytest.mark.asyncio
async def test_ordinary_pick_from_managed_policy_clears_catalog_marker(monkeypatch):
    from gateway import session_mutation_model as mutation
    from hermes_cli import model_switch

    prepared = _prepared()
    managed = await prepare_model(SimpleNamespace(), None,
                                  {'model': 'catalog-id', 'model_source': 'aino'}, prepared)
    prepared['snapshot']['receipt']['policy'] = managed['policy']
    authority = SimpleNamespace()
    live = SimpleNamespace(source=None, route='s')
    result = SimpleNamespace(success=True, new_model='byok-model', target_provider='custom',
                             base_url='https://new.example/v1', api_key='', api_mode='chat_completions',
                             model_info=None)
    monkeypatch.setattr(model_switch, 'switch_model', lambda **_kwargs: result)
    monkeypatch.setattr(model_switch, 'apply_model_selection', lambda _old, _result: {
        'provider': 'custom', 'default': 'byok-model', 'base_url': result.base_url,
        'model_source': 'aino', 'model_id': 'catalog-id'})
    monkeypatch.setattr(mutation, '_alias_credential', lambda *_args: (None, None, None))
    monkeypatch.setattr(mutation, '_provider_resolution_config', lambda _a, config, _b: config)
    monkeypatch.setattr(mutation, '_freeze_selected_provider', lambda *_args: ({}, (), {}))

    async def no_guard(*_args):
        return None

    monkeypatch.setattr(mutation, '_selection_guard_refusal', no_guard)
    switched = await prepare_model(authority, live,
                                   {'model': 'byok-model', 'provider': 'custom'}, prepared)
    block = restore_policy(switched['policy']).config()['model']
    assert block['provider'] == 'custom' and block['default'] == 'byok-model'
    assert 'model_source' not in block and 'model_id' not in block


@pytest.mark.asyncio
async def test_exact_model_receipt_retry_keeps_a_new_managed_binding(monkeypatch):
    from gateway import session_local, session_local_mcp, session_mutations, session_platform_model
    from gateway.session_contract import SessionRef

    binding = {'current': 'old'}
    cleared = []

    def clear(_authority, _sid):
        cleared.append(binding['current'])
        binding['current'] = None

    monkeypatch.setattr(session_platform_model, 'clear_managed_selection', clear)
    monkeypatch.setattr(session_local, 'publish_local_policy', lambda *_args, **_kwargs: None)
    monkeypatch.setattr(session_local, 'local_session_info', lambda *_args: {'model': 'catalog-id'})
    monkeypatch.setattr(session_local_mcp, 'announce_tools_changed', lambda *_args: None)
    live = SimpleNamespace(route='route', event_stream=SimpleNamespace(publish=lambda *_a, **_k: None))
    authority = SimpleNamespace(
        db=SimpleNamespace(get_session=lambda _sid: {'runtime_generation': 2}),
        runner=SimpleNamespace(_set_session_reasoning_override=lambda *_args: None),
        sessions={'s': live}, _schedule=lambda _ref: None)
    ref = SessionRef('owned', 's')
    params = {'operation': 'model', 'expected_generation': 1}
    result = {'session_id': 's', 'execution_generation': 2, 'model': 'catalog-id'}

    await session_mutations._project_result(authority, ref, live, params, result, None, applied=True)
    assert binding['current'] is None and cleared == ['old']
    binding['current'] = 'new'
    await session_mutations._project_result(authority, ref, live, params, result, None, applied=False)
    assert binding['current'] == 'new' and cleared == ['old']


@pytest.mark.parametrize('next_model', [
    {'provider': 'aino', 'default': 'next-id', 'model_source': 'aino', 'model_id': 'next-id'},
    {'provider': 'custom', 'default': 'byok-model'},
])
def test_model_receipt_replaces_stale_managed_row_metadata(monkeypatch, next_model):
    import hermes_state_mutation_prepared as prepared_module

    old_metadata = {'provider': 'aino', 'model_source': 'aino', 'model_id': 'old-id',
                    'platform_owner': {'user_id': 'previous'}, 'model': 'old-model',
                    'api_mode': 'responses', 'base_url': None}
    with sqlite3.connect(':memory:') as conn:
        conn.execute('CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, model_config TEXT)')
        conn.execute('CREATE TABLE state_meta (key TEXT PRIMARY KEY, value TEXT)')
        conn.execute('INSERT INTO sessions VALUES (?, ?, ?)', ('s', 'old-model', json.dumps(old_metadata)))
        monkeypatch.setattr(prepared_module, '_commit_policy', lambda *_args: ({'target': 's'}, 2))
        policy = {'model': next_model['default'], 'config_json': json.dumps({'model': next_model})}
        _affected, receipt = prepared_module.model_in_transaction(None, conn, 's', {}, {'policy': policy})
        stored_model, raw = conn.execute('SELECT model, model_config FROM sessions WHERE id=?', ('s',)).fetchone()

    metadata = json.loads(raw)
    assert stored_model == next_model['default']
    assert metadata['provider'] == next_model['provider']
    assert 'platform_owner' not in metadata and 'api_mode' not in metadata
    assert 'model' not in metadata and 'base_url' not in metadata
    if next_model['provider'] == 'aino':
        assert metadata['model_id'] == 'next-id'
        assert receipt['model_source'] == 'aino' and receipt['status'] == 'applied'
    else:
        assert 'model_source' not in metadata and 'model_id' not in metadata
        assert 'model_source' not in receipt

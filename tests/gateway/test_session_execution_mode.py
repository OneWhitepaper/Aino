"""Aino session modes are durable execution choices, never a mutable UI-only flag."""

from dataclasses import asdict
from tests.fixtures.storage_read import session_row
from pathlib import Path
from types import SimpleNamespace

import pytest

from tests.gateway.fixtures.storage_handles import close_storage_handles
from tests.gateway.test_session_create_tier_cwd import _owner

pytestmark = pytest.mark.usefixtures("authority_cwd_in_tmp")


async def _create(connection, cwd, request_id, **extra):
    return await connection.dispatch({'id': request_id, 'method': 'session.create', 'params': {
        'request_id': request_id, 'source': 'gui', 'cwd': str(cwd), 'cwd_explicit': True,
        'toolsets': [], 'model': 'fixture-model', **extra}})


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['work', 'code'])
async def test_execution_mode_survives_create_list_and_receipt_restore(tmp_path, monkeypatch, mode):
    from gateway.session_policy import restore_policy


    store, _runner, authority, connection = _owner(tmp_path / 'home', monkeypatch, {'model': {'default': 'fixture-model'}})
    try:
        result = await _create(connection, tmp_path, 'create', execution_mode=mode)
        assert 'error' not in result, result
        created = result['result']
        assert created['info']['execution_mode'] == mode
        receipt = asdict(authority.persistence.bindings.receipt(created['session_id']))
        restored = restore_policy(receipt['policy'])
        assert restored.execution_mode == mode
        listed = await connection.dispatch({'id': 'list', 'method': 'session.list', 'params': {}})
        row = next(row for row in listed['result']['sessions'] if row['session_id'] == created['session_id'])
        assert row['execution_mode'] == mode
        resumed = await connection.dispatch({'id': 'resume', 'method': 'session.resume',
                                            'params': {'session_id': created['session_id']}})
        assert resumed['result']['info']['execution_mode'] == mode
        branched = await connection.dispatch({'id': 'branch', 'method': 'session.mutate', 'params': {
            'session_id': created['session_id'], 'request_id': 'branch', 'expected_revision': 0,
            'expected_generation': 0, 'operation': 'branch', 'payload': {}}})
        assert 'error' not in branched, branched
        child = branched['result']['branched_session_id']
        assert restore_policy(asdict(authority.persistence.bindings.receipt(child))['policy']).execution_mode == mode
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_old_sessions_default_to_work_and_mode_cannot_change_on_retry(tmp_path, monkeypatch):
    from gateway.session_policy import restore_policy


    store, _runner, authority, connection = _owner(tmp_path / 'home', monkeypatch, {'model': {'default': 'fixture-model'}})
    try:
        created = (await _create(connection, tmp_path, 'same'))['result']
        assert created['info']['execution_mode'] == 'work'
        policy = asdict(authority.persistence.bindings.receipt(created['session_id']))['policy']
        policy.pop('execution_mode', None)
        assert restore_policy(policy).execution_mode == 'work'
        changed = await _create(connection, tmp_path, 'same', execution_mode='code')
        assert changed['error']['data']['reason'] == 'invalid_params'
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_code_mode_survives_a_cold_owner_and_title_lookup(tmp_path, monkeypatch):
    home = tmp_path / 'home'
    config = {'model': {'default': 'fixture-model'}}
    store, _runner, authority, connection = _owner(home, monkeypatch, config)
    try:
        created = (await _create(connection, tmp_path, 'cold-code', execution_mode='code'))['result']
        sid = created['session_id']
        authority.persistence.sessions.set_title(sid, 'Code recovery fixture')
    finally:
        await connection.close()
        store.close_all_db_handles()

    store, _runner, authority, connection = _owner(home, monkeypatch, config)
    try:
        assert sid not in authority.sessions
        resumed = await connection.dispatch({'id': 'resume', 'method': 'session.resume',
                                            'params': {'session_id': sid}})
        assert 'error' not in resumed, resumed
        assert resumed['result']['info']['execution_mode'] == 'code'
        titled = await connection.dispatch({'id': 'title', 'method': 'session.list',
                                           'params': {'title': 'Code recovery fixture'}})
        assert 'error' not in titled, titled
        assert titled['result']['sessions'][0]['execution_mode'] == 'code'
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
@pytest.mark.parametrize('extra', [
    {'execution_mode': 'other'}, {'execution_mode': 'code', 'cwd': ''},
    {'execution_mode': 'code', 'cwd': None},
])
async def test_code_rejects_unknown_mode_and_invalid_explicit_workspace(tmp_path, monkeypatch, extra):
    store, _runner, _authority, connection = _owner(tmp_path / 'home', monkeypatch, {'model': {'default': 'fixture-model'}})
    try:
        response = await _create(connection, extra.get('cwd', tmp_path), 'invalid', execution_mode=extra['execution_mode'])
        assert 'error' in response
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', ['default', 'secondary'])
@pytest.mark.parametrize('inherited_cwd', [False, True])
async def test_projectless_code_has_a_durable_owned_workspace(tmp_path, monkeypatch, profile, inherited_cwd):

    from gateway.session_policy import restore_policy

    home = tmp_path / 'home' if profile == 'default' else tmp_path / 'home' / 'profiles' / profile
    config = {'model': {'default': 'fixture-model'}}
    params = {'request_id': 'projectless', 'source': 'gui', 'execution_mode': 'code',
              'toolsets': [], 'model': 'fixture-model'}
    if inherited_cwd:
        params.update(cwd=str(tmp_path), cwd_explicit=False)
    store, _runner, authority, connection = _owner(home, monkeypatch, config)
    try:
        response = await connection.dispatch({'id': 'create', 'method': 'session.create', 'params': params})
        assert 'error' not in response, response
        created = response['result']
        sid, cwd = created['session_id'], Path(created['info']['cwd'])
        assert cwd.is_dir() and cwd.parent == home / 'code' / 'workspaces'
        assert created['info']['execution_mode'] == 'code'
        (cwd / 'keep.txt').write_text('persistent output')
        retry = await connection.dispatch({'id': 'retry', 'method': 'session.create', 'params': params})
        assert retry['result']['session_id'] == sid
        assert retry['result']['info']['cwd'] == str(cwd)
        other = await connection.dispatch({'id': 'other', 'method': 'session.create',
                                           'params': {**params, 'request_id': 'other'}})
        assert other['result']['info']['cwd'] != str(cwd)
        assert not session_row(authority.persistence, sid)['cwd']
        assert restore_policy(asdict(authority.persistence.bindings.receipt(sid))['policy']).cwd == str(cwd)
    finally:
        await connection.close()
        store.close_all_db_handles()

    store, _runner, authority, connection = _owner(home, monkeypatch, config)
    try:
        resumed = await connection.dispatch({'id': 'resume', 'method': 'session.resume',
                                             'params': {'session_id': sid}})
        assert resumed['result']['info']['cwd'] == str(cwd)
        assert resumed['result']['info']['execution_mode'] == 'code'
        assert (cwd / 'keep.txt').read_text() == 'persistent output'
    finally:
        await connection.close()
        store.close_all_db_handles()


@pytest.mark.asyncio
async def test_projectless_code_uses_the_served_profiles_scope(tmp_path, monkeypatch):
    from agent.runtime_scope import bind_profile_scope

    launch, secondary = tmp_path / 'launch', tmp_path / 'launch' / 'profiles' / 'secondary'
    store, _runner, _authority, connection = _owner(secondary, monkeypatch, {'model': {'default': 'fixture-model'}})
    monkeypatch.setenv('HERMES_HOME', str(launch))
    try:
        with bind_profile_scope(secondary, hydrate_secrets=False):
            response = await connection.dispatch({'id': 'secondary', 'method': 'session.create', 'params': {
                'request_id': 'secondary', 'source': 'gui', 'execution_mode': 'code',
                'toolsets': [], 'model': 'fixture-model'}})
        assert 'error' not in response, response
        assert Path(response['result']['info']['cwd']).parent == secondary / 'code' / 'workspaces'
        assert not (launch / 'code').exists()
    finally:
        await connection.close()
        store.close_all_db_handles()


def test_code_dispatches_native_turn_without_provider_fallback(monkeypatch):
    from agent import conversation_loop

    expected = {'final_response': 'Codex route unavailable', 'error': 'codex_error'}
    calls = []
    agent = SimpleNamespace(execution_mode='code', api_mode='codex_responses',
                            _run_codex_app_server_turn=lambda **kwargs: calls.append(kwargs) or expected)
    state = SimpleNamespace(user_message='edit', original_user_message='edit', messages=[],
                            effective_task_id='session', _should_review_memory=False, turn_id='turn')
    monkeypatch.setattr('agent.turn_recovery.activate_codex_app_server_fallback',
                        lambda *_: pytest.fail('Code must not enter the Hermes provider fallback'))
    assert conversation_loop._turn_without_loop(agent, state, '') is expected
    assert len(calls) == 1


def test_code_agent_construction_keeps_mode_and_skips_hermes_memory(tmp_path, monkeypatch):
    from gateway import session_policy
    from tests.gateway.test_turn_service_tier_isolation import _turn

    policy = session_policy.build_policy({'source': 'gui', 'cwd': str(tmp_path), 'cwd_explicit': True,
                                         'execution_mode': 'code', 'model': 'm', 'toolsets': []}, {})
    monkeypatch.setattr(session_policy, 'policy_for_source', lambda *_: policy)
    monkeypatch.setattr('gateway.session_worker_construct.session_prefill', lambda *_: None)
    runner = SimpleNamespace(_prefill_messages=None, _refresh_fallback_model=lambda: None, _session_db=None,
                             session_authority=SimpleNamespace(profile_id=str(tmp_path)))
    built = {}
    turn = _turn(runner, 'code-session', built)
    agent = turn._build_fresh_agent({'model': 'm', 'runtime': {}}, 'desktop', '', 5, {}, {}, False)
    assert agent.execution_mode == 'code'
    assert built['code-session']['skip_memory'] is True
    assert built['code-session']['skip_context_files'] is True


def test_code_resolution_does_not_walk_another_providers_fallback(tmp_path, monkeypatch):
    from gateway.session_policy import build_policy
    from gateway.session_worker_construct import route_runtime
    from hermes_cli import runtime_provider

    policy = build_policy({'source': 'gui', 'cwd': str(tmp_path), 'cwd_explicit': True,
                           'execution_mode': 'code', 'model': 'm', 'toolsets': []}, {})
    class PrimaryUnavailable(Exception):
        pass
    def unavailable(**_kwargs):
        raise PrimaryUnavailable('selected provider unavailable')
    monkeypatch.setattr(runtime_provider, 'resolve_runtime_provider', unavailable)
    monkeypatch.setattr(runtime_provider, 'resolve_runtime_with_fallback', lambda *_args, **_kwargs: (
        {'provider': 'different-account'}, {'provider': 'different-account'}))
    with pytest.raises(PrimaryUnavailable):
        route_runtime(policy, {'model': {'provider': 'openai'}}, 'm', None)

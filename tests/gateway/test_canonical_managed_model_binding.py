"""Canonical Desktop sessions delegate ephemeral Aino credentials to the controller."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest


class Peer:
    auth_identity = {'provider': 'local', 'user_id': 'owner'}


async def call(connection, method, **params):
    return await connection.dispatch({'id': method, 'method': method, 'params': params})


@pytest.mark.asyncio
async def test_managed_create_binding_and_cold_resume_require_a_fresh_lease(tmp_path, monkeypatch):
    from gateway.run import GatewayRunner
    from gateway.session_authority import initialize_session_authority
    from gateway.session_controls import AuthorityConnection
    from gateway.session_platform_model import binding_key
    from tui_gateway.managed_model_runtime import get_registry

    home = tmp_path / 'state'
    home.mkdir()
    (home / 'config.yaml').write_text('model:\n  provider: custom\n  default: unrelated\n'
                                      '  base_url: http://127.0.0.1:1/v1\n')
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    runner = GatewayRunner()
    authority = await initialize_session_authority(runner, profile_id=str(home), instance_id='managed')
    viewer = AuthorityConnection(authority, Peer(), {'user_id': 'owner', 'provider': 'local'}, operator=True)
    controller = AuthorityConnection(authority, Peer(), {'user_id': 'owner', 'provider': 'local'}, operator=True)
    owner = {'platform_origin': 'http://127.0.0.1:17321', 'user_id': 'account-1'}
    try:
        created = await call(viewer, 'session.create', request_id='managed-create', source='gui',
                             cwd=str(tmp_path), toolsets=[], model_source='aino', model_id='catalog-a')
        assert 'result' in created, created
        sid = created['result']['session_id']
        assert created['result']['info']['model_status'] == 'awaiting_managed_credentials'
        assert created['result']['info']['model_id'] == 'catalog-a'
        denied = await call(viewer, 'prompt.submit', session_id=sid, text='never admitted',
                            submission_id='unbound')
        assert denied['error']['data']['reason'] == 'awaiting_managed_credentials'

        reader = AuthorityConnection(authority, Peer(), {
            'user_id': 'owner', 'provider': 'local', 'capabilities': ['session:read']})
        try:
            resumed = await call(reader, 'session.resume', session_id=sid)
            assert 'result' in resumed, resumed
            denied = await call(reader, 'prompt.submit', session_id=sid, submission_id='read-only')
            assert denied['error']['data']['reason'] == 'permission_denied', denied
        finally:
            await reader.close()

        ticket = await call(viewer, 'session.managed_model_ticket', session_id=sid,
                            owner=owner, model_id='catalog-a')
        assert 'result' in ticket, ticket
        claim = await call(controller, 'session.claim_managed_model', session_id=sid,
                           owner=owner, model_id='catalog-a',
                           session_ticket=ticket['result']['session_ticket'])
        assert 'result' in claim, claim
        replay = await call(controller, 'session.claim_managed_model', session_id=sid,
                            owner=owner, model_id='catalog-a',
                            session_ticket=ticket['result']['session_ticket'])
        assert 'error' in replay, replay
        binding = dict(session_id=sid, owner=owner, model_id='catalog-a',
                       binding_revision=claim['result']['binding_revision'],
                       credential_id='credential-1', api_key='fixture-secret',
                       base_url=owner['platform_origin'] + '/v1',
                       expires_at=(datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
                       model='upstream-model', api_mode='chat_completions',
                       capabilities={'tools': True, 'vision': False, 'reasoning': False},
                       context_window=32000)
        bound = await call(controller, 'session.bind_managed_model', **binding)
        assert bound['result']['bound'], bound
        ready = await call(viewer, 'session.info', session_id=sid)
        assert ready['result']['model_status'] == 'ready', ready
        assert ready['result']['model'] == 'upstream-model', ready
        options = await call(viewer, 'model.options', session_id=sid, include_session_info=True)
        assert options['result']['session_info']['model'] == 'upstream-model', options
        assert options['result']['session_info']['platform_owner'] == owner, options
        assert get_registry().get(binding_key(authority, sid)) is not None
        other_profile = SimpleNamespace(profile_id=str(tmp_path / 'other-profile'))
        assert get_registry().get(binding_key(other_profile, sid)) is None

        interrupted = []
        with monkeypatch.context() as patch:
            patch.setattr(authority, '_handle', lambda _ref: SimpleNamespace(execution_state='running'))
            patch.setattr(authority, 'agent', lambda _ref: SimpleNamespace(interrupt=lambda: interrupted.append(True)))
            get_registry().disconnect(viewer.transport)
        assert interrupted == [True], 'lease loss must stop a turn started after binding'
        await viewer.close()
        assert get_registry().get(binding_key(authority, sid)) is None
        cold = AuthorityConnection(authority, Peer(), {'user_id': 'owner', 'provider': 'local'}, operator=True)
        try:
            resumed = await call(cold, 'session.resume', session_id=sid)
            assert resumed['result']['info']['model_status'] == 'awaiting_managed_credentials'
            assert resumed['result']['info']['model_id'] == 'catalog-a'
            denied = await call(cold, 'prompt.submit', session_id=sid, text='still unbound',
                                submission_id='cold-unbound')
            assert denied['error']['data']['reason'] == 'awaiting_managed_credentials'
        finally:
            await cold.close()
    finally:
        await viewer.close()
        await controller.close()
        authority.db.close()

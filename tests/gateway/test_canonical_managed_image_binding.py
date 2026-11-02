"""A GUI image lease follows current profile config independently of chat."""
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from types import SimpleNamespace

from tests.gateway.test_canonical_managed_model_binding import Peer, call


@pytest.mark.asyncio
async def test_gui_image_binding_uses_live_profile_config_without_overwriting_chat(tmp_path, monkeypatch):
    from gateway.run import GatewayRunner
    from gateway.session_authority import initialize_session_authority
    from gateway.session_controls import AuthorityConnection
    from gateway.session_platform_model import binding_key, clear_managed_selection, managed_state
    from tui_gateway.managed_model_runtime import get_registry

    home = tmp_path / 'image-profile'
    home.mkdir()
    config = home / 'config.yaml'
    cfg = {'model': {'provider': 'custom', 'default': 'chat-original', 'base_url': 'http://127.0.0.1:1/v1'},
           'image_gen': {'provider': 'aino', 'model': 'image-catalog'}}
    config.write_text(json.dumps(cfg))
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    runner = GatewayRunner()
    authority = await initialize_session_authority(runner, profile_id=str(home), instance_id='image')
    viewer = AuthorityConnection(authority, Peer(), {'user_id': 'owner', 'provider': 'local'}, operator=True)
    controller = AuthorityConnection(authority, Peer(), {'user_id': 'owner', 'provider': 'local'}, operator=True)
    owner = {'platform_origin': 'https://account.example', 'user_id': 'account'}
    try:
        created = await call(viewer, 'session.create', request_id='image-create', source='gui', cwd=str(tmp_path), toolsets=[],
                             model='chat-original', provider='custom', base_url='http://127.0.0.1:1/v1', api_key='loopback-only')
        assert 'result' in created, created
        sid = created['result']['session_id']
        before = authority.db.get_session(sid)['model_config']
        params = {'session_id': sid, 'purpose': 'image', 'owner': owner, 'model_id': 'image-catalog'}
        for method in ('session.managed_model_ticket', 'session.claim_managed_model',
                       'session.bind_managed_model', 'session.renew_managed_model', 'session.clear_managed_model'):
            for invalid in ('other', []):
                denied = await call(viewer, method, **{**params, 'purpose': invalid})
                assert 'error' in denied, denied
        ticket = await call(viewer, 'session.managed_model_ticket', **params)
        assert 'result' in ticket, ticket
        claim = await call(controller, 'session.claim_managed_model', **params, session_ticket=ticket['result']['session_ticket'])
        assert claim['result']['managed_image_binding'] == 1, claim
        lease = {**params, 'binding_revision': claim['result']['binding_revision'], 'model': 'image-wire',
            'api_mode': 'images_generations', 'capabilities': {'tools': False, 'vision': False, 'reasoning': False, 'image_generation': True},
            'credential_id': 'image-credential', 'api_key': 'isolated-image-secret', 'base_url': owner['platform_origin'] + '/v1',
            'expires_at': (datetime.now(UTC) + timedelta(minutes=5)).isoformat()}
        bound = await call(controller, 'session.bind_managed_model', **lease)
        assert bound.get('result', {}).get('bound'), bound
        image = get_registry().get(binding_key(authority, sid), purpose='image')
        assert image.api_key == 'isolated-image-secret'
        assert get_registry().get(binding_key(authority, sid)) is None
        assert authority.db.get_session(sid)['model_config'] == before
        assert not hasattr(authority.sessions[sid], 'managed_model_state')
        foreign = {**params, 'profile': 'foreign'}
        assert 'error' in await call(viewer, 'session.managed_model_ticket', **foreign)
        cli = await call(viewer, 'session.create', request_id='cli-no-image', source='cli', cwd=str(tmp_path), toolsets=[],
                         model='chat-original', provider='custom', base_url='http://127.0.0.1:1/v1', api_key='loopback-only')
        assert 'result' in cli, cli
        assert 'error' in await call(viewer, 'session.managed_model_ticket', **{**params, 'session_id': cli['result']['session_id']})
        interrupted = []
        with monkeypatch.context() as patch:
            patch.setattr(authority, '_handle', lambda _ref: SimpleNamespace(execution_state='running'))
            patch.setattr(authority, 'agent', lambda _ref: SimpleNamespace(interrupt=lambda: interrupted.append(True)))
            get_registry().disconnect(controller.transport)
        assert not interrupted
        assert get_registry().get(binding_key(authority, sid), purpose='image') is None
        ticket = await call(viewer, 'session.managed_model_ticket', **params)
        claim = await call(controller, 'session.claim_managed_model', **params, session_ticket=ticket['result']['session_ticket'])
        lease['binding_revision'] = claim['result']['binding_revision']
        assert (await call(controller, 'session.bind_managed_model', **lease))['result']['bound']
        image = get_registry().get(binding_key(authority, sid), purpose='image')
        clear_managed_selection(authority, sid)
        assert get_registry().get(binding_key(authority, sid), purpose='image') is image
        cfg['image_gen']['model'] = 'changed-image'
        config.write_text(json.dumps(cfg))
        assert managed_state(authority, sid, purpose='image')['managed_image_params']['model_id'] == 'changed-image'
        assert get_registry().get(binding_key(authority, sid), purpose='image') is None
        denied = await call(viewer, 'session.managed_model_ticket', **params)
        assert 'error' in denied, denied
        second = tmp_path / 'second-profile'
        second.mkdir()
        (second / 'config.yaml').write_text(json.dumps({'image_gen': {'provider': 'aino', 'model': 'profile-two'}}))
        other = SimpleNamespace(profile_id=str(second), runner=authority.runner,
                                sessions={sid: SimpleNamespace(source=authority.sessions[sid].source)})
        assert managed_state(other, sid, purpose='image')['managed_image_params']['model_id'] == 'profile-two'
        assert managed_state(authority, sid, purpose='image')['managed_image_params']['model_id'] == 'changed-image'
    finally:
        await viewer.close()
        await controller.close()
        authority.db.close()


@pytest.mark.asyncio
async def test_canonical_delete_retires_both_managed_credential_purposes(tmp_path, monkeypatch):
    from gateway.run import GatewayRunner
    from gateway.session_authority import initialize_session_authority
    from gateway.session_contract import SessionRef
    from gateway.session_controls import AuthorityConnection
    from gateway.session_platform_model import binding_key
    from tui_gateway.managed_model_runtime import get_registry

    home = tmp_path / 'delete-profile'
    home.mkdir()
    (home / 'config.yaml').write_text(json.dumps({
        'model': {'provider': 'custom', 'default': 'chat', 'base_url': 'http://127.0.0.1:1/v1'},
        'image_gen': {'provider': 'aino', 'model': 'image'}}))
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    authority = await initialize_session_authority(GatewayRunner(), profile_id=str(home), instance_id='delete')
    viewer = AuthorityConnection(authority, Peer(), {'user_id': 'owner', 'provider': 'local'}, operator=True)
    controller = AuthorityConnection(authority, Peer(), {'user_id': 'owner', 'provider': 'local'}, operator=True)
    try:
        created = await call(viewer, 'session.create', request_id='managed-delete', source='gui',
                             cwd=str(tmp_path), toolsets=[], model_source='aino', model_id='chat')
        assert 'result' in created, created
        sid = created['result']['session_id']
        key = binding_key(authority, sid)
        for purpose in ('chat', 'image'):
            params = {'session_id': sid, 'purpose': purpose, 'model_id': purpose,
                      'owner': {'platform_origin': 'https://account.example', 'user_id': 'account'}}
            ticket = await call(viewer, 'session.managed_model_ticket', **params)
            assert 'result' in ticket, ticket
            claim = await call(controller, 'session.claim_managed_model', **params,
                               session_ticket=ticket['result']['session_ticket'])
            assert 'result' in claim, claim
            bound = await call(controller, 'session.bind_managed_model', **params,
                binding_revision=claim['result']['binding_revision'], credential_id=purpose, api_key=purpose + '-secret',
                base_url='https://account.example/v1', model=purpose + '-wire',
                api_mode='images_generations' if purpose == 'image' else 'chat_completions',
                capabilities={'tools': purpose == 'chat', 'vision': False, 'reasoning': False,
                              'image_generation': purpose == 'image'},
                expires_at=(datetime.now(UTC) + timedelta(minutes=5)).isoformat())
            assert bound.get('result', {}).get('bound'), bound
            assert get_registry().get(key, purpose=purpose) is not None
        handle = authority._handle(SessionRef(authority.profile_id, sid))
        params = dict(session_id=sid, request_id='delete-both', operation='delete', payload={},
                      expected_revision=handle.revision, expected_generation=handle.execution_generation)
        deleted = await call(viewer, 'session.mutate', **params)
        assert 'result' in deleted, deleted
        assert sid not in authority.sessions
        assert get_registry().get(key, purpose='chat') is None
        assert get_registry().get(key, purpose='image') is None
        assert await call(viewer, 'session.mutate', **params) == deleted
    finally:
        await viewer.close()
        await controller.close()
        authority.db.close()

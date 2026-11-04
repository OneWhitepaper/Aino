"""Canonical warm binding checks share the private delegation's authority fence."""

from pathlib import Path

import pytest

from tests.gateway.test_canonical_managed_model_binding import Peer, call


@pytest.mark.asyncio
async def test_canonical_status_reuses_only_the_live_controller_and_key_version(tmp_path, monkeypatch):
    from gateway.run import GatewayRunner
    from gateway.session_authority import initialize_session_authority
    from gateway.session_controls import AuthorityConnection
    from gateway.session_platform_model import binding_key
    from tui_gateway.managed_model_runtime import get_registry

    home = tmp_path / 'state'
    home.mkdir()
    (home / 'config.yaml').write_text('model:\n  provider: custom\n  default: unrelated\n'
                                    'image_gen:\n  provider: aino\n  model: image-catalog\n')
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    authority = await initialize_session_authority(GatewayRunner(), profile_id=str(home), instance_id='warm')
    identity = {'user_id': 'owner', 'provider': 'local'}
    viewer, controller, replacement = [
        AuthorityConnection(authority, Peer(), identity, operator=True) for _ in range(3)]
    owner = {'platform_origin': 'https://fixture.invalid', 'user_id': 'account'}
    try:
        created = await call(viewer, 'session.create', request_id='warm-create', source='gui',
                             cwd=str(tmp_path), toolsets=[], model_source='aino', model_id='catalog-a')
        sid = created['result']['session_id']
        selected = dict(session_id=sid, owner=owner, model_id='catalog-a')
        request = dict(**selected, binding_revision=1, credential_version=2)
        missing = await call(controller, 'session.managed_model_status', **request)
        assert missing.get('result') == {'reusable': False, 'managed_device_key': 1}, missing
        ticket = await call(viewer, 'session.managed_model_ticket', **selected)
        claim = await call(controller, 'session.claim_managed_model', **selected,
                           session_ticket=ticket['result']['session_ticket'])
        request['binding_revision'] = claim['result']['binding_revision']
        payload = dict(**request, credential_id='device-key', api_key='private-secret',
                       credential_type='device', expires_at=None,
                       base_url=owner['platform_origin'] + '/v1', model='upstream',
                       api_mode='chat_completions',
                       capabilities={'tools': True, 'vision': False, 'reasoning': False})
        bound = await call(controller, 'session.bind_managed_model', **payload)
        assert bound.get('result', {}).get('bound') is True, bound
        active = get_registry().get(binding_key(authority, sid))
        for _ in range(100):
            ready = await call(controller, 'session.managed_model_status', **request)
            assert ready['result'] == {'reusable': True, 'managed_device_key': 1}
        for peer, changes in (
            (replacement, {}), (viewer, {}), (controller, {'credential_version': 1}),
            (controller, {'binding_revision': request['binding_revision'] + 1}),
            (controller, {'owner': {**owner, 'user_id': 'foreign'}}),
            (controller, {'model_id': 'catalog-b'}), (controller, {'purpose': 'image'}),
        ):
            response = await call(peer, 'session.managed_model_status', **(request | changes))
            assert 'error' in response or response['result'] == {'reusable': False, 'managed_device_key': 1}
        foreign = await call(controller, 'session.managed_model_status', **request, profile=str(tmp_path / 'foreign'))
        assert 'error' in foreign
        assert get_registry().get(binding_key(authority, sid)) is active
        image = dict(session_id=sid, owner=owner, model_id='image-catalog', purpose='image')
        ticket = await call(viewer, 'session.managed_model_ticket', **image)
        claim = await call(controller, 'session.claim_managed_model', **image,
                           session_ticket=ticket['result']['session_ticket'])
        image.update(binding_revision=claim['result']['binding_revision'], credential_version=2)
        bound = await call(controller, 'session.bind_managed_model', **(payload | image | {
            'api_mode': 'images_generations', 'model': 'image-upstream',
            'capabilities': {'tools': False, 'vision': False, 'reasoning': False, 'image_generation': True},
        }))
        assert bound.get('result', {}).get('bound') is True, bound
        ready = await call(controller, 'session.managed_model_status', **image)
        assert ready['result']['reusable']
        await call(controller, 'session.clear_managed_model', session_id=sid,
                   purpose='image', binding_revision=image['binding_revision'])
        lost = await call(controller, 'session.managed_model_status', **image)
        assert not lost['result']['reusable']
        assert get_registry().get(binding_key(authority, sid)) is active
        await viewer.close()
        lost = await call(controller, 'session.managed_model_status', **request)
        assert lost.get('result') == {'reusable': False, 'managed_device_key': 1}, lost
    finally:
        await viewer.close()
        await controller.close()
        await replacement.close()
        authority.db.close()

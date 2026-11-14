"""Desktop avatar images spend only the explicitly bound GUI session's image authority."""
import asyncio
from contextvars import copy_context
from datetime import UTC, datetime, timedelta
import json
from pathlib import Path

import pytest

from tests.gateway.test_canonical_managed_model_binding import Peer, call


@pytest.mark.asyncio
async def test_avatar_generation_uses_exact_gui_image_binding_and_retires_its_scope(tmp_path, monkeypatch):
    from agent.managed_image_provider import current_image_binding
    from gateway.run import GatewayRunner
    from gateway.session_authority import initialize_session_authority
    from gateway.session_controls import AuthorityConnection

    home = tmp_path / 'avatar-profile'
    home.mkdir()
    (home / 'config.yaml').write_text(json.dumps({'image_gen': {'provider': 'aino', 'model': 'avatar-model'}}))
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    authority = await initialize_session_authority(GatewayRunner(), profile_id=str(home), instance_id='avatar')
    viewer = AuthorityConnection(authority, Peer(), {'provider': 'local', 'user_id': 'owner'}, operator=True)
    controller = AuthorityConnection(authority, Peer(), {'provider': 'local', 'user_id': 'owner'}, operator=True)
    stranger = AuthorityConnection(authority, Peer(), {'provider': 'local', 'user_id': 'stranger'}, operator=True)
    responses = asyncio.Queue()

    async def write(frame):
        await responses.put(frame)
        return True

    viewer.transport.write_async = write
    captures = []

    def generate(_params):
        binding = current_image_binding()
        assert binding is not None
        assert binding.model_id == 'avatar-model'
        captures.append(copy_context())
        return json.dumps({'success': True, 'image': 'https://fixture.invalid/avatar.png'})

    monkeypatch.setattr('tools.image_generation_tool.check_image_generation_requirements', lambda: True)
    monkeypatch.setattr('tools.image_generation_tool._handle_image_generate', generate)
    monkeypatch.setattr('tui_gateway.server._image_to_data_url', lambda *_args: 'data:image/png;base64,AA==')
    try:
        created = await call(viewer, 'session.create', request_id='avatar-helper', source='gui', hidden=True,
                             follow_profile_config=True, toolsets=[])
        assert 'result' in created, created
        sid = created['result']['session_id']
        params = {'session_id': sid, 'purpose': 'image', 'model_id': 'avatar-model',
                  'owner': {'platform_origin': 'https://account.invalid', 'user_id': 'account'}}
        ticket = await call(viewer, 'session.managed_model_ticket', **params)
        claim = await call(controller, 'session.claim_managed_model', **params, session_ticket=ticket['result']['session_ticket'])
        bound = await call(controller, 'session.bind_managed_model', **params,
                           binding_revision=claim['result']['binding_revision'], model='avatar-wire', api_mode='images_generations',
                           capabilities={'tools': False, 'vision': False, 'reasoning': False, 'image_generation': True},
                           credential_id='image', api_key='test-only', base_url='https://account.invalid/v1',
                           expires_at=(datetime.now(UTC) + timedelta(minutes=5)).isoformat())
        assert bound.get('result', {}).get('bound'), bound
        refused = await call(stranger, 'image.generate', session_id=sid, prompt='robot')
        assert 'error' in refused and not captures, refused
        result = await call(viewer, 'image.generate', session_id=sid, prompt='robot')
        assert result is None, result
        reply = await asyncio.wait_for(responses.get(), timeout=10)
        assert reply.get('result', {}).get('success'), reply
        assert captures[0].run(current_image_binding) is None
        assert authority.db.get_messages(sid) == []
    finally:
        await viewer.close()
        await controller.close()
        await stranger.close()
        authority.db.close()

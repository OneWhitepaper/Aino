"""Older desktop transports keep the same exact-owner image authorization."""
from contextvars import copy_context
from datetime import UTC, datetime, timedelta
import json
from queue import Queue

import pytest

from tests.tui_gateway import test_managed_model_binding as model_binding_tests
from tests.tui_gateway.test_managed_model_binding import result


@pytest.fixture
def image_binding_rig(tmp_path, monkeypatch):
    yield from model_binding_tests.rig.__wrapped__(tmp_path, monkeypatch)


def test_avatar_rpc_borrows_only_the_callers_image_binding(image_binding_rig, monkeypatch):
    from agent.managed_image_provider import current_image_binding
    import tui_gateway.server as srv

    call, create, viewer, controller, stranger, home = image_binding_rig
    (home / 'config.yaml').write_text(json.dumps({'image_gen': {'provider': 'aino', 'model': 'avatar'}}))
    sid = create(hidden=True, follow_profile_config=True)
    session = srv._sessions[sid]
    params = {'session_id': sid, 'purpose': 'image', 'model_id': 'avatar',
              'owner': {'platform_origin': 'https://fixture.invalid', 'user_id': 'account'}}
    ticket = result(call(viewer, 'session.managed_model_ticket', **params))
    claim = result(call(controller, 'session.claim_managed_model', **params, session_ticket=ticket['session_ticket']))
    bound = call(controller, 'session.bind_managed_model', **params,
                 binding_revision=claim['binding_revision'], model='avatar-wire', api_mode='images_generations',
                 capabilities={'tools': False, 'vision': False, 'reasoning': False, 'image_generation': True},
                 credential_id='avatar', api_key='test-only', base_url='https://fixture.invalid/v1',
                 expires_at=(datetime.now(UTC) + timedelta(minutes=5)).isoformat())
    assert result(bound)['bound']
    captures = []

    def generate(_params):
        binding = current_image_binding()
        assert binding is not None and binding.model_id == 'avatar'
        captures.append(copy_context())
        return json.dumps({'success': True, 'image': 'https://fixture.invalid/avatar.png'})

    monkeypatch.setattr('tools.image_generation_tool.check_image_generation_requirements', lambda: True)
    monkeypatch.setattr('tools.image_generation_tool._handle_image_generate', generate)
    monkeypatch.setattr(srv, '_image_to_data_url', lambda *_args: 'data:image/png;base64,AA==')
    responses = Queue()

    def request(peer):
        peer.write = responses.put
        response = call(peer, 'image.generate', session_id=sid, prompt='robot')
        if response is None:
            response = responses.get(timeout=10)
            while response.get('id') != 1:
                response = responses.get(timeout=10)
        return response

    assert 'error' in request(stranger) and not captures
    assert result(request(viewer))['success']
    assert captures[0].run(current_image_binding) is None
    assert not session.get('managed_model_params')

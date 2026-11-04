"""Warm reuse requires current delegated authority, never a cached ready hint."""

import json

import pytest

from tests.tui_gateway import test_managed_model_binding as existing
from tui_gateway.managed_model_runtime import get_registry


@pytest.fixture
def rig(tmp_path, monkeypatch):
    yield from existing.rig.__wrapped__(tmp_path, monkeypatch)


def test_status_is_false_before_binding_and_tracks_only_the_exact_device_authority(rig):
    call, create, owner, controller, stranger, _ = rig
    sid = create(model_source='aino', model_id='fixture-model')
    request = {
        'session_id': sid,
        'owner': {'platform_origin': 'https://fixture.invalid', 'user_id': 'platform-user'},
        'model_id': 'fixture-model', 'binding_revision': 1, 'credential_version': 3,
    }
    def status(peer=controller, **changes):
        return call(peer, 'session.managed_model_status', **(request | changes))
    assert existing.result(status()) == {'reusable': False, 'managed_device_key': 1}

    payload, _ = existing.prepare(call, sid, owner, controller)
    payload.update(credential_type='device', credential_version=3, expires_at=None)
    existing.result(call(controller, 'session.bind_managed_model', **payload))
    request['binding_revision'] = payload['binding_revision']
    binding = get_registry().get(sid)
    session = existing.srv._sessions[sid]
    history = session['history']
    for _ in range(100):
        assert existing.result(status()) == {'reusable': True, 'managed_device_key': 1}
    assert get_registry().get(sid) is binding
    assert session['history'] is history

    for peer, changes in (
        (owner, {}), (stranger, {}), (existing.Peer(), {}),
        (controller, {'owner': {**request['owner'], 'user_id': 'other-account'}}),
        (controller, {'model_id': 'other-model'}),
        (controller, {'purpose': 'image'}),
        (controller, {'binding_revision': binding.binding_revision + 1}),
        (controller, {'credential_version': 2}),
    ):
        response = status(peer, **changes)
        assert 'error' in response or existing.result(response) == {'reusable': False, 'managed_device_key': 1}
        assert payload['api_key'] not in json.dumps(response)
    assert 'error' in status(profile='other-profile')
    assert get_registry().get(sid) is binding

    get_registry().clear_session(sid)
    assert existing.result(status()) == {'reusable': False, 'managed_device_key': 1}


@pytest.mark.parametrize('loss', [
    'lease', 'controller_disconnect', 'owner_reconnect', 'selection_change', 'selection_missing', 'closed', 'pending',
])
def test_status_does_not_reuse_a_lease_or_a_retired_binding(rig, loss):
    call, create, owner, controller, _, _ = rig
    sid = create(model_source='aino', model_id='fixture-model')
    payload, _ = existing.prepare(call, sid, owner, controller)
    if loss != 'lease':
        payload.update(credential_type='device', credential_version=3, expires_at=None)
    existing.result(call(controller, 'session.bind_managed_model', **payload))
    session = existing.srv._sessions[sid]
    transitions = {
        'lease': lambda: None,
        'controller_disconnect': lambda: get_registry().disconnect(controller),
        'owner_reconnect': lambda: session.update(transport=existing.Peer()),
        'selection_change': lambda: session.update(
            managed_pending_switch=True,
            managed_model_params={**session['managed_model_params'], 'model_id': 'replacement-model'}),
        'selection_missing': lambda: session.pop('managed_model_params'),
        'closed': lambda: session.update(_closing=True),
        'pending': lambda: existing.prepare(call, sid, owner, controller),
    }
    transitions[loss]()
    response = call(controller, 'session.managed_model_status', **{
        key: payload[key] for key in ('session_id', 'owner', 'model_id', 'binding_revision')
    }, credential_version=3)
    assert 'error' in response or existing.result(response) == {'reusable': False, 'managed_device_key': 1}


@pytest.mark.parametrize('version', [None, 0, -1, True, '3'])
def test_device_binding_rejects_missing_or_invalid_credential_version(rig, version):
    call, create, owner, controller, _, _ = rig
    sid = create(model_source='aino', model_id='fixture-model')
    payload, _ = existing.prepare(call, sid, owner, controller)
    payload.update(credential_type='device', expires_at=None)
    if version is not None:
        payload['credential_version'] = version
    assert 'error' in call(controller, 'session.bind_managed_model', **payload)
    assert get_registry().get(sid) is None


def test_image_status_and_clear_do_not_reuse_or_retire_chat_authority(rig):
    call, create, owner, controller, _, home = rig
    (home / 'config.yaml').write_text(json.dumps({'image_gen': {'provider': 'aino', 'model': 'image-model'}}))
    sid = create(model_source='aino', model_id='fixture-model')
    chat, _ = existing.prepare(call, sid, owner, controller)
    chat.update(credential_type='device', credential_version=3, expires_at=None)
    existing.result(call(controller, 'session.bind_managed_model', **chat))
    image = {key: chat[key] for key in ('session_id', 'owner')}
    image.update(purpose='image', model_id='image-model')
    ticket = existing.result(call(owner, 'session.managed_model_ticket', **image))
    claim = existing.result(call(controller, 'session.claim_managed_model', **image,
                                 session_ticket=ticket['session_ticket']))
    image.update(binding_revision=claim['binding_revision'], credential_version=3)
    existing.result(call(controller, 'session.bind_managed_model', **(chat | image | {
        'api_mode': 'images_generations', 'model': 'image-upstream',
        'capabilities': {'tools': False, 'vision': False, 'reasoning': False, 'image_generation': True},
    })))
    assert existing.result(call(controller, 'session.managed_model_status', **image))['reusable']
    chat_status = {key: chat[key] for key in (
        'session_id', 'owner', 'model_id', 'binding_revision', 'credential_version')}
    assert existing.result(call(controller, 'session.managed_model_status', **chat_status))['reusable']
    existing.result(call(controller, 'session.clear_managed_model', session_id=sid,
                         purpose='image', binding_revision=claim['binding_revision']))
    assert not existing.result(call(controller, 'session.managed_model_status', **image))['reusable']
    assert existing.result(call(controller, 'session.managed_model_status', **chat_status))['reusable']

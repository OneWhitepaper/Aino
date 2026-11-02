"""Image leases reuse managed authority while remaining separate from chat credentials."""
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from tui_gateway.managed_model_runtime import ManagedModelBinding, ManagedModelOwner, ManagedModelRegistry
from tui_gateway.methods_managed_model import _binding
from tests.tui_gateway import test_managed_model_binding as model_binding_tests
from tests.tui_gateway.test_managed_model_binding import result


@pytest.fixture
def image_binding_rig(tmp_path, monkeypatch):
    yield from model_binding_tests.rig.__wrapped__(tmp_path, monkeypatch)


def _lease(registry, session, viewer, controller, *, purpose='chat'):
    owner = ManagedModelOwner('https://account.example', 'account')
    token = registry.issue('s', session, viewer, owner, purpose, purpose=purpose)
    revision = registry.claim('s', session, controller, token, owner, purpose, purpose=purpose)
    binding = ManagedModelBinding('s', owner, purpose, f'{purpose}-wire',
        'images_generations' if purpose == 'image' else 'chat_completions',
        {'tools': purpose == 'chat', 'vision': False, 'reasoning': False, 'image_generation': purpose == 'image'},
        f'{purpose}-credential', f'{purpose}-secret', 'https://account.example/v1',
        datetime.now(UTC) + timedelta(minutes=10), revision, purpose=purpose)
    registry.bind(binding, session, controller)
    return binding


def test_image_renew_clear_disconnect_and_lifecycle_are_isolated_from_chat(monkeypatch):
    from types import SimpleNamespace
    import tui_gateway.managed_model_runtime as runtime

    registry, viewer, chat_controller, image_controller = ManagedModelRegistry(), object(), object(), object()
    interrupted = []
    session = {'transport': viewer, 'managed_image_params': {'model_id': 'image'},
               '_interrupt_managed': lambda: interrupted.append(True)}
    try:
        chat = _lease(registry, session, viewer, chat_controller)
        session['running'] = True
        image = _lease(registry, session, viewer, image_controller, purpose='image')
        assert registry.get('s') is chat
        assert registry.get('s', purpose='image') is image
        assert 'managed_model_params' not in session
        renewed = replace(image, api_key='renewed-image-secret', expires_at=image.expires_at + timedelta(seconds=1))
        registry.renew(renewed, session, image_controller)
        assert registry.clear('s', image.binding_revision, image_controller, purpose='image')
        assert registry.get('s') is chat and not interrupted
        _lease(registry, session, viewer, image_controller, purpose='image')
        registry.disconnect(image_controller)
        assert registry.get('s') is chat and registry.get('s', purpose='image') is None and not interrupted
        image = _lease(registry, session, viewer, image_controller, purpose='image')
        with monkeypatch.context() as patch:
            patch.setattr(runtime, 'datetime', SimpleNamespace(now=lambda _tz: image.expires_at))
            assert registry.get('s', purpose='image') is None
        assert registry.get('s') is chat and not interrupted
        _lease(registry, session, viewer, image_controller, purpose='image')
        registry.clear_session('s')
        assert registry.get('s') is None and registry.get('s', purpose='image') is None
    finally:
        registry.clear_session('s')


@pytest.mark.parametrize('change', ['chat_mode', 'no_capability', 'chat_purpose'])
def test_image_binding_requires_its_exact_protocol_capability_and_purpose(change):
    params = {'owner': {'platform_origin': 'https://account.example', 'user_id': 'account'},
        'purpose': 'image', 'model_id': 'image', 'model': 'image-wire', 'api_mode': 'images_generations',
        'capabilities': {'tools': False, 'vision': False, 'reasoning': False, 'image_generation': True},
        'credential_id': 'id', 'api_key': 'secret', 'base_url': 'https://account.example/v1',
        'expires_at': (datetime.now(UTC) + timedelta(minutes=5)).isoformat(), 'binding_revision': 1}
    assert _binding(params, 's').purpose == 'image'
    if change == 'chat_mode': params['api_mode'] = 'chat_completions'
    elif change == 'no_capability': params['capabilities']['image_generation'] = False
    else: params['purpose'] = 'chat'
    with pytest.raises(ValueError):
        _binding(params, 's')


def test_standalone_image_binding_preserves_chat_selection_and_rejects_wrong_config(image_binding_rig):
    import json
    import tui_gateway.server as srv
    from tui_gateway.managed_model_runtime import get_registry

    call, create, viewer, controller, stranger, home = image_binding_rig
    (home / 'config.yaml').write_text(json.dumps({'image_gen': {'provider': 'aino', 'model': 'image'}}))
    sid = create()
    session = srv._sessions[sid]
    chat_selection = session.get('managed_model_params')
    params = {'session_id': sid, 'purpose': 'image', 'owner': {'platform_origin': 'https://account.example', 'user_id': 'account'}, 'model_id': 'image'}
    ticket = result(call(viewer, 'session.managed_model_ticket', **params))
    claim = result(call(controller, 'session.claim_managed_model', **params, session_ticket=ticket['session_ticket']))
    assert claim['managed_image_binding'] == 1
    binding = {**params, 'binding_revision': claim['binding_revision'], 'model': 'image-wire', 'api_mode': 'images_generations',
        'capabilities': {'tools': False, 'vision': False, 'reasoning': False, 'image_generation': True},
        'credential_id': 'id', 'api_key': 'image-secret', 'base_url': 'https://account.example/v1',
        'expires_at': (datetime.now(UTC) + timedelta(minutes=5)).isoformat()}
    assert 'error' in call(stranger, 'session.bind_managed_model', **binding)
    assert result(call(controller, 'session.bind_managed_model', **binding))['bound']
    assert get_registry().get(sid, purpose='image').api_key == 'image-secret'
    assert session.get('managed_model_params') == chat_selection
    assert result(call(controller, 'session.clear_managed_model', session_id=sid, purpose='image', binding_revision=claim['binding_revision']))['cleared']
    (home / 'config.yaml').write_text(json.dumps({'image_gen': {'provider': 'openai', 'model': 'image'}}))
    assert 'error' in call(viewer, 'session.managed_model_ticket', **params)


def test_releasing_chat_selection_preserves_the_image_lease():
    from tui_gateway.managed_session import release_selection
    from tui_gateway.managed_model_runtime import get_registry
    registry = get_registry()
    viewer, controller = object(), object()
    session = {'transport': viewer, 'managed_image_params': {'model_id': 'image'},
               'managed_model_params': {'model_source': 'aino', 'model_id': 'chat'}}
    try:
        image = _lease(registry, session, viewer, controller, purpose='image')
        release_selection('s', session)
        assert registry.get('s', purpose='image') is image
        assert 'managed_model_params' not in session
    finally:
        registry.clear_session('s')


@pytest.mark.parametrize('retirement', ['clear', 'disconnect'])
def test_idle_image_rebind_after_retirement_uses_fresh_account_authority(retirement):
    registry = ManagedModelRegistry()
    viewer, old_controller, new_controller = object(), object(), object()
    session = {'transport': viewer, 'managed_image_params': {'model_id': 'image'},
               'managed_model_params': {'model_source': 'aino', 'model_id': 'chat'}}
    new_owner = ManagedModelOwner('https://account.example', 'next-account')
    try:
        chat = _lease(registry, session, viewer, old_controller)
        image = _lease(registry, session, viewer, old_controller, purpose='image')
        with pytest.raises(ValueError):
            registry.issue('s', session, viewer, new_owner, 'image', purpose='image')
        assert registry.get('s', purpose='image') is image
        if retirement == 'clear':
            registry.clear('s', image.binding_revision, old_controller, purpose='image')
        else:
            # Image and chat may have independent native controller connections.
            image_controller = object()
            image = _lease(registry, session, viewer, image_controller, purpose='image')
            registry.disconnect(image_controller)
        old_ticket = registry.issue('s', session, viewer, image.owner, 'image', purpose='image')
        old_revision = registry.claim('s', session, old_controller, old_ticket, image.owner, 'image', purpose='image')
        session['running'] = True
        with pytest.raises(ValueError):
            registry.issue('s', session, viewer, new_owner, 'image', purpose='image')
        session['running'] = False
        ticket = registry.issue('s', session, viewer, new_owner, 'image', purpose='image')
        with pytest.raises(ValueError):
            registry.claim('s', session, old_controller, old_ticket, image.owner, 'image', purpose='image')
        with pytest.raises(ValueError):
            registry.bind(replace(image, binding_revision=old_revision), session, old_controller)
        with pytest.raises(ValueError):
            registry.renew(replace(image, expires_at=image.expires_at + timedelta(seconds=1)), session, old_controller)
        revision = registry.claim('s', session, new_controller, ticket, new_owner, 'image', purpose='image')
        rebound = replace(image, owner=new_owner, binding_revision=revision, api_key='new-image-secret')
        with pytest.raises(ValueError):
            registry.bind(rebound, session, old_controller)
        registry.bind(rebound, session, new_controller)
        assert registry.get('s', purpose='image') is rebound
        assert session['managed_image_params']['platform_owner']['user_id'] == 'next-account'
        assert registry.get('s') is chat
        registry.clear('s', chat.binding_revision, old_controller)
        with pytest.raises(ValueError):
            registry.issue('s', session, viewer, new_owner, 'chat')
    finally:
        registry.clear_session('s')


def test_standalone_fresh_image_ticket_can_rebind_account_after_controller_disconnect(image_binding_rig):
    import json
    import tui_gateway.server as srv
    from tui_gateway.managed_model_runtime import get_registry

    call, create, viewer, controller, _, home = image_binding_rig
    (home / 'config.yaml').write_text(json.dumps({'image_gen': {'provider': 'aino', 'model': 'image'}}))
    sid = create()
    session = srv._sessions[sid]
    chat_selection = session.get('managed_model_params')
    for account in ('first-account', 'next-account'):
        params = {'session_id': sid, 'purpose': 'image', 'model_id': 'image',
                  'owner': {'platform_origin': 'https://account.example', 'user_id': account}}
        ticket = result(call(viewer, 'session.managed_model_ticket', **params))
        claim = result(call(controller, 'session.claim_managed_model', **params, session_ticket=ticket['session_ticket']))
        binding = {**params, 'binding_revision': claim['binding_revision'], 'model': 'image-wire',
                   'api_mode': 'images_generations', 'credential_id': account, 'api_key': account + '-secret',
                   'base_url': 'https://account.example/v1',
                   'capabilities': {'tools': False, 'vision': False, 'reasoning': False, 'image_generation': True},
                   'expires_at': (datetime.now(UTC) + timedelta(minutes=5)).isoformat()}
        assert result(call(controller, 'session.bind_managed_model', **binding))['bound']
        assert get_registry().get(sid, purpose='image').owner.user_id == account
        assert session.get('managed_model_params') == chat_selection
        get_registry().disconnect(controller)

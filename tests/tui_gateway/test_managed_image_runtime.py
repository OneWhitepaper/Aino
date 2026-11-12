"""Image authority is explicit per turn and never borrowed from another session."""

from contextvars import copy_context
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest


def test_image_scope_restores_owner_and_keeps_only_live_credentials():
    from agent.managed_image_provider import current_image_binding, managed_image_scope

    first = SimpleNamespace(purpose="image", expires_at=datetime.now(UTC) + timedelta(minutes=2))
    second = SimpleNamespace(purpose="image", expires_at=datetime.now(UTC) + timedelta(minutes=2))
    live = [first]
    assert current_image_binding() is None
    with managed_image_scope(lambda: live[0]):
        assert current_image_binding() is first
        copied = copy_context()
        live[0] = second
        assert copied.run(current_image_binding) is second
        with managed_image_scope(lambda: None):
            assert current_image_binding() is None
        assert current_image_binding() is second
    assert current_image_binding() is None


@pytest.mark.parametrize("purpose,offset", [("chat", 120), ("image", -1)])
def test_image_scope_refuses_chat_or_expired_lease(purpose, offset):
    from agent.managed_image_provider import current_image_binding, managed_image_scope

    binding = SimpleNamespace(purpose=purpose, expires_at=datetime.now(UTC) + timedelta(seconds=offset))
    with managed_image_scope(lambda: binding):
        assert current_image_binding() is None


def test_canonical_scope_fences_generation_and_rechecks_live_selection(monkeypatch):
    from hermes_state_runtime import RuntimeStoreError
    from agent.managed_image_provider import current_image_binding
    from tui_gateway.managed_image_runtime import conversation_image_scope
    from tui_gateway.managed_model_runtime import get_registry

    authority = SimpleNamespace(profile_id="profile", sessions={"sid": object()}, executing={"sid": 7})
    lease = SimpleNamespace(purpose="image", expires_at=datetime.now(UTC) + timedelta(minutes=2))
    state = {}
    selection = [state]
    def selected(*_args, **_kwargs):
        if selection[0] is None:
            raise RuntimeStoreError("managed_binding_forbidden")
        return selection[0]
    monkeypatch.setattr("gateway.session_platform_model.managed_state", selected)
    monkeypatch.setattr(get_registry(), "get", lambda *_args, **_kwargs: lease)
    with conversation_image_scope(owner=(authority, "sid", 7)):
        assert current_image_binding() is lease
        stale = copy_context()
        authority.executing["sid"] = 8
        assert stale.run(current_image_binding) is None
        authority.executing["sid"] = 7
        selection[0] = None
        assert current_image_binding() is None


def test_copied_legacy_turn_cannot_keep_image_authority_after_scope_exit(monkeypatch):
    from agent.managed_image_provider import current_image_binding
    from tui_gateway.managed_image_runtime import conversation_image_scope
    from tui_gateway.managed_model_runtime import get_registry

    lease = SimpleNamespace(purpose="image", expires_at=datetime.now(UTC) + timedelta(minutes=2))
    monkeypatch.setattr("tui_gateway.methods_managed_model._image_selection", lambda *_a: None)
    monkeypatch.setattr(get_registry(), "get", lambda *_a, **_k: lease)
    with conversation_image_scope(session_id="legacy", session={}):
        assert current_image_binding() is lease
        old_turn = copy_context()
    assert old_turn.run(current_image_binding) is None


@pytest.mark.parametrize("boundary", ["selection", "lease"])
@pytest.mark.parametrize("change", ["generation", "session"])
def test_canonical_scope_refuses_owner_changed_during_resolution(monkeypatch, boundary, change):
    from agent.managed_image_provider import current_image_binding
    from tui_gateway.managed_image_runtime import conversation_image_scope
    from tui_gateway.managed_model_runtime import get_registry

    authority = SimpleNamespace(profile_id="profile", sessions={"sid": object()}, executing={"sid": 7})
    lease = SimpleNamespace(purpose="image", expires_at=datetime.now(UTC) + timedelta(minutes=2))

    def change_owner():
        if change == "generation":
            authority.executing["sid"] = 8
        else:
            authority.sessions["sid"] = object()

    def selected(*_args, **_kwargs):
        if boundary == "selection":
            change_owner()
        return {}

    def bound(*_args, **_kwargs):
        if boundary == "lease":
            change_owner()
        return lease

    monkeypatch.setattr("gateway.session_platform_model.managed_state", selected)
    monkeypatch.setattr(get_registry(), "get", bound)
    with conversation_image_scope(owner=(authority, "sid", 7)):
        assert current_image_binding() is None


def test_image_rejection_uses_its_owner_and_cannot_outlive_scope():
    from agent.managed_image_provider import managed_image_scope, notify_image_credential_rejection
    from tui_gateway.managed_model_runtime import ManagedModelOwner

    binding = SimpleNamespace(purpose='image', expires_at=None,
                              owner=ManagedModelOwner('https://aino.invalid', 'image-owner'))
    notices = []
    with managed_image_scope(lambda: binding, on_rejection=notices.append):
        notify_image_credential_rejection('foreign-owner', 7)
        notify_image_credential_rejection('image-owner', True)
        notify_image_credential_rejection('image-owner', 0)
        assert notices == []
        notify_image_credential_rejection('image-owner', 7)
        old_turn = copy_context()
    old_turn.run(notify_image_credential_rejection, 'image-owner', 7)
    notify_image_credential_rejection('image-owner', 7)
    assert len(notices) == 1
    assert notices[0]['owner_user_id'] == 'image-owner'
    assert notices[0]['managed_credential_version'] == 7


@pytest.mark.parametrize('boundary', ['generation', 'session', 'selection'])
def test_image_rejection_cannot_notify_after_canonical_owner_changes(monkeypatch, boundary):
    from hermes_state_runtime import RuntimeStoreError
    from agent.managed_image_provider import notify_image_credential_rejection
    from tui_gateway.managed_image_runtime import conversation_image_scope
    from tui_gateway.managed_model_runtime import ManagedModelOwner, get_registry

    notices = []
    authority = SimpleNamespace(profile_id='profile', sessions={'sid': object()}, executing={'sid': 7})
    binding = SimpleNamespace(purpose='image', expires_at=None,
                              owner=ManagedModelOwner('https://aino.invalid', 'image-owner'))
    available = [True]

    def selected(*_args, **_kwargs):
        if not available[0]:
            raise RuntimeStoreError('managed_binding_forbidden')
        return {}

    monkeypatch.setattr('gateway.session_platform_model.managed_state', selected)
    monkeypatch.setattr(get_registry(), 'get', lambda *_a, **_k: binding)
    with conversation_image_scope(owner=(authority, 'sid', 7), on_rejection=notices.append):
        notify_image_credential_rejection('image-owner', 7)
        old_turn = copy_context()
        if boundary == 'generation':
            authority.executing['sid'] = 8
        elif boundary == 'session':
            authority.sessions.clear()
        else:
            available[0] = False
        old_turn.run(notify_image_credential_rejection, 'image-owner', 7)
    old_turn.run(notify_image_credential_rejection, 'image-owner', 7)
    assert len(notices) == 1

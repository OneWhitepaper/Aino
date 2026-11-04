"""The existing managed registry's image authority, resolved for the exact executing turn."""

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime


_image_binding = ContextVar("managed_image_binding_resolver", default=None)


@contextmanager
def managed_image_scope(resolve, *, on_rejection=None):
    active = [True]

    def live_binding():
        return resolve() if active[0] else None

    token = _image_binding.set((live_binding, on_rejection))
    try:
        yield
    finally:
        active[0] = False
        _image_binding.reset(token)


def current_image_binding():
    scope = _image_binding.get()
    binding = scope[0]() if scope else None
    if (binding is None or binding.purpose != "image"
            or (binding.expires_at is not None and binding.expires_at <= datetime.now(UTC))):
        return None
    return binding


def notify_image_credential_rejection(owner_user_id, credential_version):
    scope = _image_binding.get()
    if scope is None or scope[1] is None or type(credential_version) is not int or credential_version <= 0:
        return
    binding = current_image_binding()
    if binding is None or binding.owner.user_id != owner_user_id:
        return
    scope[1]({
        'text': 'Aino device authorization was rejected. Check this device\'s authorization in your account.',
        'level': 'error', 'kind': 'sticky', 'key': 'aino.managed_credential_rejected',
        'code': 'managed_credential_rejected', 'billing_source': 'aino', 'purpose': 'image',
        'owner_user_id': owner_user_id, 'managed_credential_version': credential_version,
    })


@contextmanager
def conversation_image_scope(*, owner=None, session_id=None, session=None, on_rejection=None):
    """No ambient session lookup: the turn runner supplies the captured owner."""
    from .managed_model_runtime import get_registry
    active = [True]

    def resolve():
        if not active[0]:
            return None
        if owner is not None:
            from gateway.session_platform_model import binding_key, managed_state
            from hermes_state_runtime import RuntimeStoreError
            authority, sid, generation = owner
            live = authority.sessions.get(sid)
            if live is None or authority.executing.get(sid) != generation:
                return None
            try:
                state = managed_state(authority, sid, purpose="image")
            except RuntimeStoreError:
                return None
            if (not active[0] or authority.sessions.get(sid) is not live
                    or authority.executing.get(sid) != generation):
                return None
            binding = get_registry().get(binding_key(authority, sid), state, purpose="image")
            if (not active[0] or authority.sessions.get(sid) is not live
                    or authority.executing.get(sid) != generation):
                return None
            return binding
        if session_id is not None and session is not None:
            from .methods_managed_model import _image_selection
            from .managed_model_runtime import ManagedBindingError
            try:
                _image_selection(session_id, session)
            except ManagedBindingError:
                return None
            if not active[0]:
                return None
            binding = get_registry().get(session_id, session, purpose="image")
            return binding if active[0] else None
        return None

    with managed_image_scope(resolve, on_rejection=on_rejection):
        try:
            yield
        finally:
            active[0] = False

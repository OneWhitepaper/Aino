"""The existing managed registry's image lease, resolved for the exact executing turn."""

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime


_image_binding = ContextVar("managed_image_binding_resolver", default=None)


@contextmanager
def managed_image_scope(resolve):
    token = _image_binding.set(resolve)
    try:
        yield
    finally:
        _image_binding.reset(token)


def current_image_binding():
    resolver = _image_binding.get()
    binding = resolver() if resolver else None
    if (binding is None or binding.purpose != "image"
            or binding.expires_at <= datetime.now(UTC)):
        return None
    return binding


@contextmanager
def conversation_image_scope(*, owner=None, session_id=None, session=None):
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

    with managed_image_scope(resolve):
        try:
            yield
        finally:
            active[0] = False

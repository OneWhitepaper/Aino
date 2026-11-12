"""Resolve the exact executing turn's authority before binding managed image work."""

from contextlib import contextmanager

from agent.managed_image_provider import managed_image_scope


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

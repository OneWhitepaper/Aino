"""Lazy maintenance boundaries: importing an agent must not initialize the gateway package."""
import functools
from contextlib import nullcontext


def managed_agent_call(function):
    @functools.wraps(function)
    def wrapped(agent, *args, **kwargs):
        root = getattr(agent, '_conversation_maintenance_root', None)
        if root is None:
            return function(agent, *args, **kwargs)
        from gateway.hosted_room_conversation_maintenance import managed_operation
        with managed_operation(root):
            return function(agent, *args, **kwargs)
    return wrapped


def managed_session_call(function):
    @functools.wraps(function)
    def wrapped(db, *args, **kwargs):
        from gateway.hosted_room_conversation_maintenance import managed_session_call as decorate
        return decorate(function)(db, *args, **kwargs)
    return wrapped


def managed_schema_call(function):
    @functools.wraps(function)
    def wrapped(db, *args, **kwargs):
        from gateway.hosted_room_conversation_maintenance import managed_schema_call as decorate
        return decorate(function)(db, *args, **kwargs)
    return wrapped


def managed_input_context(function):
    @functools.wraps(function)
    def wrapped(agent, *args, **kwargs):
        from gateway.hosted_room_conversation_maintenance import session_operation
        db = getattr(agent, '_session_db', None)
        permit = session_operation(db, getattr(agent, 'session_id', None), force=True) if db else nullcontext()
        with permit:
            yield from function(agent, *args, **kwargs)
    return wrapped

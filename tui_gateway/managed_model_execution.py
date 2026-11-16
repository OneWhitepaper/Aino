"""In-flight model authority belongs to the admitted execution, not its viewer socket."""

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime


_execution = ContextVar('managed_model_execution', default=None)


@contextmanager
def managed_execution_scope(key, generation):
    token = _execution.set((key, generation))
    try:
        yield
    finally:
        _execution.reset(token)


class ManagedExecutionBindings:
    """Lifecycle hooks on ManagedModelRegistry; no authority is persisted or transferred to clients."""

    def retain_execution(self, sid, session, generation):
        key = self._key(sid, 'chat')
        with self._lock:
            a = self._active.get(key)
            if (a is not None and a.session is session and not a.detached
                    and a.peer is session.get('transport') and not session.get('_closing')):
                a.generation = generation
                self._executions[key] = a

    def release_execution(self, sid, generation):
        key = self._key(sid, 'chat')
        with self._lock:
            a = self._executions.get(key)
            if a is None or a.generation != generation:
                return
            self._executions.pop(key)
            if a.detached and self._active.get(key) is a:
                self._active.pop(key)
                self._cancel(a)

    def get_for_execution(self, sid, session, generation):
        key = self._key(sid, 'chat')
        with self._lock:
            a = self._executions.get(key)
            if (a is None or a.generation != generation or a.session is not session
                    or self._active.get(key) is not a):
                return None
            if (not session.get('_closing')
                    and (a.detached or a.peer is session.get('transport'))
                    and (a.binding.expires_at is None or a.binding.expires_at > datetime.now(UTC))):
                return a.binding
        self._expire(key, a)
        return None

    def get_for_runtime(self, sid, session):
        execution = _execution.get()
        if execution is not None and execution[0] == sid:
            held = self.get_for_execution(sid, session, execution[1])
            if held is not None:
                return held
        # Auxiliary work outside the admitted turn still needs a connected controller.
        return self.get(sid, session)

    def _handoff_transport(self, key, session, peer):
        if session.get('transport') is not peer:
            a = self._active.get(key)
            if a is not None and a.session is session:
                if self._executions.get(key) is a:
                    a.detached = True
                else:
                    self._active.pop(key)
                    self._cancel(a)
            session['transport'] = peer

    def _replace_execution(self, key, previous, replacement):
        if previous is not None and self._executions.get(key) is previous:
            replacement.generation = previous.generation
            self._executions[key] = replacement

    def _forget_execution(self, key, a):
        if self._executions.get(key) is a:
            self._executions.pop(key)

    def detach_transport(self, peer):
        removed = []
        with self._lock:
            for pool in (self._pending, self._active):
                for key, a in list(pool.items()):
                    if peer is not a.peer and peer is not a.controller:
                        continue
                    if pool is self._active and self._executions.get(key) is a:
                        a.detached = True
                    else:
                        removed.append(pool.pop(key))
                        self._cancel(a)
        return removed

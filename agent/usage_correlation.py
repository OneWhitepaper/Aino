"""Thread-safe display receipts for the HTTP calls belonging to a managed turn."""

from threading import RLock


class TurnCallTracker:
    def __init__(self):
        self._lock = RLock()
        self._calls = []
        self._non_aino_model_calls = False
        self._background = 0
        self._foreground_done = False
        self._revision = 0
        self._listener = None
        self._managed_owner = None

    def bind_managed_owner(self, user_id, session_id):
        """Attach one billing identity to mixed BYOK/tool receipts, never a credential."""
        with self._lock:
            owner = (user_id, session_id)
            if self._managed_owner not in (None, owner):
                raise RuntimeError("managed_billing_scope_mismatch")
            self._managed_owner = owner

    def managed_owner(self):
        with self._lock:
            return self._managed_owner

    def snapshot(self):
        with self._lock:
            result = {"calls": [dict(call) for call in self._calls],
                      "calls_complete": self._foreground_done and self._background == 0,
                      "revision": self._revision}
            if self._non_aino_model_calls:
                result["non_aino_model_calls"] = True
            return result

    def _changed(self):
        self._revision += 1
        if self._listener:
            self._listener(self.snapshot())
        if self._foreground_done and self._background == 0:
            self._listener = None

    def record(self, call_id, purpose):
        with self._lock:
            self._calls.append({"call_id": call_id, "purpose": purpose})
            self._changed()

    def record_non_aino_model_call(self):
        with self._lock:
            if self._non_aino_model_calls:
                return
            self._non_aino_model_calls = True
            self._changed()

    def start_background(self):
        with self._lock:
            self._background += 1
            self._changed()

    def end_background(self):
        with self._lock:
            self._background -= 1
            self._changed()

    def finish_and_watch(self, listener):
        # Serialize initial persistence with late dispatches and background completion.
        with self._lock:
            self._foreground_done = True
            self._listener = listener
            self._changed()

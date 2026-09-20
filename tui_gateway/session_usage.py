"""Live usage snapshots for a running desktop/TUI turn."""
from __future__ import annotations

import threading
from .method_ctx import bind_module


def _start_usage_ticker(sid: str, agent, interval: float = 1.0) -> tuple[threading.Event, threading.Thread]:
    """Push live ``session.usage`` snapshots every ``interval`` s while a turn runs. The caller must set the
    Event AND join the thread before ``message.complete``: a late tick would roll the final usage back."""
    stop = threading.Event()
    # Dedup baseline sampled BEFORE the thread starts (the client has the turn-start values); a late-scheduled
    # thread would otherwise absorb the first counter growth and never emit it.
    baseline: dict | None = None
    with contextlib.suppress(Exception):
        baseline = _get_usage(agent)

    def _loop() -> None:
        last = baseline
        while not stop.wait(interval):
            with contextlib.suppress(Exception):
                usage = _get_usage(agent)
                if usage == last:
                    continue  # counters frozen (one long API call in flight): don't re-render the status bar
                last = usage
                if stop.is_set():
                    break  # turn ended while snapshotting; message.complete carries the authoritative usage
                _emit("session.usage", sid, {"usage": usage})
    import contextvars
    context = contextvars.copy_context()
    thread = _RealThread(target=lambda: context.run(_loop), daemon=True)
    thread.start()
    return stop, thread


def register(server) -> None:
    bind_module(globals(), server)

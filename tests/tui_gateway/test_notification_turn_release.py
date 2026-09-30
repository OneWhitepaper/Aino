"""Notification dispatch must release its turn claim and retain every unadmitted result.

Claim failures happen before prompt admission and must clear ``running`` themselves. Real
prompt refusals already do that, but the consumer must also preserve its event for a retry
without spending a durable delivery attempt or resurrecting already-consumed process output.
"""

from __future__ import annotations

import os
import queue
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from tui_gateway import server

DELEGATION = {"type": "async_delegation", "delegation_id": "deleg-1", "session_key": "stored"}


def _claimed_session() -> dict:
    session = {"history_lock": threading.RLock(), "running": False, "history": []}
    assert server._notif_claim_turn(session) is True
    return session


def _no_turn(monkeypatch) -> list:
    started: list = []
    monkeypatch.setattr(server, "_run_prompt_submit", lambda *a, **k: started.append(a))
    monkeypatch.setattr(server, "_emit", lambda *a, **k: None)
    return started


@pytest.mark.parametrize("claim", [None, sqlite3.OperationalError("database is locked")],
                         ids=["row-held-by-another-consumer", "ledger-unreadable"])
def test_a_lost_delivery_claim_hands_the_turn_back(monkeypatch, claim):
    """A gateway sharing this home claims the durable row before it verifies the target, so the
    poller holding the live copy of the same event gets ``None`` — after it already took the turn.

    The copy is discarded here, so a delegation's in-memory offer must go back too: leaving it
    registered makes this process's orphan sweep skip a row that has no live copy left."""
    def _claim(evt, consumer):
        if isinstance(claim, Exception):
            raise claim
        return claim

    returned: list = []
    monkeypatch.setattr("tools.async_delegation.claim_event_delivery", _claim)
    monkeypatch.setattr("tools.async_delegation.return_completion_offer", lambda evt: returned.append(evt))
    started = _no_turn(monkeypatch)
    session = _claimed_session()

    server._notif_dispatch_event("sid", session, dict(DELEGATION), "text")

    assert session["running"] is False
    assert started == []
    assert [evt["delegation_id"] for evt in returned] == ["deleg-1"]
    assert server._notif_claim_turn(session) is True, "the session must be claimable again"


def test_a_delegation_whose_notification_text_is_empty_hands_its_offer_back(monkeypatch):
    """No text means no turn and no delivery from this copy, so the offer must not stay registered.

    The origin gate is satisfied on purpose: an unowned event already returns the offer on its
    drop path, so only an owned copy isolates the empty-render branch."""
    returned: list = []
    monkeypatch.setattr("tools.async_delegation.return_completion_offer", lambda evt: returned.append(evt))
    started = _no_turn(monkeypatch)
    evt = {**DELEGATION, "origin_ui_session_id": "sid"}

    delivered = server._notif_handle_event(
        "sid", {"history_lock": threading.RLock(), "running": False, "history": []},
        evt, set(), SimpleNamespace(completion_queue=queue.Queue()),
        lambda evt: "", None,
    )

    assert delivered is True
    assert started == []
    assert [e["delegation_id"] for e in returned] == ["deleg-1"]


@pytest.fixture
def notification_admission(tmp_path, monkeypatch):
    """Keep prompt admission, the profile store and event queue real; stop before model work."""
    from tools import async_delegation as ad
    from tools.process_registry import ProcessRegistry
    from tools.process_registry_notifications import format_process_notification

    home = tmp_path / "profile"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    sid = "notification-admission"
    session = {"session_key": "owner", "profile_home": str(home), "history": [],
               "running": False, "history_lock": threading.RLock(),
               "agent": SimpleNamespace(session_id="owner", clear_interrupt=lambda: None),
               "managed_model_params": {"model_source": "aino", "model_id": "unbound"}}
    frames, workers = [], []
    monkeypatch.setattr(server, "_sessions", {sid: session})
    monkeypatch.setattr(server, "_emit", lambda *args, **kwargs: frames.append(args))

    def start_worker(_target, *, name, session):
        workers.append(session["inflight_turn"]["user"])
        return object()

    monkeypatch.setattr(server, "_start_session_work", start_worker)
    ad._reset_for_tests()
    with server._session_profile_runtime_scope(session):
        registry = ProcessRegistry()
        monkeypatch.setattr("tools.process_registry.process_registry", registry)
        try:
            yield SimpleNamespace(sid=sid, session=session, registry=registry, ad=ad,
                                  fmt=format_process_notification, frames=frames, workers=workers)
        finally:
            if lease := session.get("active_session_lease"):
                lease.release()
            ad._reset_for_tests()


@pytest.mark.parametrize("event_kind,refund_failures", [
    ("durable", 0), pytest.param("durable", 2, id="durable_refund_retry"),
    ("interim", 0), ("watch", 0),
])
def test_a_notification_rejected_before_turn_start_stays_pending(
    notification_admission, event_kind, refund_failures, monkeypatch,
):
    """Repeated real credential refusals keep one live copy and spend no delivery attempts."""
    env = notification_admission
    events, ad = env.registry.completion_queue, env.ad
    handle = ad.dispatch_async_delegation(
        goal="notify owner", context=None, toolsets=None, role="leaf", model="m",
        session_key="owner", parent_session_id="owner", origin_ui_session_id=env.sid,
        runner=lambda: {"status": "completed", "summary": "retained result"})
    event = events.get(timeout=10)
    if event_kind == "interim":
        event = {**event, "task_failure_notice": True, "results": [
            {"task_index": 0, "status": "error", "error": "child failed"}]}
    elif event_kind == "watch":
        event = {"type": "watch_match", "session_id": "proc-watch", "session_key": "owner",
                 "command": "build", "pattern": "ready", "output": "retained result"}
    if refund_failures:
        from sqlite3 import OperationalError

        real_defer, remaining_failures = ad.defer_completion_delivery, refund_failures

        def defer(delegation_id, claim_id):
            nonlocal remaining_failures
            if remaining_failures:
                remaining_failures -= 1
                raise OperationalError("database is locked")
            return real_defer(delegation_id, claim_id)

        monkeypatch.setattr(ad, "defer_completion_delivery", defer)
    events.put(event)
    emitted = set()
    for attempt in range(ad._MAX_DELIVERY_ATTEMPTS + 2):
        server._notif_handle_ready(env.sid, env.session, [events.get_nowait()], emitted,
                                   env.registry, env.fmt, None)
        assert env.session["running"] is False
        assert events.qsize() == 1, "a live owner must keep the same rejected event queued"
        row = ad.get_durable_delegation(handle["delegation_id"])
        assert (row["delivery_state"], row["delivery_attempts"]) == (
            "pending", int(attempt < refund_failures))
        assert ad.sweep_orphaned_completions(events, now=time.time() + 600) == 0
        assert events.qsize() == 1
        assert env.workers == []
    assert any(frame[0] == "error" and frame[2].get("reason") == "awaiting_managed_credentials"
               for frame in env.frames)

    env.session.pop("managed_model_params")
    assert events.get_nowait() is event
    server._notif_handle_ready(env.sid, env.session, [event], emitted, env.registry, env.fmt, None)
    row = ad.get_durable_delegation(handle["delegation_id"])
    assert (row["delivery_state"], row["delivery_attempts"]) == (
        ("delivered", 1) if event_kind == "durable" else ("pending", 0))
    assert len(env.workers) == 1
    assert ad.sweep_orphaned_completions(events, now=time.time() + 600) == 0
    assert events.empty()
    server._notif_handle_ready(env.sid, env.session, [], emitted, env.registry, env.fmt, None)
    assert len(env.workers) == 1


@pytest.mark.parametrize("fail_at", ["claim", "render"])
def test_a_completion_batch_that_cannot_be_prepared_hands_the_turn_back(monkeypatch, fail_at):
    events = [{"type": "completion", "session_id": "proc_a"}, {"type": "completion", "session_id": "proc_b"}]
    released: list = []
    claims = iter(["claim-a", sqlite3.OperationalError("database is locked")] if fail_at == "claim"
                  else ["claim-a", "claim-b"])

    def _claim(evt, consumer):
        value = next(claims)
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr("tools.async_delegation.claim_event_delivery", _claim)
    monkeypatch.setattr("tools.async_delegation.release_event_delivery", lambda evt, c: released.append(c))
    if fail_at == "render":
        monkeypatch.setattr("tools.process_registry_notifications.ProcessNotificationBatch.render",
                            lambda self, registry: (_ for _ in ()).throw(ValueError("bad payload")))
    started = _no_turn(monkeypatch)
    session = {"history_lock": threading.RLock(), "running": False, "history": []}

    server._notif_dispatch_completions("sid", session, [(e, "t") for e in events],
                                       SimpleNamespace(completion_queue=queue.Queue()), None)

    assert session["running"] is False and started == []
    # Claims already taken go back too, or those completions are lost to every consumer for 300 s.
    assert released == (["claim-a"] if fail_at == "claim" else ["claim-a", "claim-b"])


@pytest.mark.parametrize("shutdown_drain", [False, True])
def test_a_completion_batch_rejected_before_turn_start_stays_pending(notification_admission, shutdown_drain):
    """Refused process batches survive in order; already-read output is never replayed."""
    env = notification_admission
    registry = env.registry
    for command in ("already consumed", "first result", "second result"):
        proc = registry._new_session(command, "", "", "owner", None)
        proc.notify_on_complete = True
        proc.append_output(command)
        registry._running[proc.id] = proc
        proc.mark_exited(0)
        registry._move_to_finished(proc)
    events = [registry.completion_queue.get_nowait() for _ in range(3)]
    notifications = [(event, env.fmt(event)) for event in events]
    registry.read_log(events[0]["session_id"])
    assert registry.is_completion_consumed(events[0]["session_id"])
    deferred = [] if shutdown_drain else None
    server._notif_dispatch_completions(env.sid, env.session, notifications, registry, deferred)
    assert env.session["running"] is False and env.workers == []
    retained = deferred if shutdown_drain else [registry.completion_queue.get_nowait()
                                               for _ in range(registry.completion_queue.qsize())]
    assert retained == events[1:], "only the two unread results should remain, in their original order"

    env.session.pop("managed_model_params")
    server._notif_dispatch_completions(env.sid, env.session, [(e, env.fmt(e)) for e in retained],
                                       registry, deferred)
    assert len(env.workers) == 1
    assert "first result" in env.workers[0] and "second result" in env.workers[0]
    assert "already consumed" not in env.workers[0]
    env.session["running"] = False
    for event in events[1:]:
        registry.read_log(event["session_id"])
    before = list(deferred) if deferred is not None else []
    server._notif_dispatch_completions(env.sid, env.session, notifications, registry, deferred)
    assert env.session["running"] is False and len(env.workers) == 1
    assert registry.completion_queue.empty()
    if deferred is not None:
        assert deferred == before


def test_a_loop_wakeup_whose_send_cannot_start_hands_the_turn_back(monkeypatch):
    """The /loop slash wakeup re-claims the turn for a command that resolves to a prompt, then runs
    the send under ``except Exception: pass`` — which swallowed the only signal that no turn started."""
    monkeypatch.setitem(server._methods, "command.dispatch",
                        lambda rid, params: {"result": {"type": "send", "message": "run the skill"}})
    monkeypatch.setattr(server, "_emit", lambda *a, **k: None)
    monkeypatch.setattr(server, "_run_prompt_submit",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no free worker")))
    ticks: list = []
    mgr = SimpleNamespace(abandon_tick=lambda: ticks.append("abandoned"),
                          complete_tick=lambda text: ticks.append("completed") or {})
    session = _claimed_session()

    server._notif_slash_loop_tick("rid", "sid", session, mgr, "/skill go")

    assert session["running"] is False
    assert ticks == ["completed"]


def test_the_poller_thread_survives_a_dispatch_that_raises(monkeypatch):
    """The poller is the session's only path to notifications, /loop, /heartbeat and its bot
    mailbox; an exception out of one event's dispatch used to end the thread for good."""
    events: queue.Queue = queue.Queue()
    events.put({"type": "completion", "session_id": "proc_a"})
    monkeypatch.setattr("tools.process_registry.process_registry", SimpleNamespace(completion_queue=events))
    for name in ("_poll_bot_live_delivery_guarded", "_maybe_fire_tui_loop_tick",
                 "_maybe_fire_tui_heartbeat_tick", "_notif_poll_kanban"):
        monkeypatch.setattr(server, name, lambda *a, **k: None)
    stop = threading.Event()
    handled: list = []

    def _handle_ready(sid, session, ready, emitted, registry, fmt, deferred, **kwargs):
        if deferred is not None:  # the post-stop drain
            return
        handled.append(len(ready))
        if len(handled) == 1:
            events.put({"type": "completion", "session_id": "proc_b"})
            raise RuntimeError("one bad event")
        stop.set()

    monkeypatch.setattr(server, "_notif_handle_ready", _handle_ready)
    session = {"history_lock": threading.RLock(), "running": False, "history": []}
    worker = threading.Thread(target=server._notification_poller_scoped_loop, args=(stop, "sid", session), daemon=True)
    worker.start()
    worker.join(timeout=10)

    assert not worker.is_alive()
    assert handled == [1, 1], "the second event must still be dispatched after the first one raised"


def test_live_poller_reoffers_an_orphan_after_wrong_owner_busy_and_failed_admission(tmp_path, monkeypatch):
    """A durable result survives an absent owner and a rejected turn, without duplicate admission."""
    from agent.secret_scope import is_multiplex_active, set_multiplex_active
    from tools import async_delegation as ad
    from tools.process_registry import process_registry

    repo = str(Path(__file__).resolve().parents[2])
    home = tmp_path / "profile"
    home.mkdir()
    producer = r'''
import os, time
from tools import async_delegation as ad
r = ad.dispatch_async_delegation(
    goal="recovery", context=None, toolsets=None, role="leaf", model="m",
    session_key="owner", parent_session_id="owner",
    runner=lambda: {"status": "completed", "summary": "persisted before reload"})
deadline = time.monotonic() + 10
while ad.active_count() and time.monotonic() < deadline:
    time.sleep(.01)
assert not ad.active_count()
print(r["delegation_id"], flush=True)
os._exit(0)
'''
    out = subprocess.run([sys.executable, "-c", producer], cwd=repo,
                         env={**os.environ, "HERMES_HOME": str(home), "PYTHONPATH": repo},
                         capture_output=True, text=True, check=True, timeout=60)
    delegation_id = out.stdout.strip().splitlines()[-1]

    def age_result():
        with sqlite3.connect(home / "state.db") as conn:
            conn.execute("UPDATE async_delegations SET updated_at=? WHERE delegation_id=?",
                         (time.time() - 600, delegation_id))

    def delivery():
        with sqlite3.connect(home / "state.db") as conn:
            return conn.execute("SELECT delivery_state, delivery_claim, delivery_attempts "
                                "FROM async_delegations WHERE delegation_id=?", (delegation_id,)).fetchone()

    events = queue.Queue()
    monkeypatch.setattr(process_registry, "completion_queue", events)
    monkeypatch.setattr(server, "_emit", lambda *a, **k: None)
    for name in ("_poll_bot_live_delivery_guarded", "_maybe_fire_tui_loop_tick", "_maybe_fire_tui_heartbeat_tick"):
        monkeypatch.setattr(server, name, lambda *a, **k: None)
    # Exercise the real poller on every pass without waiting for its scheduling interval.
    monkeypatch.setattr(ad, "ORPHAN_SWEEP_INTERVAL_S", 0.0, raising=False)
    attempts = []

    def submit(_rid, sid, _session, text, **kwargs):
        attempts.append((sid, text))
        if len(attempts) == 1:
            raise RuntimeError("no free worker")
        return True

    monkeypatch.setattr(server, "_run_prompt_submit", submit)
    sessions = {key: {"session_key": key, "profile_home": str(home), "history": [],
                      "running": False, "history_lock": threading.RLock()} for key in ("other", "owner")}
    monkeypatch.setattr(server, "_sessions", {"other": sessions["other"]})

    def poll(key):
        stop = threading.Event()
        monkeypatch.setattr(server, "_notif_poll_kanban", lambda *a: stop.set())
        server._notification_poller_loop(stop, key, sessions[key])

    previous_mode = is_multiplex_active()
    ad._reset_for_tests()
    set_multiplex_active(True)
    try:
        age_result()
        poll("other")  # No live owner yet; the discarded offer must remain recoverable.
        assert events.empty() and attempts == []
        assert delivery() == ("pending", None, 0)
        monkeypatch.setitem(server._sessions, "owner", sessions["owner"])
        sessions["owner"]["running"] = True
        for _ in range(2):
            poll("owner")
            assert events.qsize() == 1, "a busy owner must retain exactly one queued copy"
            assert delivery() == ("pending", None, 0)
        sessions["owner"]["running"] = False
        poll("owner")  # Admission fails after the durable claim; both claims must be returned.
        assert sessions["owner"]["running"] is False and events.empty()
        assert delivery() == ("pending", None, 1)
        age_result()
        poll("owner")
        assert delivery() == ("delivered", None, 2)
        sessions["owner"]["running"] = False
        poll("owner")
        assert len(attempts) == 2 and all(sid == "owner" for sid, _ in attempts)
        assert "persisted before reload" in attempts[-1][1]
        assert events.empty()
    finally:
        set_multiplex_active(previous_mode)
        ad._reset_for_tests()

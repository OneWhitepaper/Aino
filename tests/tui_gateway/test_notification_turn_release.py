"""A notification that claims the session's turn must hand it back whenever no turn runs.

The poller claims the idle session (``running = True``) and only then claims the event's durable
delivery row. Nothing else clears ``running``: a busy session is exempt from the reaper, keeps its
active-session lease, diverts every ``prompt.submit`` into a queue that only a finishing turn
drains, and never polls its bot mailbox again — so a dispatch that returns or raises without
starting a turn leaves that session unusable for the life of the backend.
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
    poller holding the live copy of the same event gets ``None`` — after it already took the turn."""
    def _claim(evt, consumer):
        if isinstance(claim, Exception):
            raise claim
        return claim

    monkeypatch.setattr("tools.async_delegation.claim_event_delivery", _claim)
    started = _no_turn(monkeypatch)
    session = _claimed_session()

    server._notif_dispatch_event("sid", session, dict(DELEGATION), "text")

    assert session["running"] is False
    assert started == []
    assert server._notif_claim_turn(session) is True, "the session must be claimable again"


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

"""Hosted-room startup and session handles must share one live database generation."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import sqlite3

import pytest

from gateway import hosted_rooms
from gateway.hosted_room_policy_checkpoint import HostedRoomPolicyCheckpoint
from hermes_constants import get_hermes_home
from persistence_assembly import open_persistence, profile_scope


def test_policy_index_waits_for_room_schema_on_first_open():
    db_path = get_hermes_home() / "state.db"
    with open_persistence(profile_scope(), eager=True) as store:
        checkpoint = HostedRoomPolicyCheckpoint(store, placement="profile")
        hosted_rooms.list_rooms(store, placement="profile")
        with sqlite3.connect(db_path) as conn:
            assert conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_hosted_room_user_thread'"
            ).fetchone() is None

        # Checkpoints initialize lazily: the first policy read sets up the
        # room schema before creating its JSON expression index.
        assert not checkpoint.publication_exists(
            room_id="missing", task_id="missing", status="settled", execution_generation=1)
        with sqlite3.connect(db_path) as conn:
            assert conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_hosted_room_user_thread'"
            ).fetchone() is not None


@pytest.mark.parametrize("creator, expected_table", [
    ("hosted", "hosted_rooms"),
    ("policy", "hosted_room_policy_cursors"),
    ("delivery", "delivery_obligations"),
    ("delegation", "async_delegations"),
])
def test_session_startup_preserves_shared_store_first_open(monkeypatch, creator, expected_table, record_property):
    from gateway import delivery_ledger
    from persistence.sqlite import _holder, _registry
    from tools import async_delegation

    scope = profile_scope()
    db_path = get_hermes_home() / "state.db"
    opened = threading.Event()
    continue_hosted = threading.Event()
    session_waiting = threading.Event()
    acquisition_trace = []
    real_first_write = _holder.apply_wal_with_fallback

    def pause_before_first_write(conn, **kwargs):
        if threading.current_thread().name.startswith("hosted-first-open") and not opened.is_set():
            acquisition_trace.append("initializer:zero-byte")
            opened.set()
            assert continue_hosted.wait(5), "hosted startup was not released"
            acquisition_trace.append("initializer:released")
        return real_first_write(conn, **kwargs)

    def start_hosted():
        if creator == "delivery":
            delivery_ledger.record_obligation(
                obligation_id="first", session_key="first", platform="test", chat_id="chat",
                thread_id=None, content="retained reply")
        elif creator == "delegation":
            async_delegation._persist_dispatch({"delegation_id": "first", "dispatched_at": 1.0})
        else:
            with open_persistence(scope) as store:
                if creator == "policy":
                    HostedRoomPolicyCheckpoint(store, placement="profile").publication_exists(
                        room_id="missing", task_id="missing", status="settled", execution_generation=1)
                else:
                    hosted_rooms.list_rooms(store, placement="profile")

    def start_session():
        with open_persistence(scope, eager=True) as store:
            assert store.sessions.get("missing") is None
            assert db_path.stat().st_ino == original.st_ino
            assert not list(db_path.parent.glob("state.db.zeroed-*.bak"))

    def wait_for_shared_store(timeout=None):
        assert not continue_hosted.is_set()
        pending = db_path.stat()
        assert pending.st_size == 0
        assert pending.st_ino == original.st_ino
        acquisition_trace.append("session:shared-store-wait")
        session_waiting.set()
        return real_opening_wait(timeout)

    monkeypatch.setattr(_holder, "apply_wal_with_fallback", pause_before_first_write)
    monkeypatch.setattr(delivery_ledger, "_scope", lambda: scope)
    monkeypatch.setattr(async_delegation, "_scope", lambda: scope)
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="hosted-first-open") as pool:
        startup = pool.submit(start_hosted)
        try:
            assert opened.wait(5), "real hosted connection did not open"
            original = db_path.stat()
            assert original.st_size == 0
            # Observe the registry's real wait, after the session has found
            # the in-flight holder, so releasing startup cannot serialize the opens.
            with _registry._lock:
                opening = _registry._opening[db_path.resolve()]
            real_opening_wait = opening.wait
            monkeypatch.setattr(opening, "wait", wait_for_shared_store)
            session = pool.submit(start_session)
            assert session_waiting.wait(5), "session did not wait for the shared first open"
        finally:
            continue_hosted.set()
        startup.result(timeout=5)
        session.result(timeout=5)

    record_property("shared_store_acquisition_trace", " -> ".join(acquisition_trace))
    assert acquisition_trace == ["initializer:zero-byte", "session:shared-store-wait", "initializer:released"]
    with sqlite3.connect(db_path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"sessions", expected_table} <= tables


@pytest.mark.parametrize("connection_boundary", ["opening_during_rename", "failed_room_read"])
def test_quarantine_preserves_offline_store_across_connection_boundaries(monkeypatch, connection_boundary):
    from hermes_cli.sqlite_safe_read import connect_tracked
    from persistence.sqlite._state.dbfile import quarantine_invalid_state_db

    db_path = get_hermes_home() / "state.db"
    damaged = bytes(128)
    db_path.write_bytes(damaged)
    original = db_path.stat()
    if connection_boundary == "failed_room_read":
        with pytest.raises(sqlite3.DatabaseError):
            hosted_rooms._connect(db_path)
        with open_persistence(profile_scope(), eager=True) as recovered:
            assert recovered.sessions.get("missing") is None
            with sqlite3.connect(db_path) as conn:
                assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        backups = list(db_path.parent.glob("state.db.zeroed-*.bak"))
        assert len(backups) == 1
        assert backups[0].read_bytes() == damaged
        assert db_path.stat().st_ino != original.st_ino
        return

    rename_started = threading.Event()
    finish_rename = threading.Event()
    connection_attempted = threading.Event()
    connection_opened = threading.Event()
    close_connection = threading.Event()
    real_rename = Path.rename

    def pause_rename(path, target):
        if path == db_path:
            rename_started.set()
            assert finish_rename.wait(5), "quarantine rename was not released"
        return real_rename(path, target)

    def open_during_quarantine():
        connection_attempted.set()
        conn = connect_tracked(db_path)
        try:
            identity = db_path.stat().st_ino
            connection_opened.set()
            assert close_connection.wait(5), "new connection was not released"
            return identity
        finally:
            conn.close()

    monkeypatch.setattr(Path, "rename", pause_rename)
    with ThreadPoolExecutor(max_workers=2) as pool:
        quarantine = pool.submit(quarantine_invalid_state_db, db_path)
        opener = None
        try:
            assert rename_started.wait(5), "quarantine did not reach the real rename"
            opener = pool.submit(open_during_quarantine)
            assert connection_attempted.wait(5)
            # Give the competing opener a bounded opportunity while rename is
            # parked. Correct code blocks it; the assertion below checks which
            # database it actually opened, rather than a wall-clock race.
            connection_opened.wait(2)
        finally:
            finish_rename.set()
            close_connection.set()
        backup = quarantine.result(timeout=5)
        assert opener is not None
        opened_inode = opener.result(timeout=5)

    assert backup is not None
    assert backup.read_bytes() == damaged
    assert backup.stat().st_ino == original.st_ino
    assert opened_inode != original.st_ino
    assert opened_inode == db_path.stat().st_ino

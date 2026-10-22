"""Hosted-room startup and SessionDB must share one live database generation."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import threading
import sqlite3

import pytest

from gateway import hosted_rooms
from gateway.hosted_room_policy_checkpoint import HostedRoomPolicyCheckpoint
from hermes_constants import get_hermes_home
from hermes_state import SessionDB


def test_policy_index_waits_for_room_schema_on_first_open():
    db_path = get_hermes_home() / "state.db"
    HostedRoomPolicyCheckpoint(db_path)

    with hosted_rooms._connect(db_path) as conn:
        assert conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_hosted_room_user_thread'"
        ).fetchone() is None

    HostedRoomPolicyCheckpoint(db_path)
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
def test_session_startup_preserves_shared_store_first_open(monkeypatch, creator, expected_table):
    import hermes_state_wal
    from gateway import delivery_ledger
    from gateway.hosted_room_policy_checkpoint import HostedRoomPolicyCheckpoint
    from tools import async_delegation

    db_path = get_hermes_home() / "state.db"
    opened = threading.Event()
    continue_hosted = threading.Event()
    owner, operation = (
        (async_delegation, "_initialize_schema") if creator == "delegation"
        else (hermes_state_wal, "apply_wal_with_fallback")
    )
    real_first_write = getattr(owner, operation)

    def pause_before_first_write(conn, **kwargs):
        if threading.current_thread().name.startswith("hosted-first-open"):
            opened.set()
            assert continue_hosted.wait(5), "hosted startup was not released"
        return real_first_write(conn, **kwargs)

    def start_hosted():
        if creator == "policy":
            HostedRoomPolicyCheckpoint(db_path)
            return
        openers = {
            "hosted": lambda: hosted_rooms._connect(db_path),
            "delivery": delivery_ledger._connect,
            "delegation": async_delegation._connect,
        }
        conn = openers[creator]()
        conn.close()

    monkeypatch.setattr(owner, operation, pause_before_first_write)
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="hosted-first-open") as pool:
        startup = pool.submit(start_hosted)
        try:
            assert opened.wait(5), "real hosted connection did not open"
            original = db_path.stat()
            assert original.st_size == 0
            with SessionDB(db_path):
                assert db_path.stat().st_ino == original.st_ino
                assert not list(db_path.parent.glob("state.db.zeroed-*.bak"))
        finally:
            continue_hosted.set()
        startup.result(timeout=5)

    with SessionDB(db_path) as sessions:
        tables = {row[0] for row in sessions._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )}
    assert {"sessions", expected_table} <= tables


@pytest.mark.parametrize("connection_boundary", ["opening_during_rename", "failed_room_read"])
def test_quarantine_preserves_offline_store_across_connection_boundaries(monkeypatch, connection_boundary):
    from hermes_cli.sqlite_safe_read import connect_tracked
    from hermes_state_dbfile import quarantine_invalid_state_db

    db_path = get_hermes_home() / "state.db"
    damaged = bytes(128)
    db_path.write_bytes(damaged)
    original = db_path.stat()
    if connection_boundary == "failed_room_read":
        with pytest.raises(sqlite3.DatabaseError):
            hosted_rooms.list_rooms(db_path)
        with SessionDB(db_path) as recovered:
            assert recovered._conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
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

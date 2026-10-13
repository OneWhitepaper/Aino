"""Opening a shared store tolerates SQLite retiring its idle sidecars."""

import os
import sqlite3

import pytest

from hermes_cli.sqlite_util import open_db


def _open_during_sidecar_retirement(tmp_path, monkeypatch):
    path = tmp_path / "state.db"
    previous = sqlite3.connect(path)
    previous.execute("PRAGMA journal_mode=WAL")
    previous.execute("CREATE TABLE records (value TEXT)")
    previous.execute("INSERT INTO records VALUES ('preserved')")
    previous.commit()
    sidecar = path.with_name(path.name + "-shm")
    assert sidecar.exists()
    chmod = os.chmod

    def retire_before_chmod(target, mode):
        if target == sidecar:
            previous.close()
            assert not sidecar.exists()
        return chmod(target, mode)

    monkeypatch.setattr(os, "chmod", retire_before_chmod)
    try:
        conn = open_db(path, db_label="sidecar-race")
        try:
            assert conn.execute("SELECT value FROM records").fetchone()[0] == "preserved"
        finally:
            conn.close()
    finally:
        previous.close()


@pytest.mark.platforms("macos")
def test_open_survives_sidecar_retirement_macos(tmp_path, monkeypatch):
    _open_during_sidecar_retirement(tmp_path, monkeypatch)


@pytest.mark.platforms("linux")
def test_open_survives_sidecar_retirement_linux(tmp_path, monkeypatch):
    _open_during_sidecar_retirement(tmp_path, monkeypatch)

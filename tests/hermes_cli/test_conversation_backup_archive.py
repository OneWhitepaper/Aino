"""All user-facing backup modes carry a root recovery set, even from a Profile."""
from contextlib import closing
import json
import sqlite3
import zipfile

from hermes_cli import backup
from hermes_cli.conversation_backup import MANIFEST_NAME, verify_conversation_snapshot
from hermes_cli.conversation_backup_archive import RECOVERY_DIRECTORY
from hermes_state import SessionDB
from tests.hermes_cli.test_conversation_backup import _history


def test_profile_quick_snapshot_contains_root_dependencies_and_restores_them(tmp_path, monkeypatch):
    source, store, _, _ = _history(tmp_path, monkeypatch)
    profile = source / "profiles" / "writer"
    sid = backup.create_quick_snapshot(hermes_home=profile)
    snapshot = profile / "state-snapshots" / sid
    manifest = verify_conversation_snapshot(snapshot / RECOVERY_DIRECTORY)
    assert "state.db" in manifest["files"]
    assert "profiles/reviewer/state.db" in manifest["files"]
    with SessionDB(source / "state.db") as db:
        db.create_session("later", source="cli")
    assert backup.restore_quick_snapshot(sid, hermes_home=profile)
    with SessionDB(source / "state.db") as db:
        assert db.get_session("later") is None
        assert db.get_conversation_input_receipt("input-default") is not None


def test_full_archive_uses_verified_database_set_and_imports_into_fresh_root(tmp_path, monkeypatch):
    source, _, _, _ = _history(tmp_path, monkeypatch)
    archive = tmp_path / "backup.zip"
    assert backup._write_full_zip_backup(archive, source) == archive
    target = tmp_path / "fresh"
    target.mkdir()
    with zipfile.ZipFile(archive) as zf:
        assert RECOVERY_DIRECTORY + "/" + MANIFEST_NAME in zf.namelist()
        assert "shared-state.db" not in zf.namelist()
        restored, _, errors, _, _ = backup._import_members(zf, zf.namelist(), "", target, len(zf.namelist()))
        assert restored > 0 and not errors
    with SessionDB(target / "profiles" / "reviewer" / "state.db") as db:
        assert db.get_conversation_input_receipt("input-reviewer") is not None
    with closing(sqlite3.connect(target / "shared-state.db")) as conn:
        assert conn.execute("SELECT COUNT(*) FROM hosted_room_conversation_participants").fetchone()[0] == 3

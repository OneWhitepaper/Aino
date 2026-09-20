"""Recovery installs complete sets and never resurrects old execution leases."""
from contextlib import closing
import sqlite3

import pytest

from gateway.hosted_room_conversation_store import ConversationStore
from hermes_cli.conversation_backup import create_conversation_snapshot, ConversationBackupError
from hermes_cli.conversation_restore import restore_conversation_snapshot
from hermes_state import SessionDB
from tests.hermes_cli.test_conversation_backup import _history


def test_restore_new_home_preserves_history_and_requires_fresh_generations(tmp_path, monkeypatch):
    source, old_store, _, _ = _history(tmp_path, monkeypatch)
    snapshot, target = tmp_path / "snapshot", tmp_path / "restored"
    create_conversation_snapshot(source, snapshot)
    expected = old_store.events("chat")
    before = old_store.participants("chat")
    restore_conversation_snapshot(snapshot, target)
    restored = ConversationStore(target / "shared-state.db")
    assert restored.events("chat") == expected
    for binding, old in zip(restored.participants("chat"), before):
        assert binding.participant == old.participant
        assert binding.session_generation == old.session_generation + 1
        assert binding.lineage_id is None
    with SessionDB(target / "profiles" / "writer" / "state.db") as db:
        assert db.get_conversation_input_receipt("input-writer") is not None
    with closing(sqlite3.connect(target / "shared-state.db")) as db:
        homes = [row[0] for row in db.execute("SELECT profile_home FROM hosted_room_conversation_runtimes")]
    assert all(path.startswith(str(target)) for path in homes)
    assert not (target / ".conversation-restore.json").exists()


def test_restore_refuses_live_holder_and_rolls_back_complete_set_on_failure(tmp_path, monkeypatch):
    from hermes_cli import conversation_restore
    source, _, _, _ = _history(tmp_path, monkeypatch)
    snapshot, target = tmp_path / "snapshot", tmp_path / "restored"
    create_conversation_snapshot(source, snapshot)
    restore_conversation_snapshot(snapshot, target)
    with SessionDB(target / "state.db") as db:
        db.create_session("after-backup", source="cli")
        with pytest.raises((ConversationBackupError, RuntimeError), match="live|Close|connection"):
            restore_conversation_snapshot(snapshot, target)
        assert db.get_session("after-backup") is not None
    install = conversation_restore._install_files
    calls = []
    def fail_once(staged, root, names):
        calls.append(staged)
        if len(calls) == 1:
            install(staged, root, names[:2])
            raise OSError("injected disk failure")
        return install(staged, root, names)
    monkeypatch.setattr(conversation_restore, "_install_files", fail_once)
    with pytest.raises(OSError, match="injected disk failure"):
        restore_conversation_snapshot(snapshot, target)
    with SessionDB(target / "state.db") as db:
        assert db.get_session("after-backup") is not None
    assert not (target / ".conversation-restore.json").exists()

"""A terminated installer leaves a durable fence and recoverable original set."""
from contextlib import closing
import sqlite3
import subprocess
import sys

import pytest

from gateway.hosted_room_conversation_maintenance import managed_operation, MaintenanceRecoveryRequired
from hermes_cli.conversation_backup import create_conversation_snapshot
from hermes_cli.conversation_restore import restore_conversation_snapshot, recover_interrupted_conversation_restore
from tests.hermes_cli.test_conversation_backup import _history


def test_interrupted_install_keeps_fence_until_original_set_is_recovered(tmp_path, monkeypatch):
    source, _, _, _ = _history(tmp_path, monkeypatch)
    snapshot, target = tmp_path / "snapshot", tmp_path / "target"
    create_conversation_snapshot(source, snapshot)
    restore_conversation_snapshot(snapshot, target)
    overwritten_db = target / "profiles" / "reviewer" / "state.db"
    with closing(sqlite3.connect(overwritten_db)) as conn:
        conn.execute("UPDATE sessions SET title='After snapshot' WHERE id='session-reviewer'")
        conn.commit()
    script = '''
import os, sys
from pathlib import Path
from hermes_cli import conversation_restore as recovery
original = recovery._install_files
def crash(source, root, names):
    cutoff = names.index('profiles/reviewer/state.db') + 1
    assert cutoff < len(names)
    original(source, root, names[:cutoff])
    os._exit(9)
recovery._install_files = crash
recovery.restore_conversation_snapshot(Path(sys.argv[1]), Path(sys.argv[2]))
'''
    process = subprocess.run([sys.executable, "-c", script, str(snapshot), str(target)],
                             capture_output=True, text=True, timeout=25)
    assert process.returncode == 9, process.stderr
    with closing(sqlite3.connect(overwritten_db)) as conn:
        assert conn.execute("SELECT title FROM sessions WHERE id='session-reviewer'").fetchone()[0] != "After snapshot"
    with pytest.raises(MaintenanceRecoveryRequired):
        with managed_operation(target):
            pass
    recover_interrupted_conversation_restore(target)
    with closing(sqlite3.connect(overwritten_db)) as conn:
        assert conn.execute("SELECT title FROM sessions WHERE id='session-reviewer'").fetchone()[0] == "After snapshot"
    with managed_operation(target):
        assert not (target / ".conversation-restore.json").exists()
    process = subprocess.run([sys.executable, "-c", script, str(snapshot), str(target)],
                             capture_output=True, text=True, timeout=25)
    assert process.returncode == 9, process.stderr
    # Existing import retry first recovers the journal, then installs the requested set.
    restore_conversation_snapshot(snapshot, target)
    with closing(sqlite3.connect(overwritten_db)) as conn:
        assert conn.execute("SELECT title FROM sessions WHERE id='session-reviewer'").fetchone()[0] != "After snapshot"
    assert not (target / ".conversation-restore.json").exists()

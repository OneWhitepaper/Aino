"""OS permits fence cross-database managed writes, without freezing ordinary sessions."""
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

import pytest

from gateway.hosted_room_conversation_maintenance import (
    MaintenanceRecoveryRequired, MaintenanceTimeout, managed_operation, snapshot_operation,
)


def test_subprocess_operation_drains_before_snapshot_and_dead_holder_releases(tmp_path):
    script = '''
import sys
from pathlib import Path
from gateway.hosted_room_conversation_maintenance import managed_operation
from hermes_state import SessionDB
from gateway.hosted_room_conversation_store import ConversationStore
from gateway.hosted_room_conversation_types import ParticipantRef
root = Path(sys.argv[1])
db = SessionDB(root / 'state.db')
db.create_session('managed', source='desktop', model_config={'conversation_binding': {'conversation_id': 'c'}})
store = ConversationStore(root / 'shared-state.db')
store.create('c', 'Conversation', ParticipantRef('g', 'install:test', 'default', 'General', True), None)
with managed_operation(root):
    with managed_operation(root):
        db.append_message('managed', 'assistant', 'receipt')
        print('ready', flush=True)
        sys.stdin.readline()
        store.bind_participant('c', ParticipantRef('writer', 'install:test', 'writer', 'Writer'))
db.close()
'''
    child = subprocess.Popen([sys.executable, '-c', script, str(tmp_path)], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert child.stdout.readline().strip() == 'ready'
        with pytest.raises(MaintenanceTimeout):
            with snapshot_operation(tmp_path, timeout=.1):
                pass
        child.stdin.write('continue\n'); child.stdin.flush()
        assert child.wait(10) == 0, child.stderr.read()
        with snapshot_operation(tmp_path, timeout=1):
            from hermes_state import SessionDB
            from gateway.hosted_room_conversation_store import ConversationStore
            db = SessionDB(tmp_path / 'state.db')
            assert db.get_messages('managed')[0]['content'] == 'receipt'
            db.close()
            assert any(b.participant.profile == 'writer' for b in ConversationStore(tmp_path / 'shared-state.db').participants('c'))
            # The exclusive owner may inspect initialized stores through nested reads.
            with managed_operation(tmp_path):
                pass
        child = subprocess.Popen([sys.executable, '-c', script, str(tmp_path)], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        assert child.stdout.readline().strip() == 'ready'
        child.kill(); child.wait(10)
        with snapshot_operation(tmp_path, timeout=1):
            pass
    finally:
        if child.poll() is None:
            child.kill(); child.wait(10)


def test_snapshot_blocks_late_managed_writes_and_restore_journal_but_not_ordinary_rows(tmp_path):
    from hermes_state import SessionDB
    from gateway import hosted_rooms
    from gateway.hosted_room_conversation_store import ConversationStore
    from gateway.hosted_room_conversation_types import ParticipantRef
    root = tmp_path / 'root'
    db = SessionDB(root / 'state.db')
    db.create_session('managed', source='desktop', model_config={
        'conversation_binding': {'conversation_id': 'c', 'participant_id': 'g', 'session_generation': 1}})
    db.create_session('ordinary', source='cli')
    store = ConversationStore(root / 'shared-state.db')
    store.create('c', 'Conversation', ParticipantRef('g', 'install:test', 'default', 'General', True), None)
    script = '''
import sys
from pathlib import Path
from gateway.hosted_room_conversation_maintenance import managed_operation, MaintenanceTimeout
root = Path(sys.argv[1])
try:
    with managed_operation(root, timeout=.1):
        from gateway.hosted_room_conversation_store import ConversationStore
        ConversationStore(root / 'shared-state.db')
except MaintenanceTimeout:
    print('blocked', flush=True)
else:
    raise AssertionError('snapshot did not exclude another process')
'''
    attempted, finished = threading.Event(), threading.Event()
    failures = []
    def late_callback():
        attempted.set()
        try:
            db.append_message('managed', 'assistant', 'late terminal flush')
        except Exception as exc:
            failures.append(exc)
        finally:
            finished.set()
    worker = threading.Thread(target=late_callback)
    try:
        with snapshot_operation(root):
            result = subprocess.run([sys.executable, '-c', script, str(root)], capture_output=True, text=True, timeout=10)
            assert result.returncode == 0 and result.stdout.strip() == 'blocked', result.stderr
            worker.start(); assert attempted.wait(5)
            db.append_message('ordinary', 'assistant', 'unrelated work')
            hosted_rooms.create_room(root / 'shared-state.db', room_id='discussion', name='Discussion',
                                     members=[{'profile': 'default', 'handle': 'default'}], authority_gateway_id='install:test')
            assert db.get_messages('managed') == []
        assert finished.wait(5)
        worker.join(5)
        assert not failures
        assert db.get_messages('managed')[0]['content'] == 'late terminal flush'
        (root / '.conversation-restore.json').write_text('{}')
        with pytest.raises(MaintenanceRecoveryRequired):
            store.create('blocked', 'Blocked', ParticipantRef('g', 'install:test', 'default', 'General', True), None)
        with snapshot_operation(root):
            (root / '.conversation-restore.json').unlink()
    finally:
        if worker.is_alive():
            worker.join(5)
        db.close()

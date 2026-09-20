"""Legacy cleanup preserves managed evidence while continuing to clean ordinary rows."""
import json
import subprocess
import sys

from hermes_state import SessionDB
from gateway.hosted_room_conversation_maintenance import snapshot_operation


def test_mixed_cleanup_preserves_managed_lineage_receipts_and_migration(tmp_path):
    db = SessionDB(tmp_path / 'state.db')
    marker = {'conversation_binding': {'conversation_id': 'c', 'participant_id': 'g', 'session_generation': 1}}
    try:
        db.create_session('ancestor', 'desktop')
        db.end_session('ancestor', 'compression')
        db.create_session('managed', 'desktop', parent_session_id='ancestor', model_config=marker)
        db.create_session('delegate', 'subagent', model_config={'_delegate_from': 'managed'})
        receipt = db.accept_conversation_input('managed', input_id='input', input_digest='digest',
            message={'role': 'user', 'content': 'keep'}, conversation_id='c', participant_id='g', session_generation=1)
        db.create_session('migrated', 'desktop')
        db.append_message('migrated', 'user', 'legacy keep')
        for side, owner in (('side', 'migrated'), ('nested-side', 'side')):
            db.create_session(side, 'auxiliary')
            db.append_message(side, 'assistant', 'side evidence')
            db.begin_migration_activity(owner, side)
            db.end_migration_activity(side)
        db.prepare_conversation_migration(source_profile='default', lineage_id='migrated', conversation_id='migrated-c',
            input_id='migration-input', migration_id='migration', owner_key='legacy-local')
        db.create_session('ordinary', 'cli')
        db.append_message('ordinary', 'user', 'remove')
        assert db.delete_sessions(['ancestor', 'managed', 'delegate', 'migrated', 'side', 'nested-side', 'ordinary']) == 1
        assert db.get_messages('nested-side')[0]['content'] == 'side evidence'
        assert not db.delete_session('ancestor')
        assert not db.delete_session('managed')
        assert db.get_conversation_input_receipt('input').message_row_id == receipt.message_row_id
        assert db.get_session('managed')['parent_session_id'] == 'ancestor'
        assert db.get_messages('migrated')[0]['content'] == 'legacy keep'
        # Even empty managed generations and their ancestry are not ghost/prune candidates.
        for sid in ('managed-empty', 'ordinary-empty'):
            db.create_session(sid, 'tui', model_config=marker if sid.startswith('managed') else None)
            db.end_session(sid, 'done')
        assert db.delete_empty_sessions() == 1
        db._execute_write(lambda conn: conn.execute('UPDATE sessions SET started_at=0,ended_at=1 WHERE id=?', ('managed-empty',)))
        assert db.prune_empty_ghost_sessions() == 0
        assert db.prune_sessions(older_than_days=None) == 0
        assert db.get_session('managed-empty') is not None
        db.create_session('failed-draft', 'desktop', model_config=marker)
        assert db.delete_session_if_empty('failed-draft')
        from gateway.hosted_room_conversation_store import ConversationStore
        from gateway.hosted_room_conversation_bindings import ConversationBindings
        from gateway.hosted_room_conversation_types import ParticipantRef
        shared = ConversationStore(tmp_path / 'shared-state.db')
        shared.create('c', 'Conversation', ParticipantRef('g', 'install:test', 'default', 'General', True), None)
        binding = shared.participants('c')[0]
        ConversationBindings(shared.db_path).publish(binding, None, {
            'conversation_id': 'c', 'participant_id': 'g', 'session_generation': 1,
            'lineage_id': 'managed-empty', 'profile': 'default', 'profile_home': str(tmp_path.resolve()),
            'cwd': str(tmp_path), 'source': 'desktop', 'auth_user_id': None,
            'model_snapshot': '{}', 'capability_digest': '', 'system_prompt_digest': None, 'selection_json': '{}'})
        assert not db.delete_session_if_empty('managed-empty')
    finally:
        db.close()


def test_exclusive_snapshot_does_not_block_ordinary_cleanup_or_lose_managed_rows(tmp_path):
    from gateway.hosted_room_conversation_store import ConversationStore
    from gateway.hosted_room_conversation_types import ParticipantRef
    root = tmp_path / 'home'
    db = SessionDB(root / 'state.db')
    db.create_session('managed', 'desktop', model_config={'conversation_binding': {'conversation_id': 'c'}})
    db.append_message('managed', 'assistant', 'immutable dependency')
    db.create_session('ordinary', 'cli')
    shared = ConversationStore(root / 'shared-state.db')
    shared.create('c', 'Conversation', ParticipantRef('g', 'install:test', 'default', 'General', True), None)
    script = '''
import sys
from pathlib import Path
from hermes_state import SessionDB
root = Path(sys.argv[1])
db = SessionDB(root / 'state.db')
print('ready', flush=True)
sys.stdin.readline()
assert db.delete_sessions(['managed','ordinary']) == 1
assert not db.delete_session('managed')
print('cleaned', flush=True)
db.close()
'''
    child = subprocess.Popen([sys.executable, '-c', script, str(root)], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert child.stdout.readline().strip() == 'ready'
        with snapshot_operation(root):
            (root / '.conversation-restore.json').write_text('{}')
            child.stdin.write('go\n'); child.stdin.flush()
            out, err = child.communicate(timeout=10)
            assert child.returncode == 0 and 'cleaned' in out, err
            assert db.get_session('ordinary') is None
            assert db.get_messages('managed')[0]['content'] == 'immutable dependency'
            (root / '.conversation-restore.json').unlink()
    finally:
        if child.poll() is None:
            child.kill(); child.wait(5)
        db.close()

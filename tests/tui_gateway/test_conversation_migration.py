"""Legacy adoption preserves source identity and permanently fences warm writers."""
import json
import sqlite3

import pytest

from tests.tui_gateway.test_conversation_session_binding import runtime_env
from hermes_state import SessionDB
from hermes_state_migration import SessionMigratedError
from tui_gateway.conversation_migration import adopt_session
from tui_gateway.conversation_service import ConversationService
from gateway.hosted_room_conversation_migration import ConversationMigrationStore


def _source(runtime_env, monkeypatch):
    server, store, install, home, root = runtime_env
    service = ConversationService(server, db_path=store.db_path)
    monkeypatch.setattr(server, 'get_conversation_service', lambda: service)
    db = SessionDB(home / 'profiles' / 'writer' / 'state.db')
    db.create_session('legacy', 'desktop', user_id='test:creator')
    db.set_session_title('legacy', 'Old work')
    ids = [db.append_message('legacy', 'user', 'Repeated authentic ask'),
           db.append_message('legacy', 'assistant', 'Public answer', reasoning='PRIVATE REASONING'),
           db.append_message('legacy', 'user', 'Repeated authentic ask')]
    scaffold = ('[IMPORTANT: The user has invoked the "work" skill. '
                'The full skill content is loaded below.]\nPRIVATE SKILL BODY\n'
                'The user has provided the following instruction alongside the skill invocation: fix it')
    ids.append(db.append_message('legacy', 'user', scaffold, api_content='PRIVATE API CONTENT'))
    db.append_message('legacy', 'tool', 'PRIVATE TOOL OUTPUT', tool_name='terminal')
    db.append_messages_batch('legacy', [{'role': 'user', 'content': 'PRIVATE INSTRUCTION', 'display_kind': 'hidden'}])
    return server, service, db, ids


@pytest.mark.parametrize('failure', ['marker', 'partial', 'ack'])
def test_adoption_retry_has_exact_public_provenance_and_no_private_context(runtime_env, monkeypatch, failure):
    server, service, db, ids = _source(runtime_env, monkeypatch)
    long_text = ('完整公开回答\n' * 10000).rstrip() if failure == 'ack' else None
    if long_text:
        ids.append(db.append_message('legacy', 'assistant', long_text))
    image_bytes = None
    if failure == 'marker':
        import base64
        from io import BytesIO
        from PIL import Image
        output = BytesIO()
        Image.new('RGB', (2, 2), 'blue').save(output, format='PNG')
        image_bytes = output.getvalue()
        ids.append(db.append_message('legacy', 'user', [
            {'type': 'text', 'text': 'Visible attachment'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(image_bytes).decode()}}]))
    if failure == 'partial':
        from agent.context_compressor import SUMMARY_PREFIX, _SUMMARY_END_MARKER
        db.publish_compression_child(parent_session_id='legacy', child_session_id='compressed',
            source='desktop', require_compression_lease=False, watermark=ids[-2],
            messages=[{'role': 'user', 'content': SUMMARY_PREFIX + 'PRIVATE SUMMARY' + _SUMMARY_END_MARKER,
                       '_compressed_summary': True}])
        copied = [row for row in db.get_messages('compressed') if 'PRIVATE SKILL BODY' in str(row['content'])]
        assert len(copied) == 1
        ids[-1] = copied[0]['id']
    params = dict(source_profile='writer', lineage_id='legacy', conversation_id='adopted', input_id='adopt-once')
    if failure == 'marker':
        original = service.store.create
        monkeypatch.setattr(service.store, 'create', lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('interrupt')))
    elif failure == 'partial':
        original = ConversationMigrationStore.import_row
        calls = []
        def interrupt(self, *args):
            if calls:
                raise RuntimeError('interrupt')
            calls.append(True)
            return original(self, *args)
        monkeypatch.setattr(ConversationMigrationStore, 'import_row', interrupt)
    else:
        original = SessionDB.set_conversation_migration_status
        def interrupt(self, migration_id, status, error=None):
            if status == 'complete':
                raise RuntimeError('interrupt')
            return original(self, migration_id, status, error)
        monkeypatch.setattr(SessionDB, 'set_conversation_migration_status', interrupt)
    with pytest.raises(RuntimeError, match='interrupt'):
        adopt_session(server, **params)
    with pytest.raises(SessionMigratedError):
        db.try_acquire_session_turn_lease('legacy', 'late')
    if failure == 'marker':
        monkeypatch.setattr(service.store, 'create', original)
    elif failure == 'partial':
        monkeypatch.setattr(ConversationMigrationStore, 'import_row', original)
    else:
        monkeypatch.setattr(SessionDB, 'set_conversation_migration_status', original)
    if failure == 'ack':
        participant = next(b for b in service.store.participants('adopted') if b.participant.profile == 'writer')
        service.refresh('adopted', participant.participant.participant_id, participant.session_generation)
        with sqlite3.connect(service.db_path) as conn:
            conn.execute("UPDATE hosted_rooms SET name='Renamed after completion' WHERE room_id='adopted'")
        completed_before_retry = service.get('adopted')['migration']
    first = adopt_session(server, **params)
    if failure == 'ack':
        assert first == completed_before_retry
        assert service.store.get('adopted').title == 'Renamed after completion'
        assert next(b for b in service.store.participants('adopted') if b.participant.profile == 'writer').session_generation == 2
        assert db.get_session_migration('legacy').status == 'complete'
    if failure == 'marker':
        with sqlite3.connect(service.db_path) as conn:
            conn.execute("UPDATE hosted_room_conversations SET archived_at=1 WHERE conversation_id='adopted'")
    assert adopt_session(server, **params) == first
    assert first['status'] == 'complete'
    with sqlite3.connect(service.db_path) as conn:
        rows = conn.execute('SELECT source_row_id,event_id FROM hosted_conversation_migration_rows').fetchall()
    assert {r[0] for r in rows} == set(ids)
    events = service.events('adopted')['events']
    assert {r[1] for r in rows} == {e['event_id'] for e in events}
    assert 'PRIVATE' not in json.dumps(events)
    assert '/work fix it' in [e['payload']['text'] for e in events]
    assert [e['payload']['text'] for e in events].count('Repeated authentic ask') == 2
    participant = next(b for b in service.store.participants('adopted') if b.participant.profile == 'writer')
    assert participant.lineage_id and participant.lineage_id != 'legacy'
    assert db.get_messages_as_conversation(participant.lineage_id) == []
    if long_text:
        assert long_text in [m.text for m in service.store.public_history('adopted', len(events))]
    if image_bytes is not None:
        from gateway.hosted_room_conversation_content import ConversationContentStore
        attachment = next(e['payload']['attachments'][0] for e in events if e['payload'].get('attachments'))
        assert ConversationContentStore(service.db_path).read_for_conversation(
            'adopted', attachment['content_ref']['id']) == image_bytes
    assert service.get('adopted')['migration'] == first
    db.close()


def test_warm_direct_prompt_and_raw_writers_are_fenced_while_history_remains(runtime_env, monkeypatch):
    server, service, db, ids = _source(runtime_env, monkeypatch)
    # Durable ownership is checked before resume can relabel a cold source.
    db._execute_write(lambda conn: conn.execute('UPDATE sessions SET user_id=? WHERE id=?',
                                                ('test:other', 'legacy')))
    params = dict(source_profile='writer', lineage_id='legacy', conversation_id='adopted', input_id='adopt-once')
    with pytest.raises(ValueError, match='another owner'):
        adopt_session(server, **params)
    db._execute_write(lambda conn: conn.execute('UPDATE sessions SET user_id=? WHERE id=?',
                                                ('test:creator', 'legacy')))
    db._execute_write(lambda conn: conn.execute("""INSERT INTO async_delegations
        (delegation_id,origin_session,parent_session_id,state,dispatched_at,updated_at,delivery_state,completed_at)
        VALUES ('pending','legacy','legacy','completed',1,1,'pending',2)"""))
    with pytest.raises(ValueError, match='unsettled background'):
        adopt_session(server, **params)
    db._execute_write(lambda conn: conn.execute("UPDATE async_delegations SET delivery_state='delivered'"))
    db.begin_migration_activity('legacy', 'side-question')
    with pytest.raises(ValueError, match='active background or side question'):
        adopt_session(server, **params)
    db.end_migration_activity('side-question')
    # A persisted lease, even expired, must be reconciled before adoption.
    db.try_acquire_session_turn_lease('legacy', 'busy', ttl_seconds=.1)
    params = dict(source_profile='writer', lineage_id='legacy', conversation_id='adopted', input_id='adopt-once')
    with pytest.raises(ValueError, match='busy'):
        adopt_session(server, **params)
    db.release_session_turn_lease('legacy', 'busy')
    # Resume through the real handler BEFORE migration; its session dict stays stale.
    resumed = server._methods['session.resume']('resume', {'session_id': 'legacy', 'profile': 'writer'})
    assert 'error' not in resumed, resumed
    sid = resumed['result']['session_id']
    receipt = adopt_session(server, **params)
    response = server._methods['prompt.submit']('old', {'session_id': sid, 'text': 'must never run'})
    assert response['error']['data']['conversation_id'] == receipt['conversation_id']
    for method, extra in [('command.dispatch', {'name': 'goal', 'arg': 'must not start'}),
                          ('slash.exec', {'command': '/compress'}),
                          ('session.branch', {'name': 'private-copy'})]:
        result = server._methods[method]('old-action', {'session_id': sid, **extra})
        assert result['error']['data']['conversation_id'] == receipt['conversation_id']

    with pytest.raises(SessionMigratedError):
        db.append_message('legacy', 'user', 'late flush')
    with sqlite3.connect(db.db_path) as other:
        with pytest.raises(sqlite3.IntegrityError, match='session_conversation_migrated'):
            other.execute('UPDATE sessions SET model=? WHERE id=?', ('changed', 'legacy'))
        with pytest.raises(sqlite3.IntegrityError, match='session_conversation_migrated'):
            other.execute('DELETE FROM messages WHERE session_id=?', ('legacy',))
    assert db.get_messages_as_conversation('legacy', include_row_ids=True)
    assert db.get_session('legacy')['title'] == 'Old work'
    # A separate process opens the already migrated DB; it cannot acquire or flush.
    import subprocess
    import sys
    import os
    child = subprocess.run([sys.executable, '-c', """
import sys
from hermes_state import SessionDB
from hermes_state_migration import SessionMigratedError
from pathlib import Path
with SessionDB(Path(sys.argv[1])) as db:
    for operation in (lambda: db.try_acquire_session_turn_lease('legacy','other-process'),
                      lambda: db.append_message('legacy','user','late')):
        try:
            operation()
        except SessionMigratedError as error:
            assert error.conversation_id == 'adopted'
        else:
            raise AssertionError('legacy write admitted')
    assert db.get_messages_as_conversation('legacy')
""", str(db.db_path)], capture_output=True, text=True, timeout=30,
        env={**os.environ, 'HERMES_STATE_DB_GUARD_BYPASS': '1'})
    assert child.returncode == 0, child.stderr

    db.close()

"""Atomic project transitions retain old runtime snapshots and retire their generations."""
from dataclasses import asdict
import time

from gateway import hosted_rooms
from gateway.hosted_room_conversation_admission import ConversationBusyError
from gateway.hosted_room_conversation_owners import require_owner_locked
from gateway.hosted_room_conversation_store import _binding_from_row, _project, _project_json


def change_conversation_project(store, conversation_id, project, *, expected_revision, owner_key):
    project = _project(project)
    with hosted_rooms._transaction(store.db_path, immediate=True) as conn:
        require_owner_locked(conn, conversation_id, owner_key)
        record = store._check_admission_locked(conn, conversation_id, expected_revision)
        if conn.execute("SELECT 1 FROM hosted_conversation_background_origins "
                        "WHERE conversation_id=? AND state='pending' LIMIT 1", (conversation_id,)).fetchone():
            raise ConversationBusyError('resolve background work before changing the project')
        if project != record.project:
            conn.execute('UPDATE hosted_room_conversation_participants '
                         'SET session_generation=session_generation+1,lineage_id=NULL WHERE conversation_id=?',
                         (conversation_id,))
            conn.execute('UPDATE hosted_room_conversations SET project_json=? WHERE conversation_id=?',
                         (_project_json(project), conversation_id))
            conn.execute('UPDATE hosted_rooms SET revision=revision+1,updated_at=? WHERE room_id=?',
                         (time.time(), conversation_id))
            if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' "
                            "AND name='hosted_conversation_command_tokens'").fetchone():
                conn.execute('DELETE FROM hosted_conversation_command_tokens '
                             'WHERE conversation_id=? AND consumed_input_id IS NULL', (conversation_id,))
        participants = tuple(_binding_from_row(row) for row in conn.execute(
            'SELECT * FROM hosted_room_conversation_participants WHERE conversation_id=? ORDER BY participant_id',
            (conversation_id,)))
        return {'conversation': asdict(store._get_locked(conn, conversation_id)),
                'participants': [asdict(binding) for binding in participants]}

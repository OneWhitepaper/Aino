"""Resumable event import with transactional source-row receipts."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from gateway import hosted_rooms
from gateway.hosted_room_conversation_owners import require_owner_locked


def initialize_migration_schema(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_migrations (
        migration_id TEXT PRIMARY KEY, input_id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL UNIQUE, owner_key TEXT NOT NULL,
        receipt_json TEXT NOT NULL, manifest_json TEXT NOT NULL, error TEXT)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_migration_rows (
        migration_id TEXT NOT NULL REFERENCES hosted_conversation_migrations(migration_id),
        source_row_id INTEGER NOT NULL, event_id TEXT NOT NULL, seq INTEGER NOT NULL,
        PRIMARY KEY(migration_id,source_row_id), UNIQUE(event_id))''')


def migration_receipt(conn, conversation_id):
    row = conn.execute('SELECT receipt_json FROM hosted_conversation_migrations WHERE conversation_id=?', (conversation_id,)).fetchone()
    return json.loads(row['receipt_json']) if row else None


def require_migration_complete(conn, conversation_id):
    receipt = migration_receipt(conn, conversation_id)
    if receipt and receipt['status'] != 'complete':
        raise hosted_rooms.RoomConflictError('conversation migration is not complete; retry its original adoption')


from gateway.hosted_room_conversation_maintenance import managed_store


@managed_store
class ConversationMigrationStore:
    def __init__(self, store):
        self.store, self.db_path = store, store.db_path

    def begin(self, receipt, *, input_id, owner_key, manifest):
        payload = asdict(receipt)
        payload['status'] = 'importing'
        canonical = json.dumps(manifest, sort_keys=True, ensure_ascii=False)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            require_owner_locked(conn, receipt.conversation_id, owner_key)
            previous = conn.execute('SELECT * FROM hosted_conversation_migrations WHERE migration_id=? OR input_id=? OR conversation_id=?',
                (receipt.migration_id, input_id, receipt.conversation_id)).fetchall()
            if previous:
                row = previous[0]
                if len(previous) != 1 or row['migration_id'] != receipt.migration_id or row['input_id'] != input_id or row['owner_key'] != owner_key or row['manifest_json'] != canonical:
                    raise hosted_rooms.RoomConflictError('migration identity conflicts')
                return
            if conn.execute('SELECT 1 FROM hosted_room_events WHERE room_id=? LIMIT 1', (receipt.conversation_id,)).fetchone():
                raise hosted_rooms.RoomConflictError('adoption requires an empty target conversation')
            conn.execute('INSERT INTO hosted_conversation_migrations VALUES (?,?,?,?,?,?,NULL)',
                (receipt.migration_id, input_id, receipt.conversation_id, owner_key,
                 json.dumps(payload), canonical))

    def import_row(self, receipt, row, participant):
        event_id = 'migration:' + hashlib.sha256(f'{receipt.migration_id}:{row["source_row_id"]}'.encode()).hexdigest()
        role = row['role']
        kind = 'conversation.input' if role == 'user' else 'conversation.response'
        actor = {'kind': 'user' if role == 'user' else 'participant',
                 'id': 'user' if role == 'user' else participant.participant_id,
                 'display_name': 'User' if role == 'user' else participant.display_name}
        payload = {'text': row['text'], 'author_display_name_at_time': actor['display_name'],
                   'migration_id': receipt.migration_id, 'source_row_id': row['source_row_id'],
                   'source_profile': receipt.source_profile, 'source_lineage_id': receipt.source_lineage_id,
                   'model_snapshot': None}
        if len(row['text'].encode('utf-8')) > 64 * 1024:
            from .hosted_room_conversation_content import ConversationContentStore
            ref = ConversationContentStore(self.db_path).put_for_conversation(
                receipt.conversation_id, row['text'].encode('utf-8'), 'text/plain; charset=utf-8')
            payload.update(text='', content_ref=asdict(ref), content_status='referenced')
        if role == 'user':
            payload.update(input_id=event_id, turn_id=event_id,
                           attachment_ids=[a['id'] for a in row.get('public_attachments', ())],
                           attachments=row.get('public_attachments', []),
                           target_participant_id=participant.participant_id,
                           target_display_name_at_time=participant.display_name)
        else:
            payload.update(status='settled', content_status=payload.get('content_status', 'complete'))
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            existing = conn.execute('SELECT * FROM hosted_conversation_migration_rows WHERE migration_id=? AND source_row_id=?',
                                   (receipt.migration_id, row['source_row_id'])).fetchone()
            if existing:
                return dict(existing)
            room = conn.execute('SELECT authority_gateway_id,authority_epoch FROM hosted_rooms WHERE room_id=?', (receipt.conversation_id,)).fetchone()
            normalized, actor_json = hosted_rooms._validate_actor(actor, kind=kind)
            event = hosted_rooms._append_event_locked(conn, room_id=receipt.conversation_id,
                purpose='conversation', event_id=event_id, kind=kind, normalized_actor=normalized,
                actor_json=actor_json, payload_json=hosted_rooms._payload_json(payload),
                authority_gateway_id=room['authority_gateway_id'], authority_epoch=room['authority_epoch'],
                now=float(row['timestamp'] or hosted_rooms._now(None)))
            conn.execute('INSERT INTO hosted_conversation_migration_rows VALUES (?,?,?,?)',
                         (receipt.migration_id, row['source_row_id'], event_id, event['seq']))
            return {'source_row_id': row['source_row_id'], 'event_id': event_id, 'seq': event['seq']}

    def finish(self, receipt):
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            stored = conn.execute('SELECT manifest_json,receipt_json FROM hosted_conversation_migrations WHERE migration_id=?', (receipt.migration_id,)).fetchone()
            expected = {r['source_row_id'] for r in json.loads(stored['manifest_json'])}
            actual = {r['source_row_id'] for r in conn.execute('SELECT source_row_id FROM hosted_conversation_migration_rows WHERE migration_id=?', (receipt.migration_id,))}
            if actual != expected:
                raise hosted_rooms.RoomConflictError('migration row mapping is incomplete')
            events = conn.execute('''SELECT e.payload_json FROM hosted_conversation_migration_rows m
                JOIN hosted_room_events e ON e.event_id=m.event_id AND e.seq=m.seq
                WHERE m.migration_id=? AND e.room_id=?''',
                (receipt.migration_id, receipt.conversation_id)).fetchall()
            from .hosted_room_conversation_content import validate_reference_locked
            for event in events:
                event_payload = json.loads(event['payload_json'])
                for attachment in event_payload.get('attachments', ()):
                    validate_reference_locked(conn, receipt.conversation_id, attachment['content_ref'])
                if event_payload.get('content_ref'):
                    validate_reference_locked(conn, receipt.conversation_id, event_payload['content_ref'], text=True)
            if {json.loads(event['payload_json'])['source_row_id'] for event in events} != expected:
                raise hosted_rooms.RoomConflictError('migration events do not match source receipts')

            payload = json.loads(stored['receipt_json']); payload['status'] = 'complete'
            conn.execute('UPDATE hosted_conversation_migrations SET receipt_json=?,error=NULL WHERE migration_id=?', (json.dumps(payload), receipt.migration_id))
            return payload

    def fail(self, receipt, error):
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            payload = migration_receipt(conn, receipt.conversation_id)
            if payload and payload['status'] != 'complete':
                payload['status'] = 'failed'
                conn.execute('UPDATE hosted_conversation_migrations SET receipt_json=?,error=? WHERE migration_id=?',
                             (json.dumps(payload), str(error), receipt.migration_id))

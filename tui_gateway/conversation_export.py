"""Bounded public export segments over the existing owned conversation transport."""
from __future__ import annotations

import base64
import hashlib
import json

from gateway import hosted_rooms
from gateway.hosted_room_conversation_maintenance import managed_call
from gateway.hosted_room_conversation_content import read_owned_locked, validate_reference_locked


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def _content_ref(conn, conversation_id, cutoff, index):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='hosted_conversation_content'").fetchone():
        return None
    attachment_sql = ''
    args = [conversation_id, cutoff]
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name='hosted_conversation_attachments'").fetchone():
        attachment_sql = """UNION SELECT a.content_id FROM hosted_room_events e,
            json_each(e.payload_json, '$.attachment_ids') j
            JOIN hosted_conversation_attachments a ON a.conversation_id=e.room_id AND a.attachment_id=j.value
            WHERE e.room_id=? AND e.seq<=?"""
        args.extend((conversation_id, cutoff))
    args.extend((conversation_id, index))
    row = conn.execute("""WITH referenced(id) AS (
        SELECT json_extract(payload_json, '$.content_ref.id') FROM hosted_room_events
            WHERE room_id=? AND seq<=? AND json_extract(payload_json, '$.content_ref.id') IS NOT NULL
        """ + attachment_sql + """)
        SELECT c.id,c.sha256,c.size_bytes,c.mime_type FROM referenced r
            JOIN hosted_conversation_content c ON c.id=r.id
            JOIN hosted_conversation_content_owners o ON o.content_id=c.id AND o.conversation_id=?
            ORDER BY c.id LIMIT 1 OFFSET ?""", args).fetchone()
    return dict(row) if row else None


@managed_call
def export_conversation(service, conversation_id, cursor=None):
    service._authorize(conversation_id)
    with hosted_rooms._transaction(service.db_path) as conn:
        record = service.store._get_locked(conn, conversation_id)
        last = conn.execute('SELECT next_seq-1 FROM hosted_rooms WHERE room_id=?', (conversation_id,)).fetchone()[0]
        if cursor is None:
            cursor = {'revision': record.revision, 'cutoff': last, 'phase': 'events', 'after_seq': 0,
                      'content_index': 0, 'offset_bytes': 0}
            # Export only public product metadata: runtime paths and private Profile records are excluded.
            header = {'format': 'aino-public-conversation-v1', 'conversation_id': conversation_id,
                      'title': record.title, 'archived': record.archived, 'through_seq': last}
            return {'filename': 'conversation-' + hashlib.sha256(conversation_id.encode()).hexdigest()[:12] + '.json',
                    'chunk': _json(header)[:-1] + ',"events":[', 'cursor': cursor}
        cursor = dict(cursor)
        if cursor['revision'] != record.revision or cursor['cutoff'] != last:
            raise hosted_rooms.RoomConflictError('Conversation changed during export; restart the download.')
        if cursor['phase'] == 'events':
            if cursor['after_seq'] > last:
                raise ValueError('invalid export event cursor')
            rows = conn.execute('SELECT * FROM hosted_room_events WHERE room_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT 32',
                                (conversation_id, cursor['after_seq'], last)).fetchall()
            pieces = []
            for row in rows:
                event = hosted_rooms._event_from_row(row)
                payload = event['payload']
                if payload.get('content_ref'):
                    validate_reference_locked(conn, conversation_id, payload['content_ref'])
                from tui_gateway.conversation_attachments import attachment_locked
                for identity in payload.get('attachment_ids', ()):
                    attachment = attachment_locked(conn, conversation_id, identity)
                    validate_reference_locked(conn, conversation_id, attachment['content_ref'])
                pieces.append((',' if cursor['after_seq'] else '') + _json(event))
                cursor['after_seq'] = row['seq']
            if len(rows) < 32 or cursor['after_seq'] == last:
                pieces.append('],"content":[')
                cursor.update(phase='content', content_index=0, offset_bytes=0)
            return {'filename': None, 'chunk': ''.join(pieces), 'cursor': cursor}
        index, offset = cursor['content_index'], cursor['offset_bytes']
        ref = _content_ref(conn, conversation_id, last, index)
        if ref is None:
            if offset:
                raise ValueError('invalid export content cursor')
            return {'filename': None, 'chunk': ']}', 'cursor': None}
        validate_reference_locked(conn, conversation_id, ref)
        data = read_owned_locked(conn, conversation_id, ref['id'])
        if offset > len(data):
            raise ValueError('invalid export byte cursor')
        end = min(len(data), offset + 48 * 1024)
        prefix = (',' if index else '') + '{"reference":' + _json(ref) + ',"data_base64_chunks":[' if not offset else ','
        chunk = prefix + _json(base64.b64encode(data[offset:end]).decode())
        if end == len(data):
            chunk += ']}'
            cursor.update(content_index=index + 1, offset_bytes=0)
        else:
            cursor['offset_bytes'] = end
        return {'filename': None, 'chunk': chunk, 'cursor': cursor}

"""Durable admission reservations keep accepted replies inside logical storage budgets."""
from pathlib import Path
import json
import shutil


def limits_for_connection(conn):
    from .hosted_room_conversation_content import storage_limits
    path = Path(next(row[2] for row in conn.execute('PRAGMA database_list') if row[1] == 'main'))
    return storage_limits(path), path


def initialize_budget_schema(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_history_storage (
        conversation_id TEXT NOT NULL, operation_key TEXT NOT NULL, bytes INTEGER NOT NULL,
        PRIMARY KEY(conversation_id,operation_key))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_output_reservations (
        conversation_id TEXT NOT NULL, input_id TEXT NOT NULL, bytes INTEGER NOT NULL,
        PRIMARY KEY(conversation_id,input_id))''')


def usage(conn, conversation_id=None):
    where, args = (' WHERE room_id=?', (conversation_id,)) if conversation_id else (" WHERE purpose='conversation'", ())
    events = conn.execute('SELECT COALESCE(SUM(event_bytes),0) FROM hosted_rooms' + where, args).fetchone()[0]
    if conversation_id:
        blobs = conn.execute('''SELECT COALESCE(SUM(c.size_bytes),0) FROM hosted_conversation_content c
            JOIN hosted_conversation_content_owners o ON o.content_id=c.id WHERE o.conversation_id=?''', args).fetchone()[0]
    else:
        blobs = conn.execute('SELECT COALESCE(SUM(size_bytes),0) FROM hosted_conversation_content').fetchone()[0]
    reservations = conn.execute('SELECT COALESCE(SUM(bytes),0) FROM hosted_conversation_output_reservations' +
        (' WHERE conversation_id=?' if conversation_id else ''), args).fetchone()[0]
    history = conn.execute('SELECT COALESCE(SUM(bytes),0) FROM hosted_conversation_history_storage' +
        (' WHERE conversation_id=?' if conversation_id else ''), args).fetchone()[0]
    return events + blobs + reservations + history


def check_bytes(conn, conversation_id, additional, limits):
    from .hosted_room_conversation_content import ContentQuotaError
    if usage(conn) + additional > limits['max_total_bytes']:
        raise ContentQuotaError('Conversation storage is full; export history or increase its budget.')
    if usage(conn, conversation_id) + additional > limits['max_conversation_bytes']:
        raise ContentQuotaError('Conversation storage budget exhausted; export history or increase its budget.')


def reserve_output(conn, conversation_id, input_id):
    from .hosted_room_conversation_content import ContentQuotaError, initialize_content_schema
    initialize_content_schema(conn)
    limits, path = limits_for_connection(conn)
    if conn.execute('SELECT 1 FROM hosted_conversation_output_reservations WHERE conversation_id=? AND input_id=?',
                    (conversation_id, input_id)).fetchone():
        return
    # One maximum-size answer plus bounded terminal event metadata.
    size = limits['max_content_bytes'] + 256 * 1024
    check_bytes(conn, conversation_id, size, limits)
    reserved = conn.execute('SELECT COALESCE(SUM(bytes),0) FROM hosted_conversation_output_reservations').fetchone()[0]
    if shutil.disk_usage(path.parent).free < (reserved + size) * 2 + limits['min_free_disk_bytes']:
        raise ContentQuotaError('Insufficient disk space to accept a conversation reply.')
    conn.execute('INSERT INTO hosted_conversation_output_reservations VALUES (?,?,?)', (conversation_id, input_id, size))


def prepare_event(conn, room_id, kind, payload_json, additional):
    from .hosted_room_conversation_content import ContentQuotaError, initialize_content_schema
    initialize_content_schema(conn)
    limits, path = limits_for_connection(conn)
    payload = json.loads(payload_json)
    if kind == 'conversation.response':
        conn.execute('DELETE FROM hosted_conversation_output_reservations WHERE conversation_id=? AND input_id=?',
                     (room_id, payload.get('input_id')))
    count = conn.execute('SELECT next_seq-1 FROM hosted_rooms WHERE room_id=?', (room_id,)).fetchone()[0]
    reserved_count = conn.execute('SELECT COUNT(*) FROM hosted_conversation_output_reservations WHERE conversation_id=?',
                                 (room_id,)).fetchone()[0]
    if count + reserved_count >= limits['max_events_per_conversation']:
        raise ContentQuotaError('Conversation history limit reached; archive and start a new conversation.')
    check_bytes(conn, room_id, additional, limits)
    if shutil.disk_usage(path.parent).free < additional * 2 + limits['min_free_disk_bytes']:
        raise ContentQuotaError('Insufficient disk space for conversation history.')

"""Durable conversation authority, independent of whether any participant session exists."""
from __future__ import annotations

from gateway.hosted_room_conversation_maintenance import managed_call

from gateway import hosted_rooms

LOCAL_OWNER = 'legacy-local'


class ConversationOwnershipError(hosted_rooms.HostedRoomError):
    """The caller does not own this conversation."""


def owner_key(auth_user_id: str | None) -> str:
    return 'principal:' + auth_user_id if auth_user_id else LOCAL_OWNER


def initialize_owner_schema(conn) -> None:
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_owners (
        conversation_id TEXT PRIMARY KEY REFERENCES hosted_room_conversations(conversation_id),
        owner_key TEXT NOT NULL)''')
    # Earlier drafts stored ownership only after creating a participant runtime. Recover only
    # an unambiguous owner; never give an unknown old conversation to the first public reader.
    if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hosted_room_conversation_runtimes'").fetchone():
        conn.execute('''INSERT OR IGNORE INTO hosted_conversation_owners(conversation_id, owner_key)
            SELECT conversation_id, MIN(CASE WHEN auth_user_id IS NULL THEN ? ELSE 'principal:' || auth_user_id END)
            FROM hosted_room_conversation_runtimes GROUP BY conversation_id
            HAVING COUNT(DISTINCT CASE WHEN auth_user_id IS NULL THEN ? ELSE 'principal:' || auth_user_id END)=1''',
            (LOCAL_OWNER, LOCAL_OWNER))


def require_owner_locked(conn, conversation_id: str, expected_owner: str, *, claim_unowned=False) -> None:
    row = conn.execute('SELECT owner_key FROM hosted_conversation_owners WHERE conversation_id=?',
                       (conversation_id,)).fetchone()
    if row is None and claim_unowned:
        # Trusted in-process import/setup may create a primitive store record before its first
        # session. Public create supplies an owner atomically; public reads never use this path.
        existing = conn.execute('SELECT 1 FROM hosted_room_conversations WHERE conversation_id=?',
                                (conversation_id,)).fetchone()
        has_runtimes = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hosted_room_conversation_runtimes'").fetchone()
        ambiguous = has_runtimes and conn.execute(
            'SELECT 1 FROM hosted_room_conversation_runtimes WHERE conversation_id=? LIMIT 1',
            (conversation_id,)).fetchone()
        if existing is not None and not ambiguous:
            conn.execute('INSERT INTO hosted_conversation_owners VALUES (?,?)',
                         (conversation_id, expected_owner))
            return
    if row is None or row['owner_key'] != expected_owner:
        raise ConversationOwnershipError('conversation is unavailable to this owner')


@managed_call
def require_owner(db_path, conversation_id: str, expected_owner: str, *, claim_unowned=False) -> None:
    with hosted_rooms._transaction(db_path, immediate=True) as conn:
        initialize_owner_schema(conn)
        require_owner_locked(conn, conversation_id, expected_owner, claim_unowned=claim_unowned)

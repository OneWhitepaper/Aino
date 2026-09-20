"""Conversation metadata changes preserve the public history and title authority."""
from gateway import hosted_rooms
from gateway.hosted_room_conversation_maintenance import managed_store


def initialize_metadata_schema(conn):
    columns = {row[1] for row in conn.execute('PRAGMA table_info(hosted_room_conversations)')}
    if 'title_source' not in columns:
        conn.execute("ALTER TABLE hosted_room_conversations ADD COLUMN title_source TEXT NOT NULL DEFAULT 'user'")


def derive_first_public_title(conn, conversation_id, text):
    from agent.title_generator import derive_title
    if conn.execute('SELECT 1 FROM hosted_room_conversation_inputs WHERE conversation_id=? LIMIT 1',
                    (conversation_id,)).fetchone():
        return
    title = derive_title(text)
    if title and conn.execute("UPDATE hosted_room_conversations SET title_source='generated' "
            "WHERE conversation_id=? AND title_source='initial'", (conversation_id,)).rowcount:
        conn.execute('UPDATE hosted_rooms SET name=? WHERE room_id=?', (title, conversation_id))


@managed_store
class ConversationMetadataMixin:
    def archive(self, conversation_id, expected_revision, *, owner_key=None):
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            if owner_key is not None:
                from .hosted_room_conversation_owners import require_owner_locked
                require_owner_locked(conn, conversation_id, owner_key)
            from .hosted_room_conversation_migration import require_migration_complete
            require_migration_complete(conn, conversation_id)
            record = self._get_locked(conn, conversation_id)
            if type(expected_revision) is not int or record.revision != expected_revision:
                raise hosted_rooms.RoomConflictError('conversation revision changed')
            if record.archived:
                return record
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name='hosted_room_driver_tasks'").fetchone():
                self._check_admission_locked(conn, conversation_id, expected_revision)
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name='hosted_conversation_background_origins'").fetchone():
                if conn.execute("SELECT 1 FROM hosted_conversation_background_origins WHERE conversation_id=? "
                        "AND state NOT IN ('completed','rejected','cancelled') LIMIT 1", (conversation_id,)).fetchone():
                    from .hosted_room_conversation_admission import ConversationBusyError
                    raise ConversationBusyError('conversation has active delegations')
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name='hosted_conversation_output_reservations'").fetchone():
                if conn.execute('SELECT 1 FROM hosted_conversation_output_reservations WHERE conversation_id=? LIMIT 1',
                                (conversation_id,)).fetchone():
                    from .hosted_room_conversation_admission import ConversationBusyError
                    raise ConversationBusyError('conversation has unpublished output')
            now = hosted_rooms._now(None)
            conn.execute('UPDATE hosted_room_conversations SET archived_at=? WHERE conversation_id=?', (now, conversation_id))
            conn.execute('UPDATE hosted_rooms SET revision=revision+1,updated_at=? WHERE room_id=?', (now, conversation_id))
            return self._get_locked(conn, conversation_id)

    def rename(self, conversation_id, title, expected_revision, *, owner_key=None):
        title = hosted_rooms._validate_room_name(title)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            if owner_key is not None:
                from .hosted_room_conversation_owners import require_owner_locked
                require_owner_locked(conn, conversation_id, owner_key)
            from .hosted_room_conversation_migration import require_migration_complete
            require_migration_complete(conn, conversation_id)
            record = self._get_locked(conn, conversation_id)
            if type(expected_revision) is not int or record.revision != expected_revision:
                raise hosted_rooms.RoomConflictError('conversation revision changed')
            conn.execute("UPDATE hosted_room_conversations SET title_source='user' WHERE conversation_id=?", (conversation_id,))
            conn.execute('UPDATE hosted_rooms SET name=?,revision=revision+1,updated_at=? WHERE room_id=?',
                         (title, hosted_rooms._now(None), conversation_id))
            return self._get_locked(conn, conversation_id)

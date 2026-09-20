"""Immutable shared content with separately metered conversation ownership."""
from __future__ import annotations

import hashlib
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path

from gateway import hosted_rooms


@dataclass(frozen=True)
class ContentRef:
    id: str
    sha256: str
    size_bytes: int
    mime_type: str


class ContentQuotaError(hosted_rooms.HostedRoomError):
    pass


def storage_limits(db_path: Path) -> dict[str, int]:
    from hermes_cli.config_effective import load_user_config_effective
    from hermes_cli.config_defaults import DEFAULT_CONFIG
    config = load_user_config_effective(Path(db_path).parent / 'config.yaml')
    section = config.get('conversations', {})
    if not isinstance(section, dict) or not isinstance(section.get('storage', {}), dict):
        raise ValueError('conversations.storage must be a mapping')
    defaults = DEFAULT_CONFIG['conversations']['storage']
    values = {**defaults, **section.get('storage', {})}
    for key, value in values.items():
        if key not in defaults or type(value) is not int or not 0 < value <= 1024**4:
            raise ValueError(f'Invalid conversations.storage.{key}: expected a positive bounded integer')
    return values


def initialize_content_schema(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_content (
        id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL,
        mime_type TEXT NOT NULL, data BLOB NOT NULL)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_content_owners (
        conversation_id TEXT NOT NULL, content_id TEXT NOT NULL,
        PRIMARY KEY(conversation_id, content_id),
        FOREIGN KEY(conversation_id) REFERENCES hosted_room_conversations(conversation_id),
        FOREIGN KEY(content_id) REFERENCES hosted_conversation_content(id))''')


def read_owned_locked(conn, conversation_id: str, content_id: str) -> bytes:
    row = conn.execute('''SELECT c.data, c.sha256 FROM hosted_conversation_content c
        JOIN hosted_conversation_content_owners o ON o.content_id=c.id
        WHERE o.conversation_id=? AND c.id=?''', (conversation_id, content_id)).fetchone()
    if row is None:
        raise ValueError('content does not belong to this conversation')
    data = bytes(row['data'])
    if hashlib.sha256(data).hexdigest() != row['sha256']:
        raise ValueError('content hash mismatch')
    return data


def validate_reference_locked(conn, conversation_id, value, *, text=False):
    if (not isinstance(value, dict) or set(value) != {'id', 'sha256', 'size_bytes', 'mime_type'}
            or any(type(value[key]) is not str for key in ('id', 'sha256', 'mime_type'))
            or type(value['size_bytes']) is not int):
        raise ValueError('invalid content reference')
    data = read_owned_locked(conn, conversation_id, value['id'])
    row = conn.execute('SELECT id, sha256, size_bytes, mime_type FROM hosted_conversation_content WHERE id=?',
                       (value['id'],)).fetchone()
    ref = ContentRef(**dict(row))
    if value != asdict(ref):
        raise ValueError('content reference differs from stored content')
    if text:
        if ref.mime_type != 'text/plain; charset=utf-8':
            raise ValueError('response content must be UTF-8 text')
        data.decode('utf-8')
    return ref


class ConversationContentStore:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            initialize_content_schema(conn)

    def _associate(self, conn, conversation_id, ref, limits):
        if conn.execute('SELECT 1 FROM hosted_room_conversations WHERE conversation_id=?',
                        (conversation_id,)).fetchone() is None:
            raise ValueError('conversation does not exist')
        if conn.execute('''SELECT 1 FROM hosted_conversation_content_owners
                WHERE conversation_id=? AND content_id=?''', (conversation_id, ref.id)).fetchone():
            return
        used = conn.execute('''SELECT COALESCE(SUM(c.size_bytes),0) FROM hosted_conversation_content c
            JOIN hosted_conversation_content_owners o ON o.content_id=c.id
            WHERE o.conversation_id=?''', (conversation_id,)).fetchone()[0]
        if used + ref.size_bytes > limits['max_conversation_bytes']:
            raise ContentQuotaError('Conversation content budget exhausted; archive or export history.')
        self._disk_admission(0, limits)
        conn.execute('INSERT INTO hosted_conversation_content_owners VALUES (?, ?)', (conversation_id, ref.id))

    def _disk_admission(self, size, limits):
        # Reserve room for SQLite page/WAL overhead as well as the immutable blob.
        if shutil.disk_usage(self.db_path.parent).free < size * 2 + limits['min_free_disk_bytes']:
            raise ContentQuotaError('Insufficient disk space for conversation content.')

    def _put(self, data, mime_type, conversation_id=None):
        if not isinstance(data, bytes):
            raise TypeError('content must be bytes')
        if (not isinstance(mime_type, str) or not mime_type.strip() or len(mime_type) > 255
                or any(ord(char) < 32 or ord(char) == 127 for char in mime_type)):
            raise ValueError('mime_type must be a non-empty bounded string')
        digest = hashlib.sha256(data).hexdigest()
        content_id = hashlib.sha256(mime_type.encode() + b'\0' + data).hexdigest()
        ref = ContentRef(content_id, digest, len(data), mime_type)
        limits = storage_limits(self.db_path)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            exists = conn.execute('SELECT * FROM hosted_conversation_content WHERE id=?', (ref.id,)).fetchone()
            if exists and (ContentRef(**{key: exists[key] for key in ('id', 'sha256', 'size_bytes', 'mime_type')}) != ref
                           or bytes(exists['data']) != data):
                raise ValueError('content ID conflicts with stored content')
            if not exists:
                used = conn.execute('SELECT COALESCE(SUM(size_bytes),0) FROM hosted_conversation_content').fetchone()[0]
                if len(data) > limits['max_content_bytes'] or used + len(data) > limits['max_total_bytes']:
                    raise ContentQuotaError('Shared content budget exhausted; archive or export history.')
                self._disk_admission(len(data), limits)
                conn.execute('INSERT INTO hosted_conversation_content VALUES (?, ?, ?, ?, ?)',
                             (ref.id, digest, len(data), mime_type, data))
            if conversation_id is not None:
                self._associate(conn, conversation_id, ref, limits)
        return ref

    def put(self, data: bytes, mime_type: str) -> ContentRef:
        return self._put(data, mime_type)

    def put_for_conversation(self, conversation_id: str, data: bytes, mime_type: str) -> ContentRef:
        """Atomically admit both bytes and their ownership, before accepting an attachment."""
        return self._put(data, mime_type, conversation_id)

    def associate(self, conversation_id: str, content_id: str) -> ContentRef:
        limits = storage_limits(self.db_path)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            row = conn.execute('SELECT id, sha256, size_bytes, mime_type FROM hosted_conversation_content WHERE id=?',
                               (content_id,)).fetchone()
            if row is None:
                raise ValueError('content does not exist')
            ref = ContentRef(**dict(row))
            self._associate(conn, conversation_id, ref, limits)
            return ref

    def validate_reference(self, conversation_id: str, value: object, *, text=False) -> ContentRef:
        """Validate a complete immutable reference against its owned canonical row."""
        with hosted_rooms._transaction(self.db_path) as conn:
            return validate_reference_locked(conn, conversation_id, value, text=text)

    def read(self, content_id: str) -> bytes:
        """Trusted local API; remote readers must use read_for_conversation after authorization."""
        with hosted_rooms._transaction(self.db_path) as conn:
            row = conn.execute('SELECT data, sha256 FROM hosted_conversation_content WHERE id=?', (content_id,)).fetchone()
            if row is None:
                raise ValueError('content does not exist')
            data = bytes(row['data'])
            if hashlib.sha256(data).hexdigest() != row['sha256']:
                raise ValueError('content hash mismatch')
            return data

    def read_for_conversation(self, conversation_id: str, content_id: str) -> bytes:
        with hosted_rooms._transaction(self.db_path) as conn:
            return read_owned_locked(conn, conversation_id, content_id)

"""Shared attachment ownership, frozen provenance and trusted local turn staging."""
from __future__ import annotations

from gateway.hosted_room_conversation_maintenance import managed_store

import base64
import hashlib
import json
import mimetypes
import threading
from dataclasses import replace
from html import escape
from pathlib import Path

from gateway import hosted_rooms
from gateway.hosted_room_conversation_content import ConversationContentStore, storage_limits
from gateway.hosted_room_conversation_context import ContextBudgetError

_materialize_lock = threading.Lock()


def max_attachment_bytes(db_path):
    from .prompt_attachments import _ATTACH_BYTES_MAX_BYTES
    return min(storage_limits(db_path)['max_content_bytes'], _ATTACH_BYTES_MAX_BYTES)


def _initialize(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_attachments (
        conversation_id TEXT NOT NULL, attachment_id TEXT NOT NULL, filename TEXT NOT NULL,
        content_id TEXT NOT NULL, PRIMARY KEY(conversation_id, attachment_id),
        FOREIGN KEY(conversation_id, content_id)
            REFERENCES hosted_conversation_content_owners(conversation_id, content_id))''')


def attachment_locked(conn, conversation_id, attachment_id):
    row = conn.execute('''SELECT a.attachment_id, a.filename, c.id, c.sha256, c.size_bytes, c.mime_type
        FROM hosted_conversation_attachments a JOIN hosted_conversation_content c ON c.id=a.content_id
        WHERE a.conversation_id=? AND a.attachment_id=?''', (conversation_id, attachment_id)).fetchone()
    if row is None:
        raise ValueError('attachment does not belong to this conversation')
    return {'id': row['attachment_id'], 'filename': row['filename'], 'content_ref': {
        key: row[key] for key in ('id', 'sha256', 'size_bytes', 'mime_type')}}


def validate_attachment_bytes(data_base64, mime_type, *, max_bytes):
    """Pure byte/MIME validation shared by upload and pre-fence legacy adoption."""
    if not isinstance(data_base64, str) or len(data_base64) > 4 * ((max_bytes + 2) // 3):
        raise ValueError('attachment exceeds content size budget')
    try:
        data = base64.b64decode(data_base64, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError('invalid attachment base64') from exc
    if not data or len(data) > max_bytes:
        raise ValueError('empty or oversized attachment')
    if mime_type.startswith('image/'):
        from io import BytesIO
        from PIL import Image
        try:
            with Image.open(BytesIO(data)) as image:
                if Image.MIME.get(image.format) != mime_type:
                    raise ValueError('image MIME differs from its bytes')
                image.verify()
        except (OSError, SyntaxError) as exc:
            raise ValueError('invalid image attachment') from exc
    return data


@managed_store
class ConversationAttachments:
    def __init__(self, service):
        self.service = service
        self.content = ConversationContentStore(service.db_path)
        with hosted_rooms._transaction(service.db_path, immediate=True) as conn:
            _initialize(conn)

    def attach(self, conversation_id, filename, mime_type, data_base64):
        self.service._authorize(conversation_id, write=True)
        if self.service.store.get(conversation_id).archived:
            raise ValueError('conversation is archived')
        data = validate_attachment_bytes(data_base64, mime_type,
                                         max_bytes=max_attachment_bytes(self.service.db_path))
        filename = self.service.server._sanitize_attachment_name(filename.replace('\\', '/'))
        ref = self.content.put_for_conversation(conversation_id, data, mime_type)
        attachment_id = hashlib.sha256((ref.id + '\0' + filename).encode()).hexdigest()
        with hosted_rooms._transaction(self.service.db_path, immediate=True) as conn:
            conn.execute('INSERT OR IGNORE INTO hosted_conversation_attachments VALUES (?, ?, ?, ?)',
                         (conversation_id, attachment_id, filename, ref.id))
            attachment = attachment_locked(conn, conversation_id, attachment_id)
        return {'attachment': attachment}

    def page(self, conversation_id, content_id, offset_bytes=0, limit_bytes=65536):
        self.service._authorize(conversation_id)
        if type(offset_bytes) is not int or offset_bytes < 0 or type(limit_bytes) is not int or not 1 <= limit_bytes <= 262144:
            raise ValueError('invalid byte range')
        data = self.content.read_for_conversation(conversation_id, content_id)
        if offset_bytes > len(data):
            raise ValueError('offset exceeds content size')
        end = min(len(data), offset_bytes + limit_bytes)
        return {'data_base64': base64.b64encode(data[offset_bytes:end]).decode(),
                'next_offset': end, 'has_more': end < len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    def selected(self, conversation_id, attachment_ids, source_event_ids=()):
        result = []
        with hosted_rooms._transaction(self.service.db_path) as conn:
            for event_id in source_event_ids:
                row = conn.execute('SELECT payload_json FROM hosted_room_events WHERE room_id=? AND event_id=?',
                                   (conversation_id, event_id)).fetchone()
                if row is None:
                    raise ValueError('attachment source event is missing')
                for attachment_id in json.loads(row['payload_json']).get('attachment_ids', ()):
                    result.append({**attachment_locked(conn, conversation_id, attachment_id), 'source_event_id': event_id})
            for attachment_id in attachment_ids:
                result.append({**attachment_locked(conn, conversation_id, attachment_id), 'source_event_id': 'current_input'})
        for entry in result:
            self.content.validate_reference(conversation_id, entry['content_ref'])
        return result

    def materialize(self, conversation_id, attachment):
        ref = attachment['content_ref']
        data = self.content.read_for_conversation(conversation_id, ref['id'])
        root = self.service.db_path.parent / 'conversation-materialized'
        suffix = mimetypes.guess_extension(ref['mime_type'].split(';', 1)[0]) or ''
        if not suffix.isascii() or not suffix[1:].isalnum():
            suffix = ''
        # Content identity, not a Profile or client path, owns this shared cache entry.
        name = ref['id'] + suffix
        target = root / 'attachments' / name
        with _materialize_lock:
            if target.exists():
                if target.is_symlink() or target.read_bytes() != data:
                    raise ValueError('shared attachment materialization differs from durable bytes')
            else:
                self.service.server._stage_session_file_attachment(
                    {'profile_home': str(root), 'cwd': str(root)}, raw_path='',
                    data_url=base64.b64encode(data).decode(), name=name)
        return target

    def freeze(self, conversation_id, request, envelope):
        manifest = self.selected(conversation_id, request.attachment_ids, envelope.source_event_ids)
        if not manifest:
            return envelope
        lines = ['<shared_attachments>']
        current_event_id = 'conversation-input:' + hashlib.sha256(request.input_id.encode()).hexdigest()
        for entry in manifest:
            path = self.materialize(conversation_id, entry)
            metadata = {**entry, 'local_path': str(path)}
            if metadata['source_event_id'] == 'current_input':
                metadata['source_event_id'] = current_event_id
            lines.append(escape(json.dumps(metadata, ensure_ascii=False), quote=False).replace('@', '&#64;'))
            if entry['content_ref']['mime_type'].startswith('text/') and entry['content_ref']['size_bytes'] <= 16384:
                data = self.content.read_for_conversation(conversation_id, entry['content_ref']['id'])
                lines.append('<quoted_file_text>' + escape(data.decode('utf-8'), quote=False).replace('@', '&#64;') + '</quoted_file_text>')
        lines.append('</shared_attachments>')
        text = envelope.text + '\n' + '\n'.join(lines)
        if len(text.encode()) > 48 * 1024:
            raise ContextBudgetError('attachment context exceeds the frozen input budget')
        digest = hashlib.sha256(json.dumps({'base_digest': envelope.input_digest, 'text': text},
                                          sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        return replace(envelope, text=text, input_digest=digest)

    def stage_images(self, frozen):
        envelope = json.loads(frozen['envelope_json'])
        selected = self.selected(frozen['conversation_id'], json.loads(frozen['attachment_ids_json']),
                                 envelope['source_event_ids'])
        images = []
        for entry in selected:
            path = self.materialize(frozen['conversation_id'], entry)
            if entry['content_ref']['mime_type'].startswith('image/'):
                images.append(str(path))
        return list(dict.fromkeys(images))

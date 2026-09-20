"""Frozen private command expansions consumed with the public input transaction."""
from __future__ import annotations

import hashlib
import json
import secrets
from dataclasses import replace

from gateway import hosted_rooms
from gateway.hosted_room_conversation_context import ContextBudgetError

_INPUT_BUDGET_BYTES = 48 * 1024


def _initialize(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS hosted_conversation_command_tokens (
        token TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, owner_key TEXT NOT NULL,
        participant_id TEXT NOT NULL, session_generation INTEGER NOT NULL,
        expected_revision INTEGER NOT NULL, display TEXT NOT NULL, body TEXT,
        body_sha256 TEXT NOT NULL, consumed_input_id TEXT,
        UNIQUE(conversation_id, consumed_input_id),
        FOREIGN KEY(conversation_id, participant_id)
            REFERENCES hosted_room_conversation_participants(conversation_id, participant_id))''')


class ConversationCommandTokens:
    def __init__(self, db_path):
        self.db_path = db_path
        with hosted_rooms._transaction(db_path, immediate=True) as conn:
            _initialize(conn)

    def issue(self, *, owner, binding, revision, display, body):
        if not isinstance(body, str) or not body or len(body.encode()) > _INPUT_BUDGET_BYTES:
            raise ContextBudgetError('complete command expansion exceeds the frozen input budget')
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(body.encode()).hexdigest()
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            # Each participant has one composer resolution. Re-resolving invalidates stale drafts,
            # while consumed proofs remain available for exact admission replay.
            conn.execute('''DELETE FROM hosted_conversation_command_tokens
                WHERE conversation_id=? AND participant_id=? AND consumed_input_id IS NULL''',
                (binding.conversation_id, binding.participant.participant_id))
            conn.execute('''INSERT INTO hosted_conversation_command_tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)''',
                (token, binding.conversation_id, owner, binding.participant.participant_id,
                 binding.session_generation, revision, display, body, digest))
        return token

    def for_send(self, *, owner, conversation_id, request, revision, token):
        with hosted_rooms._transaction(self.db_path) as conn:
            consumed = conn.execute('''SELECT token FROM hosted_conversation_command_tokens
                WHERE conversation_id=? AND consumed_input_id=?''', (conversation_id, request.input_id)).fetchone()
            if token is None:
                if consumed:
                    raise hosted_rooms.RoomConflictError('command input replay requires its original resolution token')
                return None
            if consumed is None and conn.execute('''SELECT 1 FROM hosted_room_conversation_inputs
                    WHERE conversation_id=? AND input_id=?''', (conversation_id, request.input_id)).fetchone():
                raise hosted_rooms.RoomConflictError('input was admitted without a command resolution')
            row = conn.execute('SELECT * FROM hosted_conversation_command_tokens WHERE token=?', (token,)).fetchone()
            if row is None or (row['owner_key'], row['conversation_id'], row['participant_id'],
                    row['expected_revision'], row['display']) != (
                    owner, conversation_id, request.participant_id, revision, request.text):
                raise hosted_rooms.RoomConflictError('command resolution differs from this draft or owner')
            if consumed and consumed['token'] != token:
                raise hosted_rooms.RoomConflictError('input already consumed a different command resolution')
            if row['consumed_input_id'] is not None:
                if row['consumed_input_id'] != request.input_id:
                    raise hosted_rooms.RoomConflictError('command resolution was already consumed by another input')
                return dict(row)
            current = conn.execute('''SELECT session_generation FROM hosted_room_conversation_participants
                WHERE conversation_id=? AND participant_id=?''', (conversation_id, request.participant_id)).fetchone()
            if current is None or current[0] != row['session_generation']:
                raise hosted_rooms.RoomConflictError('command participant generation changed; resolve again')
            if not isinstance(row['body'], str) or hashlib.sha256(row['body'].encode()).hexdigest() != row['body_sha256']:
                raise hosted_rooms.RoomConflictError('command expansion is unavailable or changed')
            return dict(row)

    def for_reconciliation(self, *, owner, conversation_id, input_id):
        """Authenticated retry uses the already-consumed proof without expanding instructions."""
        with hosted_rooms._transaction(self.db_path) as conn:
            row = conn.execute('''SELECT * FROM hosted_conversation_command_tokens
                WHERE conversation_id=? AND consumed_input_id=?''', (conversation_id, input_id)).fetchone()
            if row is not None and row['owner_key'] != owner:
                raise hosted_rooms.RoomConflictError('command input belongs to a different owner')
            return dict(row) if row is not None else None


def validate_command_replay_locked(conn, conversation_id, input_id, resolution):
    """The input ACK and its consumed proof must come from the same transaction snapshot."""
    exists = conn.execute("SELECT 1 FROM sqlite_master WHERE name='hosted_conversation_command_tokens'").fetchone()
    consumed = conn.execute('''SELECT * FROM hosted_conversation_command_tokens
        WHERE conversation_id=? AND consumed_input_id=?''', (conversation_id, input_id)).fetchone() if exists else None
    if resolution is None:
        if consumed is not None:
            raise hosted_rooms.RoomConflictError('command input replay requires its original resolution token')
        return
    fields = ('token', 'conversation_id', 'owner_key', 'participant_id', 'session_generation',
              'expected_revision', 'display', 'body_sha256')
    if consumed is None or any(consumed[key] != resolution.get(key) for key in fields):
        raise hosted_rooms.RoomConflictError('input was admitted with a different command proof')


def freeze_command(envelope, resolution):
    if resolution is None:
        return envelope
    if resolution['consumed_input_id'] is not None:
        raise hosted_rooms.RoomConflictError('consumed command has no replayable admitted input')
    text = (envelope.text + '\n<private_command_instructions>\n' + resolution['body']
            + '\n</private_command_instructions>')
    if len(text.encode()) > _INPUT_BUDGET_BYTES:
        raise ContextBudgetError('complete command and context exceed the frozen input budget')
    digest = hashlib.sha256(json.dumps({'base_digest': envelope.input_digest, 'text': text,
        'command_sha256': resolution['body_sha256']}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return replace(envelope, text=text, input_digest=digest)


def consume_command_locked(conn, resolution, binding, request):
    if resolution is None:
        return
    row = conn.execute('SELECT * FROM hosted_conversation_command_tokens WHERE token=?',
                       (resolution['token'],)).fetchone()
    if row is None or dict(row) != resolution or row['consumed_input_id'] is not None:
        raise hosted_rooms.RoomConflictError('command resolution changed before admission')
    if (row['conversation_id'], row['participant_id'], row['session_generation'], row['display']) != (
            binding.conversation_id, binding.participant.participant_id, binding.session_generation, request.text):
        raise hosted_rooms.RoomConflictError('command resolution targets another participant or draft')
    # The prepared envelope is now the durable execution copy; retain only the replay proof here.
    conn.execute('UPDATE hosted_conversation_command_tokens SET consumed_input_id=?, body=NULL WHERE token=?',
                 (request.input_id, resolution['token']))

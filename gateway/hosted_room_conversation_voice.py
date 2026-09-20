"""Freeze the existing spoken-delegation note without publishing its transcript."""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, replace

from gateway import hosted_rooms
from gateway.hosted_room_conversation_context import ContextBudgetError


def voice_context_digest(surface, context):
    if surface is None:
        if context is not None:
            raise ValueError('voice_context requires the voice-live surface')
        return None
    if surface != 'voice-live' or (context is not None and not isinstance(context, str)):
        raise ValueError('invalid live voice context')
    if len(context or '') > 6000:
        raise ValueError('live voice context exceeds 6000 characters')
    return hashlib.sha256(json.dumps([surface, context or ''], ensure_ascii=False).encode()).hexdigest()


def freeze_voice_context(envelope, voice_digest, context):
    if voice_digest is None:
        return envelope
    from tools.voice_live import voice_live_turn_note
    text = voice_live_turn_note(context or '') + '\n\n' + envelope.text
    if len(text.encode()) > 48 * 1024:
        raise ContextBudgetError('complete spoken context and input exceed the frozen input budget')
    digest = hashlib.sha256(json.dumps({'base_digest': envelope.input_digest, 'text': text,
        'voice_context_digest': voice_digest}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return replace(envelope, text=text, input_digest=digest, voice_context_digest=voice_digest)


def validate_voice_replay_locked(conn, conversation_id, input_id, voice_digest):
    row = conn.execute('''SELECT envelope_json FROM hosted_conversation_prepared_inputs
        WHERE conversation_id=? AND input_id=?''', (conversation_id, input_id)).fetchone()
    original = json.loads(row['envelope_json']).get('voice_context_digest') if row else None
    if original != voice_digest:
        raise hosted_rooms.RoomConflictError('input was admitted with different live voice context')


def retain_voice_storage_locked(conn, conversation_id, input_id, envelope, task_payload):
    if envelope.voice_context_digest is None:
        return
    from .hosted_room_conversation_budget import check_bytes, limits_for_connection
    # Both the prepared envelope and the driver payload retain this private input.
    from gateway.hosted_room_driver import _task_payload
    size = len(json.dumps(asdict(envelope), sort_keys=True).encode()) + len(_task_payload(task_payload)[1].encode())
    limits, _ = limits_for_connection(conn)
    check_bytes(conn, conversation_id, size, limits)
    conn.execute('INSERT INTO hosted_conversation_history_storage VALUES (?,?,?)',
                 (conversation_id, 'voice-input:' + input_id, size))

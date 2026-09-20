"""Storage boundary for ordinary conversations backed by Hosted room events."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import asdict
from pathlib import Path
from typing import Any

from gateway import hosted_rooms
from gateway.hosted_room_conversation_types import (
    Admission, ConversationRecord, EventPage, ParticipantBinding, ParticipantRef, ProjectRef, TurnSubmission)

_PURPOSE = hosted_rooms.CONVERSATION_PURPOSE
_AUTHOR_ID = "user"
_AUTHOR_DISPLAY_NAME = "User"
_MAX_ATTACHMENTS = 128

_SCHEMA_DDL = (
    """CREATE TABLE IF NOT EXISTS hosted_room_conversations (
            conversation_id TEXT PRIMARY KEY,
            general_participant_id TEXT NOT NULL,
            project_json TEXT,
            archived_at REAL,
            FOREIGN KEY (conversation_id) REFERENCES hosted_rooms(room_id)
        )""",
    """CREATE TABLE IF NOT EXISTS hosted_room_conversation_participants (
            conversation_id TEXT NOT NULL,
            participant_id TEXT NOT NULL,
            install_id TEXT NOT NULL,
            profile TEXT NOT NULL,
            display_name TEXT NOT NULL,
            is_general INTEGER NOT NULL CHECK (is_general IN (0, 1)),
            session_generation INTEGER NOT NULL DEFAULT 1 CHECK (session_generation >= 1),
            lineage_id TEXT,
            PRIMARY KEY (conversation_id, participant_id),
            FOREIGN KEY (conversation_id) REFERENCES hosted_room_conversations(conversation_id)
        )""",
    """CREATE TABLE IF NOT EXISTS hosted_room_conversation_inputs (
            conversation_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            input_id TEXT NOT NULL,
            event_id TEXT NOT NULL,
            participant_id TEXT NOT NULL,
            text TEXT NOT NULL,
            attachment_ids_json TEXT NOT NULL,
            author_id TEXT NOT NULL,
            author_display_name TEXT NOT NULL,
            target_display_name TEXT NOT NULL,
            seq INTEGER NOT NULL CHECK (seq >= 1),
            PRIMARY KEY (conversation_id, input_id),
            UNIQUE (conversation_id, turn_id),
            UNIQUE (conversation_id, event_id),
            FOREIGN KEY (conversation_id, participant_id)
                REFERENCES hosted_room_conversation_participants(conversation_id, participant_id),
            FOREIGN KEY (conversation_id, seq) REFERENCES hosted_room_events(room_id, seq)
        )""",
)


def _initialize_schema(conn: sqlite3.Connection) -> None:
    for statement in _SCHEMA_DDL:
        conn.execute(statement)


def _display_name(value: Any) -> str:
    if not isinstance(value, str) or not (value := value.strip()):
        raise hosted_rooms.HostedRoomError("display_name must be a non-empty string")
    if len(value) > hosted_rooms.MAX_ACTOR_LABEL_CHARS:
        raise hosted_rooms.HostedRoomError("display_name is too long")
    return value


def _participant(value: ParticipantRef, *, require_general: bool | None = None) -> ParticipantRef:
    if not isinstance(value, ParticipantRef):
        raise hosted_rooms.HostedRoomError("participant must be a ParticipantRef")
    if not isinstance(value.is_general, bool):
        raise hosted_rooms.HostedRoomError("is_general must be a boolean")
    participant = ParticipantRef(
        hosted_rooms._actor_id(value.participant_id, "participant_id"),
        hosted_rooms._actor_id(value.install_id, "install_id"),
        hosted_rooms._actor_id(value.profile, "profile"),
        _display_name(value.display_name), value.is_general)
    if require_general is not None and participant.is_general is not require_general:
        qualifier = "general" if require_general else "expert"
        raise hosted_rooms.HostedRoomError(f"participant must be a {qualifier} participant")
    return participant


def _project(value: ProjectRef | None) -> ProjectRef | None:
    if value is None:
        return None
    if not isinstance(value, ProjectRef):
        raise hosted_rooms.HostedRoomError("project must be a ProjectRef or None")
    fields = {
        "install_id": hosted_rooms._actor_id(value.install_id, "project.install_id"),
        "registration_profile": hosted_rooms._actor_id(
            value.registration_profile, "project.registration_profile"),
        "project_id": hosted_rooms._actor_id(value.project_id, "project.project_id"),
        "execution_environment_id": hosted_rooms._actor_id(
            value.execution_environment_id, "project.execution_environment_id"),
    }
    if not isinstance(value.cwd, str) or not value.cwd.strip():
        raise hosted_rooms.HostedRoomError("project.cwd must be a non-empty string")
    return ProjectRef(cwd=value.cwd, **fields)


def _project_json(project: ProjectRef | None) -> str | None:
    return None if project is None else hosted_rooms._canonical_json(
        asdict(project), label="project", max_bytes=64 * 1024)


def _participant_from_row(row: sqlite3.Row) -> ParticipantRef:
    return ParticipantRef(
        participant_id=str(row["participant_id"]), install_id=str(row["install_id"]),
        profile=str(row["profile"]), display_name=str(row["display_name"]),
        is_general=bool(row["is_general"]))


def _binding_from_row(row: sqlite3.Row) -> ParticipantBinding:
    return ParticipantBinding(
        conversation_id=str(row["conversation_id"]), participant=_participant_from_row(row),
        session_generation=int(row["session_generation"]),
        lineage_id=str(row["lineage_id"]) if row["lineage_id"] is not None else None)


def _admission_from_row(row: sqlite3.Row, *, idempotent: bool) -> Admission:
    return Admission(
        conversation_id=str(row["conversation_id"]), turn_id=str(row["turn_id"]),
        input_id=str(row["input_id"]), event_id=str(row["event_id"]), seq=int(row["seq"]),
        participant_id=str(row["participant_id"]), idempotent=idempotent)


def _record_from_rows(room: sqlite3.Row, metadata: sqlite3.Row, general: sqlite3.Row) -> ConversationRecord:
    project_data = json.loads(metadata["project_json"]) if metadata["project_json"] is not None else None
    return ConversationRecord(
        conversation_id=str(room["room_id"]), title=str(room["name"]),
        general=_participant_from_row(general),
        project=ProjectRef(**project_data) if project_data is not None else None,
        revision=int(room["revision"]), archived=metadata["archived_at"] is not None)


class ConversationStore:
    """Persist ordinary conversation metadata beside the shared Hosted event log."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            _initialize_schema(conn)

    def create(
        self, conversation_id: str, title: str, general: ParticipantRef,
        project: ProjectRef | None,
    ) -> ConversationRecord:
        conversation_id = hosted_rooms._room_id(conversation_id)
        title = hosted_rooms._validate_room_name(title)
        general = _participant(general, require_general=True)
        project = _project(project)
        project_json = _project_json(project)
        authority_gateway_id = hosted_rooms.local_authority_gateway_id()
        now = hosted_rooms._now(None)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            hosted_rooms._create_room_locked(
                conn, room_id=conversation_id, purpose=_PURPOSE, name=title,
                normalized_members=[], members_json="[]",
                authority_gateway_id=authority_gateway_id, now=now)
            metadata = conn.execute(
                "SELECT * FROM hosted_room_conversations WHERE conversation_id=?",
                (conversation_id,)).fetchone()
            if metadata is None:
                conn.execute(
                    """INSERT INTO hosted_room_conversations(
                           conversation_id, general_participant_id, project_json, archived_at
                       ) VALUES (?, ?, ?, NULL)""",
                    (conversation_id, general.participant_id, project_json))
                conn.execute(
                    """INSERT INTO hosted_room_conversation_participants(
                           conversation_id, participant_id, install_id, profile, display_name,
                           is_general, session_generation, lineage_id
                       ) VALUES (?, ?, ?, ?, ?, 1, 1, NULL)""",
                    (conversation_id, general.participant_id, general.install_id,
                     general.profile, general.display_name))
            else:
                existing_general = conn.execute(
                    """SELECT * FROM hosted_room_conversation_participants
                       WHERE conversation_id=? AND participant_id=?""",
                    (conversation_id, metadata["general_participant_id"])).fetchone()
                if (
                    metadata["general_participant_id"] != general.participant_id
                    or metadata["project_json"] != project_json
                    or existing_general is None
                    or _participant_from_row(existing_general) != general
                ):
                    raise hosted_rooms.RoomConflictError(
                        "conversation_id already exists with different metadata")
            return self._get_locked(conn, conversation_id)

    def _get_locked(self, conn: sqlite3.Connection, conversation_id: str) -> ConversationRecord:
        room = hosted_rooms._room_row(conn, hosted_rooms._SELECT_ROOM, (conversation_id,), conversation_id)
        hosted_rooms._require_room_purpose(room, _PURPOSE)
        metadata = conn.execute(
            "SELECT * FROM hosted_room_conversations WHERE conversation_id=?", (conversation_id,)).fetchone()
        if metadata is None:
            raise hosted_rooms.RoomNotFoundError("conversation metadata not found")
        general = conn.execute(
            """SELECT * FROM hosted_room_conversation_participants
               WHERE conversation_id=? AND participant_id=?""",
            (conversation_id, metadata["general_participant_id"])).fetchone()
        if general is None:
            raise hosted_rooms.RoomNotFoundError("conversation general participant not found")
        return _record_from_rows(room, metadata, general)

    def get(self, conversation_id: str) -> ConversationRecord:
        conversation_id = hosted_rooms._room_id(conversation_id)
        with hosted_rooms._transaction(self.db_path) as conn:
            return self._get_locked(conn, conversation_id)

    def bind_participant(
        self, conversation_id: str, participant: ParticipantRef,
    ) -> ParticipantBinding:
        conversation_id = hosted_rooms._room_id(conversation_id)
        participant = _participant(participant)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            record = self._get_locked(conn, conversation_id)
            if participant.is_general and participant.participant_id != record.general.participant_id:
                raise hosted_rooms.RoomConflictError("conversation already has a general participant")
            row = conn.execute(
                """SELECT * FROM hosted_room_conversation_participants
                   WHERE conversation_id=? AND participant_id=?""",
                (conversation_id, participant.participant_id)).fetchone()
            if row is not None:
                if _participant_from_row(row) != participant:
                    raise hosted_rooms.RoomConflictError(
                        "participant_id already exists with different identity")
                return _binding_from_row(row)
            conn.execute(
                """INSERT INTO hosted_room_conversation_participants(
                       conversation_id, participant_id, install_id, profile, display_name,
                       is_general, session_generation, lineage_id
                   ) VALUES (?, ?, ?, ?, ?, ?, 1, NULL)""",
                (conversation_id, participant.participant_id, participant.install_id,
                 participant.profile, participant.display_name, int(participant.is_general)))
            conn.execute(
                "UPDATE hosted_rooms SET revision=revision+1, updated_at=? WHERE room_id=?",
                (hosted_rooms._now(None), conversation_id))
            row = conn.execute(
                """SELECT * FROM hosted_room_conversation_participants
                   WHERE conversation_id=? AND participant_id=?""",
                (conversation_id, participant.participant_id)).fetchone()
            if row is None:  # pragma: no cover - guarded by the insert
                raise RuntimeError("participant binding could not be reloaded")
            return _binding_from_row(row)

    def append_input(self, conversation_id: str, submission: TurnSubmission) -> Admission:
        conversation_id = hosted_rooms._room_id(conversation_id)
        if not isinstance(submission, TurnSubmission):
            raise hosted_rooms.HostedRoomError("submission must be a TurnSubmission")
        turn_id = hosted_rooms._event_id(submission.turn_id)
        input_id = hosted_rooms._event_id(submission.input_id)
        participant_id = hosted_rooms._actor_id(submission.participant_id, "participant_id")
        if not isinstance(submission.text, str) or not submission.text.strip():
            raise hosted_rooms.HostedRoomError("text must be a non-empty string")
        if not isinstance(submission.attachment_ids, tuple) or len(submission.attachment_ids) > _MAX_ATTACHMENTS:
            raise hosted_rooms.HostedRoomError("attachment_ids must be a bounded tuple")
        attachment_ids = tuple(
            hosted_rooms._validate_identifier(
                item, label="attachment_id", max_chars=hosted_rooms.MAX_EVENT_ID_CHARS)
            for item in submission.attachment_ids)
        attachment_ids_json = hosted_rooms._canonical_json(
            list(attachment_ids), label="attachment_ids", max_bytes=64 * 1024)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            record = self._get_locked(conn, conversation_id)
            if record.archived:
                raise hosted_rooms.RoomConflictError("conversation is archived")
            rows = conn.execute(
                """SELECT * FROM hosted_room_conversation_inputs
                   WHERE conversation_id=? AND (input_id=? OR turn_id=?)""",
                (conversation_id, input_id, turn_id)).fetchall()
            if rows:
                row = rows[0]
                immutable = (
                    str(row["turn_id"]), str(row["input_id"]), str(row["participant_id"]),
                    str(row["text"]), str(row["attachment_ids_json"]))
                if immutable != (
                    turn_id, input_id, participant_id, submission.text, attachment_ids_json):
                    raise hosted_rooms.RoomConflictError(
                        "input_id or turn_id already exists with different content or recipient")
                return _admission_from_row(row, idempotent=True)
            binding = conn.execute(
                """SELECT * FROM hosted_room_conversation_participants
                   WHERE conversation_id=? AND participant_id=?""",
                (conversation_id, participant_id)).fetchone()
            if binding is None:
                raise hosted_rooms.RoomNotFoundError("conversation participant not found")
            event_id = f"conversation-input:{hashlib.sha256(input_id.encode('utf-8')).hexdigest()}"
            actor = {"kind": "user", "id": _AUTHOR_ID, "display_name": _AUTHOR_DISPLAY_NAME}
            normalized_actor, actor_json = hosted_rooms._validate_actor(actor, kind="conversation.input")
            payload = {
                "turn_id": turn_id, "input_id": input_id, "text": submission.text,
                "attachment_ids": list(attachment_ids), "target_participant_id": participant_id,
                "target_display_name_at_time": str(binding["display_name"]),
                "author_display_name_at_time": _AUTHOR_DISPLAY_NAME}
            room = conn.execute(
                "SELECT authority_gateway_id, authority_epoch FROM hosted_rooms WHERE room_id=?",
                (conversation_id,)).fetchone()
            if room is None:  # pragma: no cover - _get_locked already proves it
                raise hosted_rooms.RoomNotFoundError("conversation not found")
            event = hosted_rooms._append_event_locked(
                conn, room_id=conversation_id, purpose=_PURPOSE, event_id=event_id,
                kind="conversation.input", normalized_actor=normalized_actor, actor_json=actor_json,
                payload_json=hosted_rooms._payload_json(payload),
                authority_gateway_id=str(room["authority_gateway_id"]),
                authority_epoch=int(room["authority_epoch"]), now=hosted_rooms._now(None))
            conn.execute(
                """INSERT INTO hosted_room_conversation_inputs(
                       conversation_id, turn_id, input_id, event_id, participant_id, text,
                       attachment_ids_json, author_id, author_display_name,
                       target_display_name, seq
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (conversation_id, turn_id, input_id, event_id, participant_id, submission.text,
                 attachment_ids_json, _AUTHOR_ID, _AUTHOR_DISPLAY_NAME,
                 str(binding["display_name"]), int(event["seq"])))
            row = conn.execute(
                """SELECT * FROM hosted_room_conversation_inputs
                   WHERE conversation_id=? AND input_id=?""",
                (conversation_id, input_id)).fetchone()
            if row is None:  # pragma: no cover - guarded by the insert
                raise RuntimeError("conversation input could not be reloaded")
            return _admission_from_row(row, idempotent=False)

    def events(
        self, conversation_id: str, after_seq: int = 0, limit: int = 100,
    ) -> EventPage:
        page = hosted_rooms.read_events(
            self.db_path, room_id=conversation_id, since_seq=after_seq,
            limit=limit, purpose=_PURPOSE)
        return EventPage(
            events=tuple(page["events"]), cursor=int(page["cursor"]),
            has_more=bool(page["has_more"]))

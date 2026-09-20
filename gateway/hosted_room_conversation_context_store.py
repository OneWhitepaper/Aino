"""Generation-scoped context coverage and persisted public summary proofs."""

from __future__ import annotations

import json
from dataclasses import asdict

from gateway import hosted_rooms
from gateway.hosted_room_conversation_context import ContextCoverage, PublicMessage, TurnEnvelope, _validate_summary
from gateway.hosted_room_conversation_types import ConversationRecord, ParticipantBinding
from hermes_state_conversation_receipts import InputReceipt


def initialize_context_schema(conn) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS hosted_conversation_prepared_inputs (
        conversation_id TEXT NOT NULL, input_id TEXT NOT NULL, participant_id TEXT NOT NULL,
        session_generation INTEGER NOT NULL CHECK(session_generation >= 1), lineage_id TEXT,
        envelope_json TEXT NOT NULL,
        PRIMARY KEY(conversation_id, input_id),
        FOREIGN KEY(conversation_id, input_id)
            REFERENCES hosted_room_conversation_inputs(conversation_id, input_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS hosted_conversation_input_acks (
        conversation_id TEXT NOT NULL, input_id TEXT NOT NULL, participant_id TEXT NOT NULL,
        session_generation INTEGER NOT NULL CHECK(session_generation >= 1),
        receipt_json TEXT NOT NULL, source_ids_json TEXT NOT NULL, through_seq INTEGER NOT NULL,
        PRIMARY KEY(conversation_id, input_id),
        FOREIGN KEY(conversation_id, input_id)
            REFERENCES hosted_room_conversation_inputs(conversation_id, input_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS hosted_conversation_summaries (
        conversation_id TEXT NOT NULL, participant_id TEXT NOT NULL,
        session_generation INTEGER NOT NULL CHECK(session_generation >= 1),
        version INTEGER NOT NULL, text TEXT NOT NULL, through_seq INTEGER NOT NULL,
        source_ids_json TEXT NOT NULL,
        PRIMARY KEY(conversation_id, participant_id, session_generation, version),
        FOREIGN KEY(conversation_id, participant_id)
            REFERENCES hosted_room_conversation_participants(conversation_id, participant_id))""")


def _history(conn, conversation_id: str, cutoff: int | None = None) -> tuple[PublicMessage, ...]:
    # A DB snapshot is complete through its cutoff; a single replay page is not.
    rows = conn.execute("""SELECT event_id, seq, kind, actor_json, payload_json
        FROM hosted_room_events WHERE room_id=? AND (? IS NULL OR seq<=?) ORDER BY seq""",
        (conversation_id, cutoff, cutoff))
    result = []
    for row in rows:
        if row["kind"] not in {"conversation.input", "conversation.response", "conversation.continuation"}:
            continue
        actor, payload = json.loads(row["actor_json"]), json.loads(row["payload_json"])
        text = payload["text"]
        if "content_ref" in payload:
            from gateway.hosted_room_conversation_content import read_owned_locked, validate_reference_locked
            validate_reference_locked(conn, conversation_id, payload["content_ref"], text=True)
            text = read_owned_locked(conn, conversation_id, payload["content_ref"]["id"]).decode("utf-8")
        if payload.get("content_status") == "unsupported":
            text = ""
        result.append(PublicMessage(
            event_id=row["event_id"], seq=row["seq"], author_id=actor["id"],
            author_label=payload.get("author_display_name_at_time", actor.get("display_name", actor["id"])),
            text=text, reply_to_event_id=payload.get("reply_to_event_id"),
        ))
    return tuple(result)


def _check_cutoff(conn, conversation_id: str, cutoff: int) -> None:
    if isinstance(cutoff, bool) or not isinstance(cutoff, int) or cutoff < 0:
        raise ValueError("input cutoff must be a non-negative integer")
    last_seq = conn.execute("SELECT next_seq-1 FROM hosted_rooms WHERE room_id=?", (conversation_id,)).fetchone()[0]
    if cutoff > last_seq:
        raise hosted_rooms.RoomConflictError("public history does not reach the requested cutoff")


def _coverage(conn, conversation_id: str, participant_id: str, generation: int,
              cutoff: int | None = None) -> ContextCoverage:
    rows = conn.execute("""SELECT a.source_ids_json, i.event_id
        FROM hosted_conversation_input_acks a
        JOIN hosted_room_conversation_inputs i
            ON i.conversation_id=a.conversation_id AND i.input_id=a.input_id
        WHERE a.conversation_id=? AND a.participant_id=? AND a.session_generation=?""",
        (conversation_id, participant_id, generation))
    received = set()
    for row in rows:
        received.update(json.loads(row["source_ids_json"]))
        received.add(row["event_id"])
    own = set()
    for row in conn.execute("""SELECT event_id, actor_json, payload_json FROM hosted_room_events
            WHERE room_id=? AND kind='conversation.response'""", (conversation_id,)):
        actor, payload = json.loads(row["actor_json"]), json.loads(row["payload_json"])
        if actor["id"] == participant_id and payload.get("session_generation") == generation:
            own.add(row["event_id"])
    summary = conn.execute("""SELECT text, through_seq, source_ids_json FROM hosted_conversation_summaries
        WHERE conversation_id=? AND participant_id=? AND session_generation=?
            AND (? IS NULL OR through_seq<=?)
        ORDER BY version DESC LIMIT 1""", (conversation_id, participant_id, generation, cutoff, cutoff)).fetchone()
    summary_ids = frozenset(json.loads(summary["source_ids_json"])) if summary else frozenset()
    # Consumed summaries remain durable evidence, but must not be injected a second time.
    usable = summary is not None and not summary_ids.intersection(received | own)
    return ContextCoverage(
        frozenset(received), frozenset(own), summary["text"] if usable else "",
        summary["through_seq"] if usable else 0, summary_ids if usable else frozenset(),
    )


class ConversationContextStoreMixin:
    """The existing ConversationStore owns these tables and its transaction boundary."""

    def public_history(self, conversation_id: str, input_cutoff: int) -> tuple[PublicMessage, ...]:
        with hosted_rooms._transaction(self.db_path) as conn:
            self._get_locked(conn, conversation_id)
            _check_cutoff(conn, conversation_id, input_cutoff)
            return _history(conn, conversation_id, input_cutoff)

    def context_coverage(self, binding: ParticipantBinding) -> ContextCoverage:
        with hosted_rooms._transaction(self.db_path) as conn:
            self._get_locked(conn, binding.conversation_id)
            return _coverage(conn, binding.conversation_id, binding.participant.participant_id,
                             binding.session_generation)

    def prepare_input(self, binding: ParticipantBinding, input_id: str, envelope: TurnEnvelope) -> TurnEnvelope:
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            return self._prepare_input_locked(conn, binding, input_id, envelope)

    def _prepare_input_locked(self, conn, binding: ParticipantBinding, input_id: str, envelope: TurnEnvelope) -> TurnEnvelope:
        encoded = json.dumps(asdict(envelope), sort_keys=True)
        identity = (binding.participant.participant_id, binding.session_generation, binding.lineage_id, encoded)
        self._get_locked(conn, binding.conversation_id)
        admitted = conn.execute("""SELECT participant_id, seq FROM hosted_room_conversation_inputs
            WHERE conversation_id=? AND input_id=?""", (binding.conversation_id, input_id)).fetchone()
        if (admitted is None or admitted["participant_id"] != identity[0]
                or envelope.through_seq >= admitted["seq"]):
            raise hosted_rooms.RoomConflictError("prepared context does not belong to this admitted input")
        existing = conn.execute("""SELECT participant_id, session_generation, lineage_id, envelope_json
            FROM hosted_conversation_prepared_inputs WHERE conversation_id=? AND input_id=?""",
            (binding.conversation_id, input_id)).fetchone()
        if existing is not None:
            if tuple(existing) != identity:
                raise hosted_rooms.RoomConflictError("admitted input context is already frozen")
            return envelope
        conn.execute("""INSERT INTO hosted_conversation_prepared_inputs VALUES (?, ?, ?, ?, ?, ?)""",
                     (binding.conversation_id, input_id, *identity))
        return envelope

    def prepared_input(self, conversation_id: str, input_id: str) -> TurnEnvelope | None:
        with hosted_rooms._transaction(self.db_path) as conn:
            self._get_locked(conn, conversation_id)
            row = conn.execute("""SELECT envelope_json FROM hosted_conversation_prepared_inputs
                WHERE conversation_id=? AND input_id=?""", (conversation_id, input_id)).fetchone()
            if row is None:
                return None
            payload = json.loads(row["envelope_json"])
            payload["source_event_ids"] = tuple(payload["source_event_ids"])
            return TurnEnvelope(**payload)

    def save_summary(self, conversation_id: str, expected_revision: int, text: str,
                     through_seq: int, source_ids: tuple[str, ...],
                     *, participant_id: str, session_generation: int) -> None:
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            record = self._get_locked(conn, conversation_id)
            if record.revision != expected_revision:
                raise hosted_rooms.RoomConflictError("conversation changed while summary was generated")
            current = _coverage(conn, conversation_id, participant_id, session_generation)
            proof = ContextCoverage(current.received_event_ids, current.own_event_ids,
                                    text, through_seq, frozenset(source_ids))
            _validate_summary(proof, eligible=_history(conn, conversation_id), input_cutoff=through_seq)
            conn.execute("""INSERT INTO hosted_conversation_summaries (
                conversation_id, participant_id, session_generation, version, text, through_seq, source_ids_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)""", (conversation_id, participant_id, session_generation,
                record.revision + 1, text, through_seq, json.dumps(sorted(source_ids))))
            conn.execute("UPDATE hosted_rooms SET revision=revision+1 WHERE room_id=?", (conversation_id,))

    def ack_input(self, conversation_id: str, participant_id: str, session_generation: int,
                  receipt: InputReceipt, source_event_ids: tuple[str, ...], through_seq: int) -> None:
        if not isinstance(receipt, InputReceipt):
            raise TypeError("context coverage requires a Profile input receipt")
        if (isinstance(session_generation, bool) or not isinstance(session_generation, int)
                or session_generation < 1):
            raise ValueError("session_generation must be a positive integer")
        receipt_data = asdict(receipt)
        receipt_data.pop("idempotent")
        receipt_json = json.dumps(receipt_data, sort_keys=True)
        source_ids = tuple(sorted(set(source_event_ids)))
        source_json = json.dumps(source_ids)
        with hosted_rooms._transaction(self.db_path, immediate=True) as conn:
            self._get_locked(conn, conversation_id)
            admission = conn.execute("""SELECT participant_id, seq FROM hosted_room_conversation_inputs
                WHERE conversation_id=? AND input_id=?""", (conversation_id, receipt.input_id)).fetchone()
            if admission is None or admission["participant_id"] != participant_id:
                raise hosted_rooms.RoomConflictError("receipt does not identify this participant's input")
            prepared = conn.execute("""SELECT participant_id, session_generation, envelope_json
                FROM hosted_conversation_prepared_inputs WHERE conversation_id=? AND input_id=?""",
                (conversation_id, receipt.input_id)).fetchone()
            envelope = json.loads(prepared["envelope_json"]) if prepared else {}
            if (prepared is None or prepared["participant_id"] != participant_id
                    or prepared["session_generation"] != session_generation
                    or envelope.get("input_digest") != receipt.input_digest
                    or tuple(sorted(envelope.get("source_event_ids", ()))) != source_ids
                    or envelope.get("through_seq") != through_seq):
                raise hosted_rooms.RoomConflictError("receipt does not match the frozen input context")
            old = conn.execute("""SELECT participant_id, session_generation, receipt_json,
                source_ids_json, through_seq FROM hosted_conversation_input_acks
                WHERE conversation_id=? AND input_id=?""", (conversation_id, receipt.input_id)).fetchone()
            identity = (participant_id, session_generation, receipt_json, source_json, through_seq)
            if old is not None:
                if tuple(old) != identity:
                    raise hosted_rooms.RoomConflictError("input acknowledgement conflicts with durable coverage")
                return
            history = {message.event_id: message for message in _history(conn, conversation_id, through_seq)}
            if (any(event_id not in history for event_id in source_ids)
                    or through_seq != max((history[event_id].seq for event_id in source_ids), default=0)
                    or through_seq >= admission["seq"]):
                raise hosted_rooms.RoomConflictError("input coverage is outside its frozen public history")
            conn.execute("""INSERT INTO hosted_conversation_input_acks (
                conversation_id, input_id, participant_id, session_generation, receipt_json,
                source_ids_json, through_seq) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (conversation_id, receipt.input_id, *identity))
            conn.execute("UPDATE hosted_rooms SET revision=revision+1 WHERE room_id=?", (conversation_id,))

    def context_snapshot(self, binding: ParticipantBinding, input_cutoff: int
                         ) -> tuple[ConversationRecord, tuple[PublicMessage, ...], ContextCoverage]:
        with hosted_rooms._transaction(self.db_path) as conn:
            # SELECT alone does not open a transaction; pin revision and coverage together.
            conn.execute("BEGIN")
            record = self._get_locked(conn, binding.conversation_id)
            _check_cutoff(conn, binding.conversation_id, input_cutoff)
            history = _history(conn, binding.conversation_id, input_cutoff)
            coverage = _coverage(conn, binding.conversation_id, binding.participant.participant_id,
                                 binding.session_generation, input_cutoff)
            return record, history, coverage

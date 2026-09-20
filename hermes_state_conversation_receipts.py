"""Atomic shared-conversation input admission for Profile SessionDB stores."""

from __future__ import annotations

from agent.conversation_maintenance import managed_session_call

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class InputReceipt:
    """Stable proof that one shared input owns one durable Profile message row."""

    input_id: str
    input_digest: str
    session_id: str
    message_row_id: int
    idempotent: bool


_RECEIPT_COLUMNS = """
    input_id, input_digest, message_digest, conversation_id, participant_id,
    session_generation, session_id, message_row_id
"""
_TRANSIENT_MESSAGE_FIELDS = frozenset({"_row_id", "_db_persisted"})


def _message_digest(message: Dict[str, Any]) -> str:
    """Hash the caller-visible payload independently from its supplied envelope digest."""
    # These in-memory persistence markers are never message columns. A replay after
    # the ordinary flush stamps them must still identify the same caller payload.
    payload = {key: value for key, value in message.items() if key not in _TRANSIENT_MESSAGE_FIELDS}
    try:
        canonical = json.dumps(
            payload,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("conversation input message must be JSON-serializable") from exc
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} must be a non-empty string")
    return value


class SessionConversationReceiptsMixin:
    """Persist shared inputs and their replay receipts in one Profile DB transaction."""

    @staticmethod
    def _input_receipt(row, *, idempotent: bool) -> InputReceipt:
        return InputReceipt(
            input_id=str(row["input_id"]),
            input_digest=str(row["input_digest"]),
            session_id=str(row["session_id"]),
            message_row_id=int(row["message_row_id"]),
            idempotent=idempotent,
        )

    def get_conversation_input_receipt(self, input_id: str) -> Optional[InputReceipt]:
        """Return the durable receipt for *input_id*, including archived compression ancestors."""
        if not input_id:
            return None
        row = self._read_one(
            f"SELECT {_RECEIPT_COLUMNS} FROM conversation_input_receipts WHERE input_id = ?",
            (input_id,),
        )
        return None if row is None else self._input_receipt(row, idempotent=True)

    @managed_session_call
    def recover_conversation_input_receipt(
        self, session_id: str, *, input_id: str, input_digest: str,
        conversation_id: str, participant_id: str, session_generation: int,
    ) -> Optional[InputReceipt]:
        """Recover by stable identity across compression without regenerating a row payload."""
        with self._read_ctx() as conn:
            row = conn.execute(
                f"SELECT {_RECEIPT_COLUMNS} FROM conversation_input_receipts WHERE input_id = ?",
                (input_id,),
            ).fetchone()
            if row is None:
                return None
            expected = (input_digest, conversation_id, participant_id, session_generation)
            actual = tuple(row[key] for key in (
                "input_digest", "conversation_id", "participant_id", "session_generation"))
            if expected != actual or self._session_turn_lease_key_on_conn(
                conn, session_id
            ) != self._session_turn_lease_key_on_conn(conn, row["session_id"]):
                raise ValueError(f"conversation input {input_id!r} conflicts with its durable receipt")
            return self._input_receipt(row, idempotent=True)

    @managed_session_call
    def accept_conversation_input(
        self,
        session_id: str,
        *,
        input_id: str,
        input_digest: str,
        message: dict,
        conversation_id: str,
        participant_id: str,
        session_generation: int,
    ) -> InputReceipt:
        """Atomically append one real user message and bind its stable input receipt.

        Replays may name a later compression segment, but every other identity field must
        match the original acceptance. A new input is admitted only while no turn or
        compression lease owns the transcript.
        """
        def _do(conn):
            return self._accept_conversation_input_on_conn(
                conn,
                session_id,
                input_id=input_id,
                input_digest=input_digest,
                message=message,
                conversation_id=conversation_id,
                participant_id=participant_id,
                session_generation=session_generation,
            )

        return self._execute_write(_do, patience_s=self._TRANSCRIPT_WRITE_PATIENCE_S)

    def _accept_conversation_input_on_conn(
        self,
        conn,
        session_id: str,
        *,
        input_id: str,
        input_digest: str,
        message: dict,
        conversation_id: str,
        participant_id: str,
        session_generation: int,
        compression_lock_holder: Optional[str] = None,
        turn_lease_holder: Optional[str] = None,
        turn_lease_ttl_seconds: float = 300.0,
    ) -> InputReceipt:
        """Transaction-owned form used when input admission joins another Profile flush."""
        session_id = _required_text(session_id, "session_id")
        input_id = _required_text(input_id, "input_id")
        input_digest = _required_text(input_digest, "input_digest")
        conversation_id = _required_text(conversation_id, "conversation_id")
        participant_id = _required_text(participant_id, "participant_id")
        if isinstance(session_generation, bool) or not isinstance(session_generation, int) or session_generation < 0:
            raise ValueError("session_generation must be a non-negative integer")
        if not isinstance(message, dict) or message.get("role") != "user":
            raise ValueError("conversation input message must have role='user'")

        message_copy = dict(message)
        payload_digest = _message_digest(message_copy)

        existing = conn.execute(
            f"SELECT {_RECEIPT_COLUMNS} FROM conversation_input_receipts WHERE input_id = ?",
            (input_id,),
        ).fetchone()
        if existing is not None:
            supplied_identity = (
                input_digest,
                payload_digest,
                conversation_id,
                participant_id,
                session_generation,
            )
            stored_identity = tuple(
                existing[key]
                for key in (
                    "input_digest",
                    "message_digest",
                    "conversation_id",
                    "participant_id",
                    "session_generation",
                )
            )
            same_lineage = self._session_turn_lease_key_on_conn(
                conn, session_id
            ) == self._session_turn_lease_key_on_conn(conn, existing["session_id"])
            if supplied_identity != stored_identity or not same_lineage:
                raise ValueError(f"conversation input {input_id!r} conflicts with its durable receipt")
            return self._input_receipt(existing, idempotent=True)

        self._check_transcript_write_guards(
            conn,
            session_id,
            compression_lock_holder,
            turn_lease_holder=turn_lease_holder,
            turn_lease_ttl_seconds=turn_lease_ttl_seconds,
            reject_active_turn_lease=True,
            reject_active_compression_lock=True,
        )
        inserted, tool_calls = self._insert_message_rows(conn, session_id, [message_copy])
        if inserted != 1 or message_copy.get("_row_id") is None:
            raise RuntimeError("conversation input did not produce one durable message row")
        message_row_id = int(message_copy["_row_id"])
        self._bump_session_counters(conn, session_id, 1, tool_calls, unit=True)
        conn.execute(
            """INSERT INTO conversation_input_receipts (
                   input_id, input_digest, message_digest, conversation_id,
                   participant_id, session_generation, session_id, message_row_id,
                   accepted_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                input_id,
                input_digest,
                payload_digest,
                conversation_id,
                participant_id,
                session_generation,
                session_id,
                message_row_id,
                time.time(),
            )
        )
        return InputReceipt(
            input_id=input_id,
            input_digest=input_digest,
            session_id=session_id,
            message_row_id=message_row_id,
            idempotent=False,
        )

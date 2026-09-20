"""Trusted, scoped shared-conversation admission; never populated from user message JSON."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from typing import Callable

from hermes_state_conversation_receipts import InputReceipt


@dataclass(frozen=True)
class ManagedConversationInput:
    input_id: str
    input_digest: str
    conversation_id: str
    participant_id: str
    session_generation: int

    def __post_init__(self):
        for field in ("input_id", "input_digest", "conversation_id", "participant_id"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value:
                raise ValueError(f"{field} must be a non-empty string")
        if isinstance(self.session_generation, bool) or not isinstance(self.session_generation, int) or self.session_generation < 0:
            raise ValueError("session_generation must be a non-negative integer")


class ConversationInputRecoveryRequired(RuntimeError):
    """Persistence succeeded previously; model/tool execution needs driver reconciliation."""

    def __init__(self, receipt: InputReceipt):
        super().__init__(f"Conversation input {receipt.input_id!r} is already durable; reconcile execution")
        self.receipt = receipt


@dataclass
class ConversationInputAdmission:
    identity: ManagedConversationInput
    on_persisted: Callable[[InputReceipt], None] | None = None
    message: dict | None = None
    receipt: InputReceipt | None = None
    ready: bool = False


def current_conversation_input(agent) -> ConversationInputAdmission | None:
    admission = getattr(agent, "_managed_conversation_input", None)
    if admission is not None and not isinstance(admission, ConversationInputAdmission):
        raise TypeError("managed conversation input must be a trusted admission context")
    return admission


@contextmanager
def managed_conversation_input(agent, identity: ManagedConversationInput, *, on_persisted=None):
    """Bind ONE synchronous turn; existing input IDs require recovery, never model replay.

    The receipt describes the original admitted row. Compression and the normal api_content
    backfill may subsequently change its active projection; recovery uses its stable input ID
    and execution identity, never a regenerated plugin sidecar or message-text comparison.
    """
    if not isinstance(identity, ManagedConversationInput):
        raise TypeError("identity must be ManagedConversationInput")
    from agent.session_persistence import _persist_lock
    with _persist_lock(agent):
        if current_conversation_input(agent) is not None:
            raise RuntimeError("managed conversation input is already bound")
        db = getattr(agent, "_session_db", None)
        if db is None or getattr(agent, "_persist_disabled", False):
            raise RuntimeError("managed conversation input requires Profile persistence")
        receipt = db.recover_conversation_input_receipt(agent.session_id, **vars(identity))
        if receipt is not None:
            raise ConversationInputRecoveryRequired(receipt)
        admission = ConversationInputAdmission(identity, on_persisted)
        agent._managed_conversation_input = admission
    try:
        yield admission
    finally:
        with _persist_lock(agent):
            if admission.receipt is None and admission.message is not None:
                # A later close safety-net must not append an input whose receipt transaction failed.
                messages = getattr(agent, "_session_messages", None)
                if isinstance(messages, list):
                    messages[:] = [message for message in messages if message is not admission.message]
                if getattr(agent, "_pending_cli_user_message", None) is admission.message:
                    agent._pending_cli_user_message = None
            agent._managed_conversation_input = None


def bind_conversation_input_message(agent, message: dict) -> None:
    admission = current_conversation_input(agent)
    if admission is None:
        return
    if admission.message is not None:
        raise RuntimeError("managed admission may run only one turn")
    if message.get("_db_persisted") or message.get("_row_id") is not None:
        raise RuntimeError("managed input cannot adopt an already persisted UI message")
    admission.message = message


def complete_conversation_input(agent) -> None:
    admission = current_conversation_input(agent)
    if admission is None:
        return
    if admission.receipt is None:
        raise RuntimeError("managed conversation input has no durable receipt")
    if not admission.ready:
        if admission.on_persisted is not None:
            admission.on_persisted(admission.receipt)
        admission.ready = True


def managed_compaction_rows(agent, messages: list) -> list:
    """Project the managed tail for a compression writer without changing live prompt bytes."""
    admission = current_conversation_input(agent)
    if admission is None:
        return messages
    if admission.receipt is None:
        raise RuntimeError("compression cannot materialize an unreceipted managed input")
    from agent.turn_context import reanchor_current_turn_user_idx
    from agent.session_persistence import _db_flush_row
    index = reanchor_current_turn_user_idx(messages, admission.message["content"])
    if not 0 <= index < len(messages):
        raise RuntimeError("compression lost the managed current user anchor")
    rows = list(messages)
    rows[index] = _db_flush_row(agent, messages[index], True)
    return rows


def sync_managed_compaction_rows(agent, messages: list, rows: list) -> None:
    if current_conversation_input(agent) is not None:
        from agent.transcript_repair import sync_flushed_message_markers
        sync_flushed_message_markers(messages, rows)

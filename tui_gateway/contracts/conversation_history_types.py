from typing import Literal
from .base import Result


class ConversationHistoryDraft(Result):
    input_id: str
    turn_id: str
    participant_id: str
    text: str
    attachment_ids: list[str]
    source_event_id: str


class ConversationBranchReceipt(Result):
    operation_id: str
    conversation_id: str
    source_conversation_id: str
    source_event_id: str
    source_revision: int
    source_cutoff_seq: int
    kind: Literal['branch', 'edit']
    draft: ConversationHistoryDraft | None = None
    draft_pending: bool
    draft_cancelled: bool = False


class ConversationEventProvenance(Result):
    conversation_id: str
    event_id: str
    seq: int
    payload_sha256: str

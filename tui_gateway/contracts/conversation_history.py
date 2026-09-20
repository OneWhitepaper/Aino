"""Immutable public history operations; private participant transcripts are never rewritten."""
from pydantic import Field
from .conversation_history_types import ConversationBranchReceipt

from .base import Params, Result
from .conversations import ConversationAdmission, ConversationRecord
from .registry import method


class ConversationBranchParams(Params):
    conversation_id: str
    source_event_id: str
    expected_revision: int = Field(ge=1)
    target_conversation_id: str
    operation_id: str
    edit_text: str | None = None


class ConversationBranchResult(Result):
    conversation: ConversationRecord
    branch: ConversationBranchReceipt


class ConversationRegenerateParams(Params):
    conversation_id: str
    source_event_id: str
    expected_revision: int = Field(ge=1)
    input_id: str
    turn_id: str


class ConversationRegenerateResult(Result):
    admission: ConversationAdmission
    regenerates_event_id: str


class ConversationReaction(Result):
    emoji: str
    author: str
    at: float


class ConversationReactionState(Result):
    event_id: str
    revision: int
    reactions: list[ConversationReaction]


class ConversationReactParams(Params):
    conversation_id: str
    event_id: str
    operation_id: str
    emoji: str | None = Field(default=None, max_length=32)
    expected_reaction_revision: int = Field(ge=0)


class ConversationReactResult(Result):
    reaction: ConversationReactionState


class ConversationReactionsParams(Params):
    conversation_id: str
    event_ids: list[str] = Field(max_length=200)


class ConversationReactionsResult(Result):
    reactions: list[ConversationReactionState]


method('conversations.branch', params=ConversationBranchParams, result=ConversationBranchResult,
       doc='Snapshot owned idle public history into a new conversation; edits return a durable unsent draft for normal preparation and sending.')
method('conversations.regenerate', params=ConversationRegenerateParams, result=ConversationRegenerateResult,
       doc='Intentionally admit a new answer attempt related to a settled public result; this never retries uncertain work.')
method('conversations.react', params=ConversationReactParams, result=ConversationReactResult,
       doc='Set or clear the owner reaction on one public event without rewriting its bytes.')
method('conversations.reactions', params=ConversationReactionsParams, result=ConversationReactionsResult,
       doc='Read owner-scoped reaction metadata for exact public event identities.')


class ConversationCancelDraftParams(Params):
    conversation_id: str
    input_id: str
    operation_id: str
    expected_revision: int = Field(ge=1)


class ConversationCancelDraftResult(Result):
    conversation: ConversationRecord


method('conversations.cancel_draft', params=ConversationCancelDraftParams, result=ConversationCancelDraftResult,
       doc='Cancel the exact unsent edited draft with owner and revision checks; copied public history remains immutable.')

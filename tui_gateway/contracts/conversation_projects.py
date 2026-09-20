"""Explicit project changes create new participant generations at a safe boundary."""
from pydantic import Field

from .base import Params, Result
from .conversations import ConversationParticipantBinding, ConversationProjectRef, ConversationRecord
from .registry import method


class ConversationSetProjectParams(Params):
    conversation_id: str
    project_ref: ConversationProjectRef | None
    expected_revision: int = Field(ge=1)


class ConversationSetProjectResult(Result):
    conversation: ConversationRecord
    participants: list[ConversationParticipantBinding]


method('conversations.set_project', params=ConversationSetProjectParams, result=ConversationSetProjectResult,
       doc='Change the project and explicitly advance idle participant generations without altering public history.')

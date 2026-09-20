"""Private notices never become public conversation inputs or transcript events."""
from typing import Annotated, Literal

from pydantic import Field, RootModel

from .base import Params, Result
from .registry import method


class ConversationCommandParams(Params):
    conversation_id: str
    participant_id: str
    expected_generation: int = Field(ge=1)
    expected_revision: int = Field(ge=1)
    command: str = Field(min_length=1, max_length=4096)


class ConversationCommandNotice(Result):
    type: Literal['notice']
    scope: Literal['private']
    output: str
    conversation_id: str
    participant_id: str
    session_generation: int
    conversation_revision: int
    runtime_id: str


class ConversationCommandSend(Result):
    type: Literal['send']
    command_token: str
    display: str
    conversation_id: str
    participant_id: str
    session_generation: int
    conversation_revision: int
    runtime_id: str


class ConversationCommandResult(RootModel[Annotated[
        ConversationCommandNotice | ConversationCommandSend, Field(discriminator='type')]]):
    pass


method('conversations.command', params=ConversationCommandParams, result=ConversationCommandResult,
       doc='Read a private notice from the selected owned participant generation without admitting a turn.')

"""Coordinates added to existing session event and request envelopes; never an authority token."""
from .base import Result


class ConversationActivityCoordinates(Result):
    conversation_id: str
    turn_id: str
    participant_id: str
    session_generation: int
    task_id: str
    execution_generation: int
    runtime_id: str

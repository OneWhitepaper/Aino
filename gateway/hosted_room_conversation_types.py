"""Immutable public records for ordinary multi-participant conversations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from gateway.hosted_room_driver import TaskIdentity
    from gateway.hosted_room_conversation_context import TurnEnvelope


@dataclass(frozen=True)
class ParticipantRef:
    participant_id: str
    install_id: str
    profile: str
    display_name: str
    is_general: bool = False


@dataclass(frozen=True)
class ProjectRef:
    install_id: str
    registration_profile: str
    project_id: str
    cwd: str
    execution_environment_id: str


@dataclass(frozen=True)
class TurnSubmission:
    turn_id: str
    input_id: str
    participant_id: str
    text: str
    attachment_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class ConversationRecord:
    conversation_id: str
    title: str
    general: ParticipantRef
    project: ProjectRef | None
    revision: int
    archived: bool


@dataclass(frozen=True)
class ParticipantBinding:
    conversation_id: str
    participant: ParticipantRef
    session_generation: int
    lineage_id: str | None


@dataclass(frozen=True)
class Admission:
    conversation_id: str
    turn_id: str
    input_id: str
    event_id: str
    seq: int
    participant_id: str
    idempotent: bool


@dataclass(frozen=True)
class EventPage:
    events: tuple[dict[str, Any], ...]
    cursor: int
    has_more: bool


@dataclass(frozen=True)
class ConversationTurnPlan:
    identity: TaskIdentity
    payload: dict[str, Any]
    binding: ParticipantBinding
    envelope: TurnEnvelope

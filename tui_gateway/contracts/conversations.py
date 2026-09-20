"""Ordinary public conversations, addressed independently from Profile runtime sessions."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .base import JsonValue, Params, Result, WireEnum
from .registry import method


class ConversationParticipantRef(Result):
    participant_id: str
    install_id: str
    profile: str
    display_name: str
    is_general: bool = False


class ConversationProjectRef(Params):
    install_id: str
    registration_profile: str
    project_id: str
    cwd: str
    execution_environment_id: str


class MigrationReceipt(Result):
    migration_id: str
    conversation_id: str
    source_profile: str
    source_lineage_id: str
    source_cutoff_row_id: int
    status: Literal['preparing', 'importing', 'complete', 'failed']
    source_session_ids: list[str] = Field(default_factory=list)


class ConversationAdoptParams(Params):
    source_profile: str
    lineage_id: str
    conversation_id: str
    input_id: str


class ConversationAdoptResult(Result):
    migration: MigrationReceipt


method('conversations.adopt', params=ConversationAdoptParams, result=ConversationAdoptResult,
       doc='Adopt owned quiescent legacy public history with a permanent source execution fence.')


from .conversation_history_types import ConversationBranchReceipt, ConversationEventProvenance


class ConversationRecord(Result):
    branch: ConversationBranchReceipt | None = None
    migration: MigrationReceipt | None = None
    conversation_id: str
    title: str
    general: ConversationParticipantRef
    project: ConversationProjectRef | None
    revision: int
    archived: bool


class ConversationParticipantBinding(Result):
    conversation_id: str
    participant: ConversationParticipantRef
    session_generation: int
    lineage_id: str | None


class ConversationCatalogEntry(Result):
    participant: ConversationParticipantRef
    available: bool
    reason: str | None = None


class ConversationCatalogResult(Result):
    participants: list[ConversationCatalogEntry]


class ConversationCapabilities(Result):
    scoped_commands: bool = False
    supported_read_commands: list[str] = Field(default_factory=list)
    max_attachment_bytes: int | None = Field(default=None, ge=1)
    max_attachments: int | None = Field(default=None, ge=1)
    protocol_version: int
    enabled: bool
    reason: str | None = None
    supported_execution_environments: list[str]


class ConversationCreateParams(Params):
    auto_title: bool = False
    conversation_id: str
    title: str
    general_participant_id: str
    project_ref: ConversationProjectRef | None = None


class ConversationResult(Result):
    conversation: ConversationRecord


class ConversationParams(Params):
    conversation_id: str


class ConversationListParams(Params):
    cursor: str | None = None
    limit: int = Field(default=100, ge=1, le=200)
    project_ref: ConversationProjectRef | None = None
    include_archived: bool = False


class ConversationListResult(Result):
    conversations: list[ConversationRecord]
    cursor: str | None
    has_more: bool


class ConversationRunStatus(WireEnum):
    queued = "queued"
    running = "running"
    stopping = "stopping"
    settled = "settled"
    failed = "failed"
    cancelled = "cancelled"
    indeterminate = "indeterminate"
    deferred = "deferred"


class ConversationTurn(Result):
    turn_id: str
    input_id: str
    participant_id: str
    session_generation: int
    task_id: str
    execution_generation: int
    status: ConversationRunStatus
    runtime_id: str | None = None


class ConversationDelegation(Result):
    delegation_id: str
    origin_turn_id: str
    participant_id: str
    session_generation: int
    status: str


class ConversationGetResult(ConversationResult):
    migration: MigrationReceipt | None = None
    participants: list[ConversationParticipantBinding]
    active_turn: ConversationTurn | None
    pending_delegations: list[ConversationDelegation]


class ConversationSendParams(ConversationParams):
    turn_id: str
    input_id: str
    participant_id: str
    text: str
    attachment_ids: list[str] = Field(default_factory=list)
    command_token: str | None = None
    surface: Literal["voice-live"] | None = None
    voice_context: str | None = Field(default=None, max_length=6000)
    expected_revision: int


class ConversationAdmission(Result):
    conversation_id: str
    turn_id: str
    input_id: str
    event_id: str
    seq: int
    participant_id: str
    idempotent: bool


class ConversationAdmissionResult(Result):
    admission: ConversationAdmission


class ConversationEventsParams(ConversationParams):
    after_seq: int = Field(default=0, ge=0)
    limit: int = Field(default=100, ge=1, le=200)


class ConversationActor(Result):
    kind: str
    id: str
    display_name: str | None = None


class ConversationEvent(Result):
    provenance: ConversationEventProvenance | None = None
    room_id: str
    seq: int
    event_id: str
    kind: str
    actor: ConversationActor
    authority_epoch: int
    payload: dict[str, JsonValue]
    created_at: float
    idempotent: bool = False


class ConversationEventsResult(Result):
    events: list[ConversationEvent]
    cursor: int
    has_more: bool


class ConversationStopParams(ConversationParams):
    turn_id: str
    execution_generation: int
    include_delegations: bool = False


class ConversationStopStatus(WireEnum):
    requested = "requested"
    confirmed = "confirmed"
    not_found = "not_found"


class ConversationStopResult(Result):
    status: ConversationStopStatus


class ConversationRetryParams(ConversationParams):
    turn_id: str
    input_id: str
    expected_generation: int


class ConversationRefreshParams(ConversationParams):
    reasoning_effort: str | None = None
    fast: bool | None = None
    participant_id: str
    expected_generation: int = Field(ge=1)
    model_source: Literal['aino', 'byok'] | None = None
    model_id: str | None = None


class ConversationRefreshResult(Result):
    binding: ConversationParticipantBinding
    preparation: ConversationModelPreparation


class ConversationPrepareParams(ConversationParams):
    reasoning_effort: str | None = None
    fast: bool | None = None
    participant_id: str
    expected_revision: int | None = Field(default=None, ge=1)
    expected_generation: int = Field(default=1, ge=1)
    model_source: Literal["aino", "byok"] | None = None
    model_id: str | None = None


class ConversationModelPreparation(Result):
    session_id: str
    stored_session_id: str
    profile: str
    session_generation: int
    model_status: str
    runtime_config: dict[str, JsonValue] = Field(alias="model_config")


class ConversationPrepareResult(ConversationModelPreparation):
    previous_revision: int
    conversation_revision: int


method("conversations.prepare", params=ConversationPrepareParams, result=ConversationPrepareResult,
       doc="Prepare the exact participant session for ordinary authenticated model binding before sending.")


method("conversations.capabilities", params=Params, result=ConversationCapabilities,
       doc="Report verified ordinary-conversation topology and rollout availability.")
method("conversations.participants", params=Params, result=ConversationCatalogResult,
       doc="List gateway-resolved participant identities and execution availability.")
method("conversations.create", params=ConversationCreateParams, result=ConversationResult,
       doc="Create one public conversation with a fixed general assistant identity.")
method("conversations.list", params=ConversationListParams, result=ConversationListResult,
       doc="List ordinary conversations independently from the selected Profile.")
method("conversations.get", params=ConversationParams, result=ConversationGetResult,
       doc="Read public conversation identity, participants and outstanding work.")
method("conversations.send", params=ConversationSendParams, result=ConversationAdmissionResult,
       doc="Admit one immutable user input for the selected participant.")
method("conversations.events", params=ConversationEventsParams, result=ConversationEventsResult,
       doc="Replay a page of durable public conversation events.")
method("conversations.stop", params=ConversationStopParams, result=ConversationStopResult,
       doc="Stop the exact execution generation and optionally its owned delegations.")
method("conversations.retry", params=ConversationRetryParams, result=ConversationAdmissionResult,
       doc="Reconcile an admitted input; uncertain execution is never blindly replayed.")
method("conversations.refresh", params=ConversationRefreshParams, result=ConversationRefreshResult,
       doc="Explicitly start a new participant generation from current Profile configuration.")


from .conversation_activity import ConversationActivityCoordinates  # noqa: E402
from .profiles_vault_complete_foreign_subagents import SubagentSnapshot  # noqa: E402
from .sessions import OpenRequestEntry  # noqa: E402


class ConversationRuntimeSnapshotParams(ConversationParams):
    participant_id: str
    session_generation: int = Field(ge=1)


class ConversationOptionCapabilities(Result):
    reasoning: bool | None = None
    fast: bool | None = None
    can_disable_reasoning: bool | None = None


class ConversationModelSnapshot(Result):
    capabilities: ConversationOptionCapabilities | None = None
    reasoning_effort: str | None = None
    fast: bool = False
    model: str
    provider: str | None
    model_source: str | None
    model_id: str | None


class ConversationRuntimeSnapshotResult(Result):
    model_snapshot: ConversationModelSnapshot | None = None
    available: bool
    runtime_id: str | None
    subagents: list[SubagentSnapshot]
    open_requests: list[OpenRequestEntry]
    activity: ConversationActivityCoordinates | None
    background_activities: list[ConversationActivityCoordinates]


method('conversations.runtime_snapshot', params=ConversationRuntimeSnapshotParams,
       result=ConversationRuntimeSnapshotResult,
       doc='Reattach an existing participant generation and replay its exact live child/request ownership.')


class ConversationArchiveParams(ConversationParams):
    expected_revision: int = Field(ge=1)


class ConversationRenameParams(ConversationArchiveParams):
    title: str


method('conversations.archive', params=ConversationArchiveParams, result=ConversationResult,
       doc='Archive an owned idle conversation without deleting any public history.')
method('conversations.rename', params=ConversationRenameParams, result=ConversationResult,
       doc='Set an owned conversation title with revision and manual-title authority.')


class ConversationExportCursor(Params):
    revision: int = Field(ge=1)
    cutoff: int = Field(ge=0)
    phase: Literal['events', 'content']
    after_seq: int = Field(ge=0)
    content_index: int = Field(ge=0)
    offset_bytes: int = Field(ge=0)


class ConversationExportParams(ConversationParams):
    cursor: ConversationExportCursor | None = None


class ConversationExportResult(Result):
    filename: str | None
    chunk: str
    cursor: ConversationExportCursor | None


method('conversations.export', params=ConversationExportParams, result=ConversationExportResult,
       doc='Download bounded segments of an owned public JSON package with full referenced content and attachments.')

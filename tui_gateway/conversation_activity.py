"""Immutable origin for turn events and human requests, including copied child contexts."""
from __future__ import annotations

from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from gateway.hosted_room_driver import TaskAttempt


@dataclass(frozen=True)
class ConversationActivity:
    conversation_id: str
    turn_id: str
    participant_id: str
    session_generation: int
    task_id: str
    execution_generation: int
    runtime_id: str


_origin: ContextVar[ConversationActivity | None] = ContextVar("conversation_activity_origin", default=None)
_attempt: ContextVar[TaskAttempt | None] = ContextVar("conversation_activity_attempt", default=None)


def capture_conversation_activity(runtime_id: str, session: Mapping) -> ConversationActivity | None:
    binding = session.get("_conversation_binding")
    if not binding:
        return None
    task = session.get("_hosted_room_task")
    if not task:
        return None
    if (task["room_id"], task["member_id"]) != (binding["conversation_id"], binding["participant_id"]):
        raise ValueError("conversation activity does not match its participant binding")
    return ConversationActivity(binding["conversation_id"], task["turn_id"], binding["participant_id"],
        binding["session_generation"], task["task_id"], task["execution_generation"], runtime_id)


@contextmanager
def conversation_activity_scope(origin: ConversationActivity | None, attempt: TaskAttempt | None = None):
    token = _origin.set(origin)
    attempt_token = _attempt.set(attempt)
    try:
        yield
    finally:
        _attempt.reset(attempt_token)
        _origin.reset(token)


def current_conversation_activity(runtime_id: str) -> dict | None:
    origin = _origin.get()
    return asdict(origin) if origin is not None and origin.runtime_id == runtime_id else None


def current_conversation_attempt() -> TaskAttempt | None:
    """The immutable execution proof captured before nested background delegates were dispatched."""
    return _attempt.get()


def attach_conversation_activity(frame: dict) -> None:
    """Tag before replay stamping; never infer a late callback's origin from live session state."""
    if frame.get("method") != "event":
        return
    params = frame.get("params")
    if not isinstance(params, dict) or "conversation" in params:
        return
    origin = current_conversation_activity(str(params.get("session_id") or ""))
    if origin is not None:
        params["conversation"] = origin


def authorize_conversation_response(request, server) -> bool:
    """Public coordinates route the card; only its attached authenticated runtime may answer it."""
    session = server._sessions.get(request.sid)
    transport = server.current_transport()
    metadata = (session or {}).get("_conversation_binding")
    origin = request.params.get("conversation")
    if not metadata and not origin:
        return True
    if not metadata or not server._session_transport_contains(session, transport):
        return False
    from tui_gateway.conversation_authority import request_owner_key
    from gateway.hosted_room_conversation_owners import ConversationOwnershipError, owner_key
    try:
        actual_owner = request_owner_key(server, write=True, transport=transport)
    except ConversationOwnershipError:
        return False
    if owner_key(metadata.get("auth_user_id")) != actual_owner:
        return False
    return origin is None or (
        origin["runtime_id"] == request.sid
        and all(origin[key] == metadata[key] for key in (
            "conversation_id", "participant_id", "session_generation")))

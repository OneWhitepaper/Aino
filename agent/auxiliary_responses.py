"""Responses result normalization for auxiliary chat-completion consumers."""

from types import SimpleNamespace
from typing import Any, Callable, List, Tuple


def consume_auxiliary_responses(event_stream: Any, *, model: str, on_event: Callable) -> Any:
    """Retain wire completion evidence instead of the shared assembler's optimistic default."""
    from agent.auxiliary_client import _field
    from agent.codex_runtime import _consume_codex_event_stream

    status = incomplete_details = None

    def observe(event: Any) -> None:
        nonlocal status, incomplete_details
        on_event(event)
        if _field(event, "type") in {"response.completed", "response.incomplete", "response.failed"}:
            response = _field(event, "response")
            status = _field(response, "status")
            incomplete_details = _field(response, "incomplete_details")

    final = _consume_codex_event_stream(event_stream, model=model, on_event=observe)
    if final is not None:
        final.status = status
        final.incomplete_details = incomplete_details
    return final


def _parse_codex_final_response(final: Any) -> Tuple[List[str], List[Any], Any]:
    """Split a Responses object into (text_parts, tool_calls, usage) in chat.completions shape."""
    from agent.auxiliary_client import _field

    text_parts: List[str] = []
    tool_calls_raw: List[Any] = []
    for item in (getattr(final, "output", None) or []):
        item_type = _field(item, "type")
        if item_type == "message":
            for part in (_field(item, "content") or []):
                if _field(part, "type") in {"output_text", "text"}:
                    text_parts.append(_field(part, "text", ""))
        elif item_type == "function_call":
            tool_calls_raw.append(SimpleNamespace(
                id=_field(item, "call_id", ""), type="function",
                function=SimpleNamespace(
                    name=_field(item, "name", ""), arguments=_field(item, "arguments", "{}"))))
    usage = None
    resp_usage = getattr(final, "usage", None)
    if resp_usage:
        def _u(key: str) -> int:
            return getattr(resp_usage, key, 0) or (resp_usage.get(key, 0) if isinstance(resp_usage, dict) else 0)
        usage = SimpleNamespace(
            prompt_tokens=_u("input_tokens"), completion_tokens=_u("output_tokens"),
            total_tokens=_u("total_tokens"))
    return text_parts, tool_calls_raw, usage


def normalize_auxiliary_response(final: Any, model: str) -> Any:
    """Keep the auxiliary chat-completion result shape independent of transport."""
    from agent.auxiliary_client import _field

    text_parts, tool_calls_raw, usage = _parse_codex_final_response(final)
    status = str(_field(final, "status", "")).strip().lower()
    if status == "completed":
        finish_reason = "tool_calls" if tool_calls_raw else "stop"
    elif status == "incomplete":
        reason = str(_field(_field(final, "incomplete_details"), "reason", "")).strip().lower()
        finish_reason = {"max_output_tokens": "length", "content_filter": "content_filter"}.get(reason, "incomplete")
    else:
        finish_reason = {
            "failed": "error", "cancelled": "cancelled", "in_progress": "in_progress", "queued": "queued",
        }.get(status, "unknown")
    message = SimpleNamespace(
        role="assistant", content="".join(text_parts).strip() or None,
        tool_calls=tool_calls_raw or None,
    )
    choice = SimpleNamespace(
        index=0, message=message, finish_reason=finish_reason
    )
    return SimpleNamespace(choices=[choice], model=model, usage=usage)

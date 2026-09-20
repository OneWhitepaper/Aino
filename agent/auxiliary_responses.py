"""Responses result normalization for auxiliary chat-completion consumers."""

from types import SimpleNamespace
from typing import Any, List, Tuple


def _parse_codex_final_response(final: Any) -> Tuple[List[str], List[Any], Any]:
    """Split a completed Responses object into (text_parts, tool_calls, usage) in chat.completions shape."""
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
    text_parts, tool_calls_raw, usage = _parse_codex_final_response(final)
    # Shape the result like chat.completions.
    message = SimpleNamespace(
        role="assistant", content="".join(text_parts).strip() or None,
        tool_calls=tool_calls_raw or None,
    )
    choice = SimpleNamespace(
        index=0, message=message, finish_reason="stop" if not tool_calls_raw else "tool_calls"
    )
    return SimpleNamespace(choices=[choice], model=model, usage=usage)

"""Client-facing projection helpers for model-only compaction carriers."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from agent.context_compressor import (
    ContextCompressor,
    _INFLIGHT_TASK_REPLAY_HEADER,
    is_compaction_summary_message,
)


_COMPACTION_INTERNAL_FIELDS = (
    "tool_calls",
    "finish_reason",
    "reasoning",
    # Provider replay/metadata fields that ride the wire on every request but are invisible to
    # ``msg["content"]``/``msg["tool_calls"]`` accounting. Codex Responses sessions in particular carry
    # ``codex_reasoning_items`` blobs of ``encrypted_content`` that can dominate the serialized session (a
    # measured 214-turn session held ~115K tokens / 27% of its payload there — #55572).
    # ``reasoning_details`` is handled separately (see ``_reasoning_details_text_chars``): its signed/base64
    # envelope is excluded from the budget, mirroring the preflight estimator's exclusion in
    # ``model_metadata._estimate_message_tokens_without_images`` (#73298).
    # An assistant turn may carry only reasoning/thinking content with no visible text (extended-thinking
    # turns, thinking-only recovery responses). Such a turn is persisted with its reasoning fields and is
    # recallable from the transcript, but dropping it here as "empty" makes it vanish from the
    # resumed/reloaded session view while the desktop's reasoning disclosure has nothing to render. Keep it
    # when it carries reasoning so the "Thinking…" block still shows. (#44022)
    "reasoning_content",
    "reasoning_details",
    "codex_reasoning_items",
    "codex_message_items",
)


def _replayed_user_content(content: Any) -> Any:
    """Undo only the producer's leading replay header; preserve multimodal parts."""
    parts = content if isinstance(content, list) else [content]
    for index, part in enumerate(parts):
        text = part.get("text") if isinstance(part, dict) else part
        if not isinstance(text, str) or not text.strip():
            continue
        if not text.lstrip().startswith(_INFLIGHT_TASK_REPLAY_HEADER):
            return None
        remainder = text.lstrip()[len(_INFLIGHT_TASK_REPLAY_HEADER):].lstrip()
        if not isinstance(content, list):
            return remainder or None
        kept = [{**part, "text": remainder} if isinstance(part, dict) else remainder] if remainder else []
        return [*parts[:index], *kept, *parts[index + 1:]] or None
    return None


def project_compaction_message_for_display(
    message: Dict[str, Any], *,
    prior_user_match: Optional[Callable[[Dict[str, Any], Any, Optional[float]], bool]] = None,
) -> Optional[Dict[str, Any]]:
    """Return authentic transcript content, or ``None`` for a pure handoff.

    Model-facing recovery history retains the complete carrier. Display
    projections instead remove the handoff, inherited tool state, and internal
    reasoning while preserving any real prior-tail content or live user ask
    embedded in the carrier.
    """
    if not isinstance(message, dict):
        return None
    metadata = message.get("display_metadata")
    replay = isinstance(metadata, dict) and metadata.get("compaction_replay") is True
    summary = is_compaction_summary_message(message)
    if replay and not summary:
        return None
    projected = ContextCompressor._strip_context_summary_handoff_message(message) if summary else message.copy()
    if projected is None:
        return None

    # The delimiter layout unwraps PRIOR content, never the replay suffix. Its
    # real text may itself quote the internal header while reporting a bug.
    prior_tail = summary and ContextCompressor.classify_summary_content(message.get("content")) == "merged"
    original = (_replayed_user_content(projected.get("content"))
                if projected.get("role") == "user" and not prior_tail else None)
    if original is not None:
        if replay:
            return None
        # Old rows need corroborating human content. Standalone copies retain
        # the original timestamp; a later person quoting the header does not.
        timestamp = None if summary else message.get("timestamp")
        if prior_user_match and (summary or isinstance(timestamp, (int, float))):
            if prior_user_match(message, original, timestamp):
                return None

    if not summary:
        return projected

    projected = projected.copy()
    for key in _COMPACTION_INTERNAL_FIELDS:
        projected.pop(key, None)
    projected.pop("display_kind", None)
    if replay:
        # A merged carrier can also preserve real prior-tail content. Only the
        # replay suffix is synthetic; its metadata must not taint that content.
        remaining = {key: value for key, value in metadata.items() if key != "compaction_replay"}
        if remaining:
            projected["display_metadata"] = remaining
        else:
            projected.pop("display_metadata", None)
    return projected

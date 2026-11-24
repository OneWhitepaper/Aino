"""Per-reply diagnostics, persisted only as display metadata."""

from agent.agent_init_session import agent_interface
from contextlib import nullcontext
from dataclasses import dataclass
import logging
import math
import time

logger = logging.getLogger(__name__)

_COUNTERS = (
    "_api_usage_calls", "_api_usage_duration_s", "_api_usage_output_tokens",
    "session_total_tokens", "session_prompt_tokens", "session_output_tokens",
    "session_cache_read_tokens",
)


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _counters(agent):
    return {key: value if _number(value := getattr(agent, key, 0)) else 0 for key in _COUNTERS}


@dataclass
class TurnMetricsStart:
    counters: dict
    monotonic: float
    session_elapsed_s: float | None
    after_row_id: int
    history_length: int


def begin_turn_metrics(agent, session, *, now=None, monotonic=None):
    now = time.time() if now is None else now
    started = session.get("created_at")
    db = getattr(agent, "_session_db", None)
    boundary = 0
    if db is not None:
        try:
            store = agent_interface(agent)
            latest = store.messages.latest_row_id if store is not None else db.latest_message_row_id
            boundary = latest(agent.session_id, role="assistant", require_text=False) or 0
        except Exception:
            logger.debug("reply metrics row boundary unavailable", exc_info=True)
            boundary = -1  # A failed read must not authorize an unbounded write.
    return TurnMetricsStart(
        _counters(agent), time.monotonic() if monotonic is None else monotonic,
        max(0, now - started) if _number(started) and started > 0 else None,
        boundary, len(session.get("history", [])),
    )


def finish_turn_metrics(agent, session, start, usage, text, *, persist, monotonic=None, on_billing_update=None):
    duration = max(0, (time.monotonic() if monotonic is None else monotonic) - start.monotonic)
    metrics = {"duration_s": round(duration, 3)}
    if start.session_elapsed_s is not None:
        metrics["session_elapsed_s"] = round(start.session_elapsed_s + duration, 3)
    delta = {key: value - start.counters[key] for key, value in _counters(agent).items()}
    if delta["_api_usage_calls"] > 0 or delta["session_total_tokens"] > 0:
        for field, counter in (("total_tokens", "session_total_tokens"),
                               ("input_tokens", "session_prompt_tokens"),
                               ("output_tokens", "session_output_tokens")):
            if delta[counter] >= 0:
                metrics[field] = delta[counter]
        api_time = delta["_api_usage_duration_s"]
        if api_time > 0:
            metrics["tokens_per_second"] = round(delta["_api_usage_output_tokens"] / api_time, 2)
        prompt, cached = delta["session_prompt_tokens"], delta["session_cache_read_tokens"]
        # A normalized zero also means "provider omitted cache usage"; do not
        # invent a measured miss rate for those providers.
        if prompt > 0 and cached > 0:
            metrics["cache_hit_pct"] = round(min(100, 100 * cached / prompt), 2)
    for key in ("context_percent", "context_used", "context_max"):
        if _number(value := usage.get(key)) and value >= 0:
            metrics[key] = value
    if "context_percent" in metrics and isinstance(usage.get("context_estimated"), bool):
        metrics["context_estimated"] = usage["context_estimated"]
    from tui_gateway.managed_model_usage import current_usage_metadata
    if current_usage_metadata().get("non_aino_model_calls") is True:
        metrics["non_aino_model_calls"] = True
    from tui_gateway.managed_usage_display import finish_managed_metrics
    if managed := finish_managed_metrics(agent, session, start, text, metrics,
                                          persist=persist, on_update=on_billing_update):
        return managed
    if persist and text:
        _persist_metrics(agent, session, start, text, metrics)
    return metrics


def _persist_metrics(agent, session, start, text, metrics):
    metadata = {"turn_metrics": metrics}
    # The finalizer persists before output hooks add notes or transform the
    # visible answer. The committed transcript is the row's source of truth.
    with session.get("history_lock", nullcontext()):
        for message in reversed(session.get("history", [])):
            if message.get("role") == "user":
                break
            if (message.get("role") == "assistant" and message.get("content")
                    and not message.get("tool_calls") and message.get("display_kind") != "hidden"):
                text = message["content"]
                break
    db = getattr(agent, "_session_db", None)
    if db is not None and start.after_row_id >= 0:
        try:
            store = agent_interface(agent)
            merge = store.messages.merge_reply_display_metadata if store is not None else db.merge_reply_display_metadata
            if not merge(
                    agent.session_id, text, after_row_id=start.after_row_id, metadata=metadata):
                return
        except Exception:
            # Diagnostics must not turn an already-delivered answer into a failed turn.
            logger.warning("could not persist reply metrics", exc_info=True)
    with session.get("history_lock", nullcontext()):
        history = session.get("history", [])
        if db is None and len(history) <= start.history_length:
            return
        for index in range(len(history) - 1, -1, -1):
            message = history[index]
            if message.get("role") == "user":
                break
            if message.get("role") == "assistant" and message.get("content") == text:
                session["history"] = [*history[:index], {
                    **message, "display_metadata": {**(message.get("display_metadata") or {}), **metadata},
                }, *history[index + 1:]]
                break
    return text

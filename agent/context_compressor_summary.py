"""Summary rendering, hook dispatch, and cancellation rollback for context compression."""

from __future__ import annotations

import inspect
from typing import TYPE_CHECKING, Any, Dict, List, Optional

from agent.auxiliary_client import AuxiliaryExplicitCancellation

if TYPE_CHECKING:
    from agent.context_compressor import _HandoffScan


def _accepts_keyword_argument(callable_obj: Any, name: str) -> bool:
    """Return whether an inspectable callable accepts ``name`` as a keyword."""
    try:
        parameters = inspect.signature(callable_obj).parameters
    except (TypeError, ValueError):
        return False
    if any(parameter.kind is inspect.Parameter.VAR_KEYWORD for parameter in parameters.values()):
        return True
    parameter = parameters.get(name)
    return parameter is not None and parameter.kind in (
        inspect.Parameter.POSITIONAL_OR_KEYWORD,
        inspect.Parameter.KEYWORD_ONLY,
    )


class SummaryDispatchMixin:
    def _apply_summary_route(self, call_kwargs: dict, pinned: Optional[dict[str, Any]] = None) -> None:
        """Pin the summary route onto ``call_kwargs`` for both compression entry points.

        After a fallback, an omitted route is NOT "use the main model": ``call_llm`` re-resolves
        ``auxiliary.compression`` from config — the model that just failed — and a second fallback
        is refused, so every later attempt aborts (#123362). Name the main runtime explicitly.
        A stall-fallback ``pinned`` route replaces the whole route: merged over the main runtime, the
        main api_key/base_url would ride into the fallback entry's call (to its host, or instead of it).
        """
        if pinned:
            # Clear first: a keyless pin (local server) resolves its own credential, never the main one.
            for key in ("provider", "model", "base_url", "api_key", "api_mode"):
                call_kwargs.pop(key, None)
            call_kwargs.update(pinned)
            return
        if self.summary_model:
            call_kwargs["model"] = self.summary_model
            return
        if not getattr(self, "_summary_model_fallen_back", False):
            return
        for key, value in (
            ("provider", self.provider),
            ("model", self.model),
            ("base_url", self.base_url),
            ("api_key", self.api_key),
            ("api_mode", getattr(self, "api_mode", "")),
        ):
            if value:
                call_kwargs[key] = value

    def _summarize_window(
        self, messages: list[dict[str, Any]], turns_to_summarize: list[dict[str, Any]], scan: _HandoffScan,
        focus_topic: Optional[str], memory_context: str, bypass_cooldown: bool,
    ) -> Optional[str]:
        """Run the summary LLM; a cancellation rolls back the handoff scan's self-heal mutation first.
        A deterministic pin (repeated stall, #112420) skips the LLM: ``None`` lets Phase 3 insert the static
        fallback summary, or abort under ``abort_on_summary_failure`` exactly like a failed summary call."""
        from agent.context_compressor import take_deterministic_summary_pin
        if take_deterministic_summary_pin():
            # A detached stale attempt must not stamp error state or mutate the shared telemetry dict
            # the fallback owns; unwind as a cancellation before any write lands.
            from agent.conversation_compression import _raise_if_stale_attempt

            _raise_if_stale_attempt(self)
            # Surfaces through the fallback summary's reason line and the host's one-shot user warning.
            self._last_summary_error = (
                "summary model stalled on every route; deterministic fallback summary inserted"
            )
            telemetry = getattr(self, "_active_compression_telemetry", None)
            if isinstance(telemetry, dict):
                telemetry["failure_class"] = "stall_deterministic_fallback"
            return None
        # Focus-topic derivation scans user turns; only pay when a summary is generated.
        summary_kwargs: dict[str, Any] = {
            "focus_topic": focus_topic or self._derive_auto_focus_topic(messages),
            "memory_context": memory_context,
        }
        if _accepts_keyword_argument(self._generate_summary, "bypass_cooldown"):
            summary_kwargs["bypass_cooldown"] = bypass_cooldown
        try:
            return self._generate_summary(turns_to_summarize, **summary_kwargs)
        except AuxiliaryExplicitCancellation:
            # Cancellation is a true no-op: restore the scan's mutation before the exception escapes.
            # Guard by THIS attempt's ownership: a detached stale attempt (a fallback already claimed
            # and is working the compressor) must not revert summary state the newer attempt advanced.
            # The caller's own generation rides a ContextVar because shared compressor attributes can
            # only name the current owner, never the caller's attempt. Working-attempt comparison (not
            # the entry generation) so a no-op claim does not suppress the owning attempt's rollback.
            from agent.conversation_compression import _caller_attempt_is_current

            if _caller_attempt_is_current(self):
                self._previous_summary = scan.previous_summary_before
                self._summary_has_user_turn = scan.has_user_turn_before
            raise

    def _render_tool_call_for_summary(self, tc: Any) -> str:
        """``  name(args)`` line for the summarizer; object-shaped calls render as ``name(...)``."""
        from agent.context_compressor import _redact_compaction_text
        if not isinstance(tc, dict):
            fn = getattr(tc, "function", None)
            return f"  {getattr(fn, 'name', '?') if fn else '?'}(...)"
        fn = tc.get("function", {})
        # Redact the FULL args before cutting: delimited secrets (PEM BEGIN…END) only match whole, so a
        # pre-redaction cut would leave a key body straddling the cut unredacted in the persisted summary.
        args = _redact_compaction_text(fn.get("arguments", ""))
        if len(args) > self._TOOL_ARGS_MAX:
            args = args[:self._TOOL_ARGS_HEAD] + "..."
        return f"  {fn.get('name', '?')}({args})"

    def _serialize_records_for_summary(self, turns: list[dict[str, Any]]) -> list[str]:
        """Serialize turns into a list of labeled, redacted records for the summarizer."""
        # Lazy import: agent_runtime_helpers pulls heavy transitive imports.
        from agent.context_compressor import _summary_part_text, _redact_compaction_text, _MEDIA_DIRECTIVE_RE, elide_middle
        from agent.agent_runtime_helpers import strip_think_blocks
        parts = []
        for msg in turns:
            role = msg.get("role", "unknown")
            content = msg.get("content")
            if isinstance(content, list):
                content = "\n".join(_summary_part_text(part) for part in content if isinstance(part, (dict, str)))
            content = _redact_compaction_text(content or "")
            content = _MEDIA_DIRECTIVE_RE.sub("[media attachment]", content)
            # Strip inline <think>-style blocks: scratch work wastes summarizer context and risks being kept as fact.
            if role == "assistant" and content:
                content = strip_think_blocks(None, content)
            if len(content) > self._CONTENT_MAX:
                content = elide_middle(content, self._CONTENT_HEAD, self._CONTENT_TAIL)
            if role == "tool":
                parts.append(f"[TOOL RESULT {msg.get('tool_call_id', '')}]: {content}")
                continue
            if role == "assistant" and msg.get("tool_calls", []):
                content += "\n[Tool calls:\n" + "\n".join(map(self._render_tool_call_for_summary, msg["tool_calls"])) + "\n]"
            parts.append(f"[{role.upper()}]: {content}")
        return parts

    def _serialize_for_summary(self, turns: list[dict[str, Any]]) -> str:
        """Serialize turns into labeled, redacted text for the summarizer."""
        return "\n\n".join(self._serialize_records_for_summary(turns))

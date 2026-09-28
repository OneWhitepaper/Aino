"""Aino's Ultra effort enables proactive multi-agent delegation.

``ultra`` never reaches a wire: every route clamps it to its strongest level
(``agent/reasoning_effort.py``). What separates it from ``max`` is that the model may split work
across ``delegate_task`` subagents on its own initiative, when that saves time or improves quality.

Like Codex's multi-agent mode messages, the policy is stated when the mode changes, not every
turn: the first Ultra turn announces it, the first turn after leaving Ultra revokes it. Effort can
change mid-conversation, so the note rides the current user message through the ``api_content``
sidecar (replayed verbatim later) and never the byte-stable system prompt. The mode in force is
read back from that replayed history, so it survives agent rebuilds and resumes; a compaction that
drops the last note simply leads to it being stated again.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from agent.reasoning_effort import ULTRA_EFFORT, requested_effort
from agent.api_content import api_content_value
from agent.message_content import flatten_message_text

ULTRA_ON_MARKER = "[Ultra mode on: proactive multi-agent delegation]"
ULTRA_OFF_MARKER = "[Ultra mode off]"
ULTRA_MODE_METADATA_KEY = "aino.ultra_collaboration_active"

ULTRA_ON_NOTE = (
    f"{ULTRA_ON_MARKER}\n"
    "Proactive delegation is active from this message until a later Ultra-mode note ends it; the "
    "user's own instructions about subagents take precedence. You may now hand parts of the work to "
    "subagents with delegate_task without being asked, when parallel agents would materially shorten "
    "the work or improve its quality. That judgment is yours, and most requests need no subagents:\n"
    "- Handle directly anything you can finish quickly yourself: questions, single-file checks, small "
    "edits, routine searches, and tightly coupled or strictly sequential steps.\n"
    "- Never spawn a subagent to redo, double-check or give a second opinion on work you are doing "
    "yourself.\n"
    "- When a task is large enough to split, keep the step you need next for yourself and delegate "
    "concrete, bounded, self-contained sidecar tasks that run independently and materially advance "
    "the goal, such as separate areas to investigate or disjoint code slices to change (one owner per "
    "file). Independent ones can go out together in one call.\n"
    "- Prefer the configured or inherited child model and reasoning effort. Override reasoning_effort only when "
    "the task or user calls for a different level. Use context_turns when a child needs prior user requirements, "
    "and give its specific scope and deliverable in context and goal.\n"
    "- Do not redo completed delegated work: while subagents run, only tackle work they are not doing "
    "(or end your turn with a short status), and when their results return, spot-check the claims "
    "that matter and integrate them rather than repeating their reading.\n"
    "- Ask research children for findings, evidence and limitations; own the final presentation yourself. "
    "Complete or narrowly reassign any failed or incomplete parts, then deliver the requested final answer."
)

ULTRA_OFF_NOTE = (
    f"{ULTRA_OFF_MARKER} The proactive multi-agent delegation from earlier Ultra-mode notes no longer "
    "applies; decide about delegate_task as you would without it."
)


def _mode_in_force(history: Iterable[Any]) -> Optional[bool]:
    """Only runtime-stamped provenance can establish a mode; user text is never provenance.

    ``history`` reaches through this turn's user row, so a freshly staged row (no stamp) is skipped
    while a staged row that already carries one — an adopted unanswered turn — is counted."""
    default_inactive = False
    for message in reversed(list(history)):
        if not isinstance(message, dict) or message.get("role") != "user":
            continue
        metadata = message.get("display_metadata")
        recorded = metadata.get(ULTRA_MODE_METADATA_KEY) if isinstance(metadata, dict) else None
        if not isinstance(recorded, bool):
            continue
        sent = flatten_message_text(api_content_value(message.get("api_content")))
        marker = ULTRA_ON_MARKER if recorded else ULTRA_OFF_MARKER
        if marker in sent:
            return recorded
        # A compaction that drops a note must cause it to be announced again. Plain
        # inactive turns establish the default only when no surviving note says otherwise.
        default_inactive = default_inactive or not recorded
    return False if default_inactive else None


def ultra_mode_active(agent: Any) -> bool:
    return (
        requested_effort(getattr(agent, "reasoning_config", None)) == ULTRA_EFFORT
        and "delegate_task" in (getattr(agent, "valid_tool_names", None) or ())
    )


def ultra_mode_note(agent: Any, history: Iterable[Any]) -> str:
    """The Ultra-mode note this turn must carry, or ``""`` when the mode in force is unchanged.

    Top-level turns only: children never carry mode notes, their fan-out is bounded by the
    orchestrator rules. Ultra is active when the effort is ``ultra`` and ``delegate_task`` is
    available; ``history`` is the conversation through this turn's user row. A freshly staged row
    carries no runtime stamp, but a row adopted from an unanswered turn (a delivery retry) already
    carries its first attempt's stamp and note, and that note is the mode the transcript is in."""
    if getattr(agent, "_delegate_depth", 0):
        return ""
    history = list(history)
    active = ultra_mode_active(agent)
    in_force = _mode_in_force(history)
    if active and not in_force:
        return ULTRA_ON_NOTE
    if not active and in_force:
        return ULTRA_OFF_NOTE
    if not active and in_force is None:
        # Pre-release sessions have no provenance. Never infer ON from their text:
        # conservatively revoke any old policy once, then persist a trusted OFF state.
        for message in history:
            if not isinstance(message, dict) or message.get("role") != "user":
                continue
            sent = flatten_message_text(api_content_value(message.get("api_content")))
            if ULTRA_ON_MARKER in sent or ULTRA_OFF_MARKER in sent:
                return ULTRA_OFF_NOTE
    return ""

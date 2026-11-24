"""Reader-facing summary text for model-only compaction carriers."""

from __future__ import annotations

import re

from typing import Any, Optional

from agent.context_compressor import _LEAN_RECOVERY_HEADING, _LEAN_USER_MESSAGES_HEADING, ContextCompressor
from session_rules.turns import flatten_message_text, is_compaction_summary_message


# Lean-mode sections written for the model, not for a reader: the compacted turns' user messages
# quoted again, and the footer naming ``session_search`` (``ContextCompressor._augment_summary_lean``).
_MODEL_ONLY_SECTIONS = (_LEAN_USER_MESSAGES_HEADING, _LEAN_RECOVERY_HEADING)
_HISTORICAL_ONLY_LINE = "Historical only; newer protected-tail messages after this summary win."
_COMPACTED_COUNT = re.compile(r"The (\d+) compacted message\(s\) remain fully preserved")


def compaction_summary(message: Any) -> Optional[dict[str, Any]]:
    """What a compaction handoff tells a reader: ``{summary, compacted_messages}``, or ``None`` for any
    other message. ``summary`` is the summary as the compressor wrote it, without the model-facing
    preamble and end marker, prior-tail content or live ask merged into the carrier, the lean
    sections above and the snapshot's ranking line; ``compacted_messages`` is the count the recovery
    footer names (``None`` when it has none)."""
    if not is_compaction_summary_message(message):
        return None
    text = ContextCompressor._strip_summary_prefix(flatten_message_text(message.get("content")))
    sections = {}
    for heading in _MODEL_ONLY_SECTIONS:
        start = text.find(heading)
        if start >= 0:
            end = text.find("\n## ", start + len(heading))
            sections[heading] = text[start:end if end >= 0 else len(text)]
            text = text[:start] + (text[end + 1:] if end >= 0 else "")
    # The footer's count, never one a quoted user message happens to spell out (the quotes are cut first).
    counts = _COMPACTED_COUNT.findall(sections.get(_LEAN_RECOVERY_HEADING, text))
    text = "\n".join(line for line in text.splitlines() if line.strip() != _HISTORICAL_ONLY_LINE)
    return {"summary": re.sub(r"\n{3,}", "\n\n", text).strip(),
            "compacted_messages": int(counts[-1]) if counts else None}

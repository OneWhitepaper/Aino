"""The shared storage/UI projection keeps human text without replaying scaffold."""

from copy import deepcopy

import pytest

from session_rules.turns import (
    SUMMARY_PREFIX,
    _INFLIGHT_TASK_REPLAY_HEADER,
    _SUMMARY_END_MARKER,
    project_compaction_message_for_display,
)


@pytest.mark.parametrize("multimodal", [False, True])
def test_old_replay_requires_prior_human_evidence(multimodal):
    content = f"{_INFLIGHT_TASK_REPLAY_HEADER}\nRead the image"
    if multimodal:
        content = [
            {"type": "text", "text": content},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,eA=="}},
        ]
    row = {"role": "user", "content": content, "timestamp": 100}
    before = deepcopy(row)
    calls = []

    def prior_user_match(message, original, timestamp):
        calls.append((message, original, timestamp))
        return True

    assert project_compaction_message_for_display(row, prior_user_match=prior_user_match) is None
    expected = "Read the image" if not multimodal else [
        {"type": "text", "text": "Read the image"}, content[1],
    ]
    assert calls == [(row, expected, 100)]
    assert project_compaction_message_for_display(row, prior_user_match=lambda *_: False) == row
    assert row == before


def test_recorded_replay_hides_scaffold_but_preserves_carrier_live_ask():
    replay = {
        "role": "user",
        "content": f"{_INFLIGHT_TASK_REPLAY_HEADER}\nKeep working",
        "display_metadata": {"compaction_replay": True},
    }
    assert project_compaction_message_for_display(replay) is None
    carrier = {
        "role": "user",
        "content": f"{SUMMARY_PREFIX}Prior context\n{_SUMMARY_END_MARKER}\nA new human ask",
        "_compressed_summary": True,
        "display_metadata": {"compaction_replay": True, "reviewed_handoff": True},
        "reasoning": "internal reasoning",
    }
    before = deepcopy(carrier)
    shown = project_compaction_message_for_display(carrier)
    assert shown["content"] == "A new human ask"
    assert shown["display_metadata"] == {"reviewed_handoff": True}
    assert "reasoning" not in shown
    assert carrier == before

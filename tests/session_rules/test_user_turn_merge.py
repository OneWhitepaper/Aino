"""Durable turn repair must retain pivot identity and native replay sidecars."""

from copy import deepcopy

import pytest

from session_rules.turns import _merge_consecutive_users


@pytest.mark.parametrize("kind", ["model_switch", "personality_switch"])
def test_persisted_pivot_does_not_absorb_the_next_human_prompt(kind):
    rows = [
        {"role": "user", "content": "runtime changed", "display_kind": kind, "_row_id": 1},
        {"role": "user", "content": "continue my task", "_row_id": 2},
    ]
    before = deepcopy(rows)
    merged, repairs = _merge_consecutive_users(rows)
    assert (merged, repairs) == (before, 0)
    assert rows == before


@pytest.mark.parametrize("sidecar_index", [0, 1])
def test_native_multimodal_sidecar_on_either_row_keeps_provider_replay_bytes(sidecar_index):
    rows = [
        {"role": "user", "content": "look at this", "_row_id": 1},
        {"role": "user", "content": "continue my task", "_row_id": 2},
    ]
    rows[sidecar_index]["api_content"] = [
        {"type": "text", "text": "provider-exact context"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,eA=="}},
    ]
    before = deepcopy(rows)
    merged, repairs = _merge_consecutive_users(rows)
    assert (merged, repairs) == (before, 0)
    assert rows == before

"""A batch completion should disclose execution facts about each child, without judging them.

The batch event carries no ``model`` of its own, so the preamble printed ``Model: ?`` even though
every result names the model it ran on. And each task header carried only ``api_calls`` and
duration, while the payload already holds per-child cumulative token usage, cost, exit reason and
schema validity — an unfinished or malformed child was indistinguishable from a clean one.

These are identity, usage and execution/format facts. They are deliberately NOT framed as a
measure of how thoroughly a child worked: ``tokens`` counts re-sent context, so it cannot say how
much source was read, and a schema-valid result is not a factually correct one. Nothing here
licenses a parent to verify a child's claims less.
"""
from __future__ import annotations

from tools.process_registry_notifications import format_process_notification


def _batch(results, **overrides):
    evt = {
        "type": "async_delegation",
        "is_batch": True,
        "delegation_id": "deleg_batch",
        "goals": ["review compression", "review delegation", "review model history"],
        "session_key": "sk",
        "origin_ui_session_id": "ui",
        "parent_session_id": "root",
        "dispatched_at": 1.0,
        "role": "leaf",
        # Batch events have no model of their own; this is what made the preamble print "?".
        "model": "",
        "total_duration_seconds": 793.8,
        "results": results,
    }
    evt.update(overrides)
    return evt


def _result(task_index, **overrides):
    result = {
        "task_index": task_index,
        "status": "completed",
        "api_calls": 4,
        "duration_seconds": 100.0,
        "summary": '{"findings": []}',
        "model": "gpt-5.6-sol",
        "exit_reason": "completed",
        "schema_valid": True,
    }
    result.update(overrides)
    return result


def test_the_child_model_is_named_when_the_batch_event_has_none():
    text = format_process_notification(_batch([_result(0), _result(1)]))
    assert "Model: gpt-5.6-sol" in text
    assert "Model: ?" not in text


def test_each_task_header_labels_cumulative_usage_rather_than_implying_effort():
    """Cumulative session usage is a usage figure; the label must not read as "worked harder"."""
    text = format_process_notification(_batch([
        _result(0, tokens={"input": 770_816, "output": 12_409}, api_calls=9, duration_seconds=790.22),
        _result(1, tokens={"input": 90_000, "output": 5_894}, api_calls=3, duration_seconds=652.93),
    ]))
    assert "783,225 cumulative tokens" in text
    assert "95,894 cumulative tokens" in text
    # No wording that could be read as depth or trust.
    assert "depth" not in text.lower() and "deeper" not in text.lower()


def test_a_child_that_did_not_finish_cleanly_says_so_in_its_header():
    text = format_process_notification(_batch([
        _result(0, exit_reason="max_iterations", schema_valid=False),
    ]))
    assert "exit=max_iterations" in text
    assert "schema=INVALID" in text


def test_a_clean_child_adds_no_noise_to_its_header():
    text = format_process_notification(_batch([_result(0, tokens={"input": 0, "output": 0})]))
    header = next(line for line in text.splitlines() if line.startswith("--- "))
    assert "exit=" not in header and "schema=" not in header


def test_multiple_child_models_are_disclosed_rather_than_hidden_behind_the_first():
    text = format_process_notification(_batch([
        _result(0, model="gpt-5.6-sol"),
        _result(1, model="gpt-5.6-mini"),
    ]))
    assert "Model: gpt-5.6-sol (+1 other model(s))" in text


def test_a_single_result_notification_is_unchanged_by_the_batch_fields():
    """The single-task path reads the event's own model and must not gain batch-only annotations."""
    evt = {
        "type": "async_delegation",
        "delegation_id": "deleg_single",
        "status": "completed",
        "summary": "one finding",
        "goal": "review compression",
        "session_key": "sk",
        "origin_ui_session_id": "ui",
        "dispatched_at": 1.0,
        "role": "leaf",
        "model": "gpt-5.6-sol",
        "api_calls": 2,
        "duration_seconds": 12.0,
    }
    text = format_process_notification(evt)
    assert "Model: gpt-5.6-sol" in text
    assert "tokens" not in text

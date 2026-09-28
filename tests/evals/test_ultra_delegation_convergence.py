"""Convergence metrics must not misreport a never-attempted answer as an interrupted one.

The whole-task question is "did the parent deliver inside the budget", and the two runs that
answer it are easy to conflate: a parent still inside its tool loop when the cap fired never
offered an answer, while a parent that stopped with text and no cap did deliver. The extractor
also has to keep the budget split honest, because ``limits.approx_cumulative_input`` covers the
parent AND its children together — reading it as the parent's own headroom overstates the parent.

The saved live report is used when the originating machine's archive is present; the synthetic
cases below pin the same contracts on any machine.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from evals.ultra_delegation import convergence

# The originating machine's archive. Not distributed with the repo, so every test that needs it
# skips rather than failing on a reviewer's checkout.
ARCHIVE = Path("/private/tmp/aino-ultra-acceptance-20260925")
FAILED_LIVE_RUN = ARCHIVE / "live-large-132101" / "report.json"
DELIVERED_REPLAY_RUN = ARCHIVE / "live-replay-140532" / "report.json"


def _report(*, parent_id="parent", child_ids=("child-a",), parent_reasons=("tool_calls",),
            parent_inputs=(1000,), child_inputs=(500,), stop_reason="token_request_cap"):
    """A minimal report carrying only the fields the extractor reads."""
    requests = [{"session_id": parent_id, "approx_input_tokens": value} for value in parent_inputs]
    responses = [{"session_id": parent_id, "finish_reason": reason} for reason in parent_reasons]
    for child in child_ids:
        requests.extend({"session_id": child, "approx_input_tokens": value} for value in child_inputs)
    return {
        "scenario": "large",
        "live": True,
        "stop_reason": stop_reason,
        "elapsed_seconds": 100.0,
        "limits": {"seconds": 1200, "requests": 64, "approx_cumulative_input": 2_000_000},
        "sessions": [{"id": parent_id, "parent_session_id": None}]
                    + [{"id": child, "parent_session_id": parent_id} for child in child_ids],
        "requests": requests,
        "responses": responses,
        "children_finished": [{"duration_seconds": 10.0}, {"duration_seconds": 42.5}],
        "parent_all_tool_counts": {"delegate_task": 1},
    }


def test_budget_split_does_not_claim_the_whole_cap_for_the_parent():
    """The cap is whole-task: children spending must reduce the parent's own headroom."""
    summary = convergence.summarize(_report(), events_path=Path("/nonexistent/events.jsonl"))
    split = summary["budget_split"]
    assert split["cumulative_approx_input_total"] == 1500
    assert split["parent_cumulative_approx_input"] == 1000
    assert split["children_cumulative_approx_input"] == 500
    assert summary["delivery"]["child_requests_total"] == 1


def test_parent_identification_prefers_the_root_session_over_the_busiest():
    """A child can out-spend the parent; the root is the session with no ``parent_session_id``."""
    report = _report(parent_inputs=(10,), child_inputs=(999, 999, 999))
    summary = convergence.summarize(report, events_path=Path("/nonexistent/events.jsonl"))
    assert summary["budget_split"]["parent_cumulative_approx_input"] == 10
    assert summary["parent_tools"] == {"delegate_task": 1}


def test_missing_events_leave_the_turn_split_unknown_instead_of_guessed():
    """Without the events sibling the split cannot be derived, and a guess would look like data."""
    summary = convergence.summarize(_report(), events_path=Path("/nonexistent/events.jsonl"))
    behaviour = summary["parent_delivery_behaviour"]
    assert behaviour["parent_turns_before_delivery"] is None
    assert behaviour["last_child_seconds"] is None


def test_final_tool_call_means_no_answer_was_ever_offered():
    """The interrupted run's shape: everything after dispatch is a tool call, so nothing was cut short."""
    summary = convergence.summarize(
        _report(parent_reasons=("tool_calls", "stop", "tool_calls"), parent_inputs=(1, 2, 3)),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    behaviour = summary["parent_delivery_behaviour"]
    assert behaviour["final_finish_reason"] == "tool_calls"
    assert behaviour["answer_attempted"] is False
    assert behaviour["interrupted_mid_tool_loop"] is True
    assert summary["natural_final"] is False


def test_a_stopped_parent_counts_as_an_attempted_answer():
    """A delivered run must not be reported as never having tried."""
    summary = convergence.summarize(
        _report(parent_reasons=("tool_calls", "stop"), stop_reason="normal_final"),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    behaviour = summary["parent_delivery_behaviour"]
    assert behaviour["answer_attempted"] is True
    assert behaviour["interrupted_mid_tool_loop"] is False
    assert summary["natural_final"] is True


def test_delivery_moment_is_the_last_child_to_finish():
    summary = convergence.summarize(_report(), events_path=Path("/nonexistent/events.jsonl"))
    assert summary["delivery"]["last_child_seconds"] == 42.5


@pytest.mark.skipif(not FAILED_LIVE_RUN.is_file(), reason="originating machine's run archive absent")
def test_real_interrupted_run_reports_no_answer_and_a_bounded_context_growth():
    report = json.loads(FAILED_LIVE_RUN.read_text())
    summary = convergence.summarize(report, path=str(FAILED_LIVE_RUN),
                                   events_path=FAILED_LIVE_RUN.parent / "events.jsonl")
    assert summary["natural_final"] is False
    assert summary["parent_delivery_behaviour"]["answer_attempted"] is False
    # Regression pins for the numbers the diagnosis rests on.
    assert summary["parent_exact_duplicate_tools"] == 0
    assert summary["delivery"]["children_finished"] == 3
    assert summary["parent_cost_shape"]["context_growth_ratio"] > 1


@pytest.mark.skipif(not DELIVERED_REPLAY_RUN.is_file(), reason="originating machine's run archive absent")
def test_real_delivered_replay_reports_an_answer():
    report = json.loads(DELIVERED_REPLAY_RUN.read_text())
    summary = convergence.summarize(report, path=str(DELIVERED_REPLAY_RUN),
                                   events_path=DELIVERED_REPLAY_RUN.parent / "events.jsonl")
    assert summary["natural_final"] is True
    assert summary["parent_delivery_behaviour"]["answer_attempted"] is True

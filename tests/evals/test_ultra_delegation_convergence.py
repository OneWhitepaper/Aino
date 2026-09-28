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
            parent_inputs=(1000,), child_inputs=(500,), stop_reason="token_request_cap",
            auxiliary_inputs=(), final_text="", task_turn="turn-1"):
    """A minimal report carrying only the fields the extractor reads.

    Requests and responses are correlated on ``api_request_id`` and attributed to a turn via
    ``turn_id`` — the same identity the production observer records — so the fixture can express an
    auxiliary side call and an unanswered request instead of flattening a session into one list.
    """
    requests = [
        {"session_id": parent_id, "approx_input_tokens": value,
         "api_request_id": f"{task_turn}:req:{index}", "turn_id": task_turn}
        for index, value in enumerate(parent_inputs)
    ]
    responses = [
        {"session_id": parent_id, "finish_reason": reason,
         "api_request_id": f"{task_turn}:req:{index}"}
        for index, reason in enumerate(parent_reasons)
    ]
    for index, value in enumerate(auxiliary_inputs):
        requests.append({"session_id": parent_id, "approx_input_tokens": value,
                         "api_request_id": f"aux:{index}", "turn_id": "turn-aux"})
    for child in child_ids:
        requests.extend({"session_id": child, "approx_input_tokens": value} for value in child_inputs)
    report = {
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
    if final_text:
        report["final_event"] = {"payload": {"text": final_text}}
    return report


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
    assert behaviour["last_child_wall_seconds"] is None
    assert summary["delivery"]["last_child_wall_seconds"] is None


def test_final_tool_call_means_no_answer_was_ever_offered():
    """The interrupted run's shape: the task turn ends inside its tool loop, so nothing was cut short."""
    summary = convergence.summarize(
        _report(parent_reasons=("tool_calls", "tool_calls"), parent_inputs=(1, 2)),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    behaviour = summary["parent_delivery_behaviour"]
    assert behaviour["final_finish_reason"] == "tool_calls"
    assert behaviour["answer_state"] == "mid_tool_loop"
    assert summary["natural_final"] is False


def test_a_stop_without_text_is_not_reported_as_an_answer():
    """A 'stop' reason alone is not an answer: no final text means the state is not 'answered'."""
    summary = convergence.summarize(
        _report(parent_reasons=("tool_calls", "stop"), parent_inputs=(100, 200),
                stop_reason="normal_final"),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    assert summary["parent_delivery_behaviour"]["answer_state"] == "stopped_without_text"


def test_an_unrecognised_finish_reason_is_unknown_not_success():
    """A None/error reason must never be read as an attempted answer."""
    summary = convergence.summarize(
        _report(parent_reasons=(None,), parent_inputs=(1,)),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    state = summary["parent_delivery_behaviour"]["answer_state"]
    assert state.startswith("unknown"), state


def test_a_stopped_parent_with_text_counts_as_answered():
    """A delivered run must not be reported as never having tried."""
    summary = convergence.summarize(
        _report(parent_reasons=("tool_calls", "stop"), parent_inputs=(100, 200),
                stop_reason="normal_final", final_text="final report body"),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    behaviour = summary["parent_delivery_behaviour"]
    assert behaviour["answer_state"] == "answered"
    assert behaviour["final_event_text_chars"] == len("final report body")
    assert summary["natural_final"] is True


def test_purpose_is_never_inferred_from_response_state():
    """A usage-missing record is an observation gap, not proof of auxiliary identity.

    The harness flags any request it could not pair with a response or usage row — including an
    ordinary chat request cut off mid-flight. So the same fixture must report the request as
    usage_missing while its PURPOSE stays unknown.
    """
    turns = [("turn-a", [100, 200], ["tool_calls", "stop"]), ("turn-b", [999], [])]
    summary = convergence.summarize(
        _multi_turn_report(turns, observed_usage={"missing_response_ids": ["turn-b:req:0"]}),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    delivery = summary["delivery"]
    assert delivery["parent_requests_total"] == 3
    assert delivery["parent_answered_requests"] == 2
    assert delivery["parent_unanswered_requests"] == 1
    assert delivery["parent_usage_missing_requests"] == 1
    # Purpose remains unproven for every request, in every turn.
    assert delivery["parent_purpose_unproven_requests"] == 3
    assert {turn["purpose"] for turn in delivery["parent_turns"]} == {"unknown"}


def _multi_turn_report(turns, *, observed_usage=None, final_text="done", final_status="complete",
                       guard_eligible=True):
    """A parent session with several turns, each ``(turn_id, [inputs], [reasons])``."""
    requests, responses = [], []
    for turn_id, inputs, reasons in turns:
        for index, value in enumerate(inputs):
            requests.append({"session_id": "parent", "approx_input_tokens": value,
                             "api_request_id": f"{turn_id}:req:{index}", "turn_id": turn_id})
        for index, reason in enumerate(reasons):
            responses.append({"session_id": "parent", "finish_reason": reason,
                              "api_request_id": f"{turn_id}:req:{index}"})
    report = {
        "scenario": "large", "live": True, "stop_reason": "normal_final",
        "limits": {"approx_cumulative_input": 2_000_000},
        "sessions": [{"id": "parent", "parent_session_id": None}],
        "requests": requests, "responses": responses,
        "children_finished": [],
        "final_event": {"payload": {"status": final_status, "text": final_text}},
        "completion_guard": {"eligible": guard_eligible},
    }
    if observed_usage is not None:
        report["observed_usage"] = observed_usage
    return report


def test_an_interrupted_task_request_is_not_reclassified_as_auxiliary():
    """Counterexample 1: a normal chat request cut off mid-flight keeps its own identity.

    It answers nothing, so a response-based classifier would call it auxiliary. Purpose is reported
    as unknown, the request stays inside the total, and its input stays in the budget.
    """
    summary = convergence.summarize(
        _multi_turn_report([("turn-1", [100, 200], ["tool_calls"])],
                           observed_usage={"missing_response_ids": ["turn-1:req:1"]}),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    delivery = summary["delivery"]
    assert delivery["parent_requests_total"] == 2
    assert delivery["parent_unanswered_requests"] == 1
    assert delivery["parent_usage_missing_requests"] == 1
    assert delivery["parent_purpose_unproven_requests"] == 2
    assert summary["budget_split"]["parent_cumulative_approx_input"] == 300


def test_a_side_call_that_answers_normally_is_not_reclassified_as_a_task():
    """Counterexample 2: answering is not evidence of being a task request.

    A background side call with a recorded response is the mirror case. Purpose stays unknown for
    it, and the analyzer must not promote it into a task turn on the strength of its response.
    """
    summary = convergence.summarize(
        _multi_turn_report([("turn-main", [100], ["stop"]), ("turn-side", [250], ["stop"])]),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    delivery = summary["delivery"]
    assert delivery["parent_answered_requests"] == 2          # both answered...
    assert delivery["parent_purpose_unproven_requests"] == 2  # ...and neither is classed
    assert {turn["purpose"] for turn in delivery["parent_turns"]} == {"unknown"}
    # Both stay in the totals rather than one being dropped as "auxiliary".
    assert summary["budget_split"]["parent_cumulative_approx_input"] == 350


def test_request_and_usage_totals_are_conserved_across_the_split():
    """No request may be lost or double counted by the response-state split."""
    turns = [("turn-a", [100, 200, 300], ["tool_calls", "tool_calls"]), ("turn-b", [400], ["stop"])]
    report = _multi_turn_report(turns, observed_usage={"missing_usage_ids": ["turn-a:req:2"]})
    summary = convergence.summarize(report, events_path=Path("/nonexistent/events.jsonl"))
    delivery = summary["delivery"]
    assert (delivery["parent_answered_requests"] + delivery["parent_unanswered_requests"]
            == delivery["parent_requests_total"])
    assert delivery["parent_requests_total"] == len(report["requests"])
    assert delivery["parent_purpose_unproven_requests"] == delivery["parent_requests_total"]
    assert sum(turn["requests"] for turn in delivery["parent_turns"]) == delivery["parent_requests_total"]
    split = summary["budget_split"]
    assert (split["parent_answered_approx_input"] + split["parent_unanswered_approx_input"]
            == split["parent_cumulative_approx_input"])
    assert split["parent_cumulative_approx_input"] == sum(
        r["approx_input_tokens"] for r in report["requests"])


def test_wire_purpose_totals_are_reported_but_never_joined_to_requests():
    """The transport log carries real purposes; it shares no key with requests, so it stays totals."""
    report = _multi_turn_report([("turn-1", [100], ["stop"])])
    report["wire_attempts"] = [
        {"turn_id": "transport-uuid", "purpose": "chat"},
        {"turn_id": "transport-uuid", "purpose": "delegation"},
        {"turn_id": "transport-uuid", "purpose": "other_auxiliary"},
    ]
    summary = convergence.summarize(report, events_path=Path("/nonexistent/events.jsonl"))
    wire = summary["delivery"]["wire_purposes"]
    assert wire["available"] is True
    assert wire["by_purpose"] == {"chat": 1, "delegation": 1, "other_auxiliary": 1}
    assert (wire["attempts_total"], wire["requests_total"], wire["unjoined_attempts"]) == (3, 1, 2)
    # No request gained a purpose from those totals.
    assert summary["delivery"]["parent_purpose_unproven_requests"] == 1


def test_a_shorter_follow_up_turn_can_carry_the_delivery():
    """A later, smaller turn may hold the delivered answer: recency decides, not request count."""
    summary = convergence.summarize(
        _multi_turn_report([
            ("turn-long", [900, 900, 900], ["tool_calls", "tool_calls", "tool_calls"]),
            ("turn-short", [50], ["stop"]),
        ]),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    behaviour = summary["parent_delivery_behaviour"]
    assert behaviour["answer_state"] == "answered"
    assert summary["natural_delivery"] is True
    assert summary["delivery"]["parent_answered_requests"] == 4


def test_a_non_empty_interrupt_note_is_not_a_delivered_answer():
    """An interrupted run can carry text; without a complete event and an admitting guard it fails."""
    summary = convergence.summarize(
        _multi_turn_report(
            [("turn-1", [100], ["tool_calls"])],
            final_text="Operation interrupted: waiting for model response",
            final_status="interrupted", guard_eligible=False,
        ),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    assert summary["natural_delivery"] is False
    assert summary["parent_delivery_behaviour"]["answer_state"] == "mid_tool_loop"
    reasons = " ".join(summary["not_delivered_because"])
    assert "status='interrupted'" in reasons
    assert "completion_guard did not admit" in reasons


def test_a_normal_final_without_an_admitting_guard_is_not_a_delivery():
    """The run's own completion guard must have admitted the final, not just the stop reason."""
    summary = convergence.summarize(
        _multi_turn_report([("turn-1", [100], ["stop"])], guard_eligible=False),
        events_path=Path("/nonexistent/events.jsonl"),
    )
    assert summary["natural_delivery"] is False
    assert "completion_guard did not admit" in " ".join(summary["not_delivered_because"])


def test_an_unanswered_request_is_reported_rather_than_assumed_delivered():
    """A request cut off before its response must show up as unanswered, not as a completed turn."""
    report = _report(parent_inputs=(100, 200), parent_reasons=("tool_calls",))
    summary = convergence.summarize(report, events_path=Path("/nonexistent/events.jsonl"))
    assert summary["delivery"]["parent_unanswered_requests"] == 1


def test_child_runtime_and_delivery_wall_clock_are_reported_separately():
    """A child's own duration is not the moment its result landed: children start after dispatch."""
    summary = convergence.summarize(_report(), events_path=Path("/nonexistent/events.jsonl"))
    assert summary["delivery"]["children_own_seconds_max"] == 42.5
    assert summary["delivery"]["last_child_wall_seconds"] is None


@pytest.mark.skipif(not FAILED_LIVE_RUN.is_file(), reason="originating machine's run archive absent")
def test_real_interrupted_run_reports_no_answer_and_a_bounded_context_growth():
    report = json.loads(FAILED_LIVE_RUN.read_text())
    summary = convergence.summarize(report, path=str(FAILED_LIVE_RUN),
                                   events_path=FAILED_LIVE_RUN.parent / "events.jsonl")
    assert summary["natural_final"] is False
    assert summary["parent_delivery_behaviour"]["answer_state"] == "mid_tool_loop"
    assert summary["natural_delivery"] is False
    # The recorded run has no answerable purpose evidence, so purpose stays unproven for all 17.
    assert summary["delivery"]["parent_requests_total"] == 17
    assert summary["delivery"]["parent_purpose_unproven_requests"] == 17
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
    assert summary["parent_delivery_behaviour"]["answer_state"] == "answered"

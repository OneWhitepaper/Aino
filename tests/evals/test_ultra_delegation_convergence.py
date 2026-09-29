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

import collections
import json
from pathlib import Path
import queue
import signal
import subprocess
import sys
import threading

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


def test_completed_api_and_tool_evidence_stays_in_stored_parent_session():
    """Concurrent children can dominate totals without becoming the parent's own work."""
    report = _report(child_ids=("child-a", "child-b"), child_inputs=(90, 90, 90))
    report["stored_session_id"] = "parent"
    report["responses"] = [
        {"session_id": "child-b", "api_duration": 4},
        {"session_id": "parent", "api_duration": 2},
        {"session_id": "unrelated", "api_duration": 100},
        {"session_id": "child-a", "api_duration": 6},
        {"session_id": "parent", "api_duration": 8},
        {"session_id": "parent", "api_duration": None},
    ]
    report["db_messages"] = [
        {"session_id": "child-a", "role": "tool", "content": "large child result"},
        {"session_id": "parent", "role": "tool", "content": "alpha"},
        {"session_id": "parent", "role": "assistant", "content": "not a tool result"},
        {"session_id": "parent", "role": "tool", "content": "中文"},
        {"session_id": "parent", "role": "tool", "content": None},
    ]
    summary = convergence.summarize(report, events_path=Path("/nonexistent/events.jsonl"))
    durations = summary["completed_api_durations"]
    assert durations["parent"] == {"count": 2, "sum_seconds": 10, "mean_seconds": 5,
                                   "unmeasured_count": 1}
    assert durations["children"] == {"count": 2, "sum_seconds": 10, "mean_seconds": 5,
                                     "unmeasured_count": 0}
    assert durations["unattributed"]["sum_seconds"] == 100
    assert summary["parent_tool_results"] == {
        "available": True, "session_id": "parent", "count": 3, "content_chars": 7,
    }
    assert summary["parent_tool_timing"]["available"] is False
    assert summary["natural_delivery"] is False


def test_new_evidence_metrics_do_not_guess_parent_from_request_volume():
    """Without an explicit identity, a busy child remains unattributed evidence."""
    report = _report(parent_inputs=(5,), child_ids=("busy-child",), child_inputs=(20, 30))
    report.pop("sessions")
    report["responses"] = [
        {"session_id": "parent", "api_duration": 2},
        {"session_id": "busy-child", "api_duration": 10},
    ]
    report["db_messages"] = [
        {"session_id": "busy-child", "role": "tool", "content": "child evidence"},
    ]
    summary = convergence.summarize(report, events_path=Path("/nonexistent/events.jsonl"))
    durations = summary["completed_api_durations"]
    assert durations["parent_session_id"] is None
    assert durations["parent"]["count"] == durations["children"]["count"] == 0
    assert durations["unattributed"] == {"count": 2, "sum_seconds": 12, "mean_seconds": 6,
                                        "unmeasured_count": 0}
    assert summary["parent_tool_results"] == {
        "available": False, "session_id": None, "count": None, "content_chars": None,
    }


def test_tool_times_pair_by_id_and_keep_every_execute_code_start(tmp_path):
    """Simultaneous starts have real durations; later and unfinished calls must remain visible."""
    report = _report()
    report["session_id"] = "parent-ui"
    events = [
        (8, "tool.complete", "parent-ui", "unmatched", "execute_code", {}),
        (10, "tool.start", "parent-ui", "code-a", "execute_code", {}),
        (10, "tool.start", "parent-ui", "code-b", "execute_code", {}),
        (10, "tool.start", "parent-ui", "read", "read_file", {}),
        (10, "tool.start", "child-ui", "code-a", "execute_code", {}),
        (13, "tool.complete", "parent-ui", "read", "read_file", {}),
        (14, "tool.complete", "parent-ui", "code-b", "execute_code", {}),
        (15, "tool.complete", "parent-ui", "code-a", "execute_code", {}),
        (20, "tool.start", "parent-ui", "code-c", "execute_code", {}),
        (23, "tool.complete", "parent-ui", "code-c", "execute_code", {"duration_s": 2.75}),
        (30, "tool.start", "parent-ui", "code-d", "execute_code", {}),
        (99, "tool.complete", "child-ui", "code-a", "execute_code", {}),
    ]
    events_path = tmp_path / "events.jsonl"
    events_path.write_text("\n".join(json.dumps({
        "time": time, "event": name, "session_id": session,
        "payload": {"tool_id": tool_id, "name": tool_name, **extra},
    }) for time, name, session, tool_id, tool_name, extra in events))
    summary = convergence.summarize(report, events_path=events_path)
    timing = summary["parent_tool_timing"]
    assert timing["started_count"] == 5
    assert timing["paired_count"] == 4
    assert timing["unpaired_start_count"] == timing["unpaired_complete_count"] == 1
    assert timing["durations"]["sum_seconds"] == 14.75
    sequence = timing["execute_code_calls"]
    assert [call["tool_id"] for call in sequence] == ["code-a", "code-b", "code-c", "code-d"]
    assert [call["start_seconds"] for call in sequence] == [10, 10, 20, 30]
    assert [call["complete_seconds"] for call in sequence] == [15, 14, 23, None]
    assert [call["duration_seconds"] for call in sequence] == [5, 4, 2.75, None]
    assert [call["duration_source"] for call in sequence] == [
        "paired_event_times", "paired_event_times", "tool.complete.duration_s", None,
    ]


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


def _run_offline_harness(tmp_path, options, *, signal_on_ready=False):
    repo = Path(__file__).resolve().parents[2]
    process = subprocess.Popen(
        [sys.executable, str(repo / "evals/ultra_delegation/harness.py"), "large",
         "--review-skill=none", *options, f"--output-root={tmp_path}", "--name=offline"],
        cwd=repo, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True,
    )
    lines = []
    stages = queue.Queue()

    def collect_output():
        for line in process.stdout:
            lines.append(line)
            try:
                stages.put(json.loads(line).get("stage"))
            except (ValueError, AttributeError):
                continue
        stages.put("process_exited")

    reader = threading.Thread(target=collect_output, daemon=True)
    reader.start()
    try:
        if signal_on_ready:
            while True:
                stage = stages.get(timeout=60)
                assert stage != "process_exited", "".join(lines)
                if stage == "session_ready":
                    process.send_signal(signal.SIGTERM)
                    break
        returncode = process.wait(timeout=60)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        reader.join(timeout=5)
        process.stdout.close()
    assert returncode in (0, 2), "".join(lines)
    report = json.loads((tmp_path / "offline/report.json").read_text())
    assert report["live"] is False
    assert returncode == (0 if report["stop_reason"] == "normal_final" else 2)
    return report


@pytest.mark.parametrize("matched_comparison", [True, False], ids=["matched", "nonmatched"])
def test_wire_observer_separates_iterator_and_consumer_time_offline(tmp_path, matched_comparison):
    """The real sync/async observer must not charge consumer pauses to stream reads."""
    report = _run_offline_harness(
        tmp_path, [*(["--matched-comparison"] if matched_comparison else []), "--budget=0"],
    )
    assert report["wire_observer_self_check"] is not None
    assert report["wire_observer_self_check"]["iterator_consumer_timing_separated"] is True
    assert report["stop_reason"] == "timeout"
    assert report["caps"] == []


@pytest.mark.parametrize("stop_reason,options,signal_on_ready", [
    pytest.param("external_signal", [], True, marks=pytest.mark.linux_only, id="external-signal-linux"),
    pytest.param("external_signal", [], True, marks=pytest.mark.macos_only, id="external-signal-macos"),
    ("token_request_cap", ["--input-cap=1"], False),
    ("normal_final", [], False),
])
def test_harness_reports_the_observed_stop_cause(tmp_path, stop_reason, options, signal_on_ready):
    """An external signal is not evidence that an internal token limit fired."""
    report = _run_offline_harness(
        tmp_path, ["--budget=60", *options], signal_on_ready=signal_on_ready,
    )
    assert report["stop_reason"] == stop_reason
    if stop_reason == "token_request_cap":
        assert "aggregate_request_or_input_threshold" in report["caps"]
    else:
        assert report["caps"] == []
    if stop_reason == "normal_final":
        assert report["completion_guard"]["eligible"] is True
        assert report["final_event"]["payload"]["text"].startswith("LOCAL_PARENT_FINAL:")


def _count(requests, responses):
    return convergence.cumulative_input_excluding_cache_reads(requests, responses)


def _usage(*, uncached, cache_read, cache_write, output=10):
    """A provider usage row whose buckets satisfy the harness's own validation."""
    return {"input_tokens": uncached, "cache_read_tokens": cache_read,
            "cache_write_tokens": cache_write, "output_tokens": output,
            "prompt_tokens": uncached + cache_read + cache_write,
            "total_tokens": uncached + cache_read + cache_write + output}


def test_ceiling_counts_uncached_plus_cache_writes_and_excludes_only_reads():
    """Exact total: cache writes are new input and must count; only reads are excluded.

    Concrete arithmetic rather than an inequality. Two settled requests:
      r1 uncached 1,000 + write 4,000 + read 20,000
      r2 uncached   500 + write     0 + read 30,000
    The ceiling figure is 1,000+4,000+500 = 5,500; excluded reads total 50,000.
    """
    requests = [{"api_request_id": "r1", "approx_input_tokens": 25_000},
                {"api_request_id": "r2", "approx_input_tokens": 30_500}]
    responses = [
        {"api_request_id": "r1", "usage": _usage(uncached=1_000, cache_read=20_000,
                                                 cache_write=4_000)},
        {"api_request_id": "r2", "usage": _usage(uncached=500, cache_read=30_000,
                                                 cache_write=0)},
    ]
    result = _count(requests, responses)
    assert result["basis"] == "input_excluding_cache_reads"
    assert result["uncached_input_tokens"] == 1_500
    assert result["cache_write_tokens"] == 4_000
    assert result["excluded_cache_read_tokens"] == 50_000
    assert result["reserved_for_requests_without_usable_usage"] == 0
    assert result["input_excluding_cache_reads"] == 5_500
    assert result["settled_requests"] == 2


def test_ceiling_reserves_the_estimate_for_an_in_flight_request_then_settles_it():
    """An in-flight request reserves its estimate; settling replaces it with the real figure."""
    requests = [{"api_request_id": "r1", "approx_input_tokens": 25_000},
                {"api_request_id": "r2", "approx_input_tokens": 90_000}]
    settled_r1 = {"api_request_id": "r1",
                  "usage": _usage(uncached=1_000, cache_read=20_000, cache_write=4_000)}

    in_flight = _count(requests, [settled_r1])
    # r2 has no usage yet: reserved at its estimate, never zero.
    assert in_flight["reserved_request_ids"] == ["r2"]
    assert in_flight["reserved_for_requests_without_usable_usage"] == 90_000
    assert in_flight["input_excluding_cache_reads"] == 5_000 + 90_000

    settled = _count(requests, [settled_r1,
                                {"api_request_id": "r2",
                                 "usage": _usage(uncached=200, cache_read=88_000,
                                                 cache_write=100)}])
    assert settled["reserved_request_ids"] == []
    assert settled["input_excluding_cache_reads"] == 5_000 + 300
    # Settling LOWERS the figure, so a final value cannot prove the ceiling was never reached.
    assert settled["input_excluding_cache_reads"] < in_flight["input_excluding_cache_reads"]


def test_ceiling_counts_agreeing_duplicate_usage_once():
    """Duplicate response rows that agree describe one request, not two."""
    requests = [{"api_request_id": "r1", "approx_input_tokens": 25_000}]
    row = {"api_request_id": "r1",
           "usage": _usage(uncached=1_000, cache_read=20_000, cache_write=4_000)}
    result = _count(requests, [row, dict(row)])
    assert result["settled_requests"] == 1
    assert result["input_excluding_cache_reads"] == 5_000
    assert result["conflicting_response_ids"] == []


def test_ceiling_reserves_rather_than_guesses_when_duplicate_usage_conflicts():
    """Conflicting duplicates are unusable: reserve the estimate instead of picking one."""
    requests = [{"api_request_id": "r1", "approx_input_tokens": 25_000}]
    responses = [
        {"api_request_id": "r1", "usage": _usage(uncached=1_000, cache_read=20_000,
                                                 cache_write=4_000)},
        {"api_request_id": "r1", "usage": _usage(uncached=7_000, cache_read=20_000,
                                                 cache_write=4_000)},
    ]
    result = _count(requests, responses)
    assert result["conflicting_response_ids"] == ["r1"]
    assert result["settled_requests"] == 0
    assert result["reserved_request_ids"] == ["r1"]
    assert result["input_excluding_cache_reads"] == 25_000


def test_ceiling_counts_unknown_response_ids_and_reports_them():
    """A response whose id was never recorded as a request is real work: count and surface it."""
    requests = [{"api_request_id": "r1", "approx_input_tokens": 25_000}]
    responses = [
        {"api_request_id": "r1", "usage": _usage(uncached=1_000, cache_read=20_000,
                                                 cache_write=4_000)},
        {"api_request_id": "ghost", "usage": _usage(uncached=600, cache_read=0,
                                                    cache_write=40)},
        {"usage": _usage(uncached=1, cache_read=0, cache_write=0)},
    ]
    result = _count(requests, responses)
    assert result["unmatched_response_ids"] == ["ghost"]
    assert result["unkeyed_response_rows"] == 1
    assert result["input_excluding_cache_reads"] == 5_000 + 640
    assert result["accounting_complete"] is False


def test_ceiling_reserves_the_estimate_when_usage_is_invalid():
    """Invalid usage must not silently read as zero input."""
    requests = [{"api_request_id": "r1", "approx_input_tokens": 25_000}]
    bad = {"api_request_id": "r1",
           "usage": {"prompt_tokens": 10, "output_tokens": 1,
                     "cache_read_tokens": 999, "input_tokens": 0,
                     "cache_write_tokens": 0, "total_tokens": 11}}
    result = _count(requests, [bad])
    assert result["settled_requests"] == 0
    assert result["input_excluding_cache_reads"] == 25_000


@pytest.mark.parametrize("requests,responses,expected,complete", [
    pytest.param(
        [{"api_request_id": "r1", "approx_input_tokens": 25_000}],
        [{"api_request_id": "r1", "usage": {
            "prompt_tokens": 25_000, "input_tokens": 1_000,
            "cache_read_tokens": 20_000, "output_tokens": 10,
            "total_tokens": 25_010,
        }}], 25_000, True, id="missing_cache_write_reserves_estimate",
    ),
    pytest.param(
        [{"api_request_id": "r1"}], [], 0, False,
        id="missing_estimate_is_unknown",
    ),
    pytest.param(
        [{"approx_input_tokens": 25_000}], [], 25_000, False,
        id="unkeyed_request_retains_estimate_but_is_incomplete",
    ),
    pytest.param(
        [], [{"usage": _usage(uncached=50, cache_read=0, cache_write=0)}],
        0, False, id="unkeyed_response_is_incomplete",
    ),
    pytest.param(
        [], [
            {"api_request_id": "ghost",
             "usage": _usage(uncached=10, cache_read=0, cache_write=0)},
            {"api_request_id": "ghost",
             "usage": _usage(uncached=20, cache_read=0, cache_write=0)},
        ], 0, False, id="unknown_conflicting_usage_has_no_reservation",
    ),
    pytest.param(
        [], [{"api_request_id": "ghost", "usage": {
            "prompt_tokens": 10, "input_tokens": 0, "cache_read_tokens": 999,
            "cache_write_tokens": 0, "output_tokens": 1, "total_tokens": 11,
        }}], 0, False, id="unknown_invalid_usage_has_no_reservation",
    ),
    pytest.param(
        [], [{"api_request_id": "ghost", "usage": None}],
        0, False, id="unknown_missing_usage_has_no_reservation",
    ),
    pytest.param(
        [{"api_request_id": "r1", "approx_input_tokens": 25_000},
         {"api_request_id": "r1", "approx_input_tokens": 5_000}],
        [], 25_000, True, id="duplicate_estimate_keeps_larger_first_value",
    ),
    pytest.param(
        [{"api_request_id": "r1", "approx_input_tokens": 5_000},
         {"api_request_id": "r1", "approx_input_tokens": 25_000}],
        [], 25_000, True, id="duplicate_estimate_keeps_larger_last_value",
    ),
    pytest.param(
        [{"api_request_id": "r1", "approx_input_tokens": 25_000},
         {"api_request_id": "r1"}],
        [], 25_000, True, id="missing_duplicate_estimate_cannot_erase_reservation",
    ),
    pytest.param(
        [{"api_request_id": "r1", "approx_input_tokens": 25_000}],
        [{"api_request_id": "r1",
          "usage": _usage(uncached=0, cache_read=0, cache_write=0)}],
        0, True, id="complete_zero_usage_is_valid",
    ),
    pytest.param(
        [{"api_request_id": "r1", "approx_input_tokens": 0}],
        [], 0, True, id="explicit_zero_estimate_is_valid",
    ),
])
def test_ceiling_counter_preserves_evidence_when_usage_is_unusable(
    requests, responses, expected, complete,
):
    """Unknown accounting cannot pass as zero; reservations survive duplicate observations."""
    result = _count(requests, responses)
    assert result["input_excluding_cache_reads"] == expected
    assert result["accounting_complete"] is complete


@pytest.mark.parametrize("has_estimate", [True, False], ids=["crossing", "incomplete"])
def test_ceiling_observation_latches_a_stop_and_keeps_its_snapshot(has_estimate):
    """Later usable usage cannot undo a stop or rewrite earlier observation counts."""
    requests = [{"api_request_id": "r1"}]
    if has_estimate:
        requests[0]["approx_input_tokens"] = 25_000
    responses, observations = [], []
    first = convergence.observe_input_ceiling(
        requests, responses, observations, limit=25_000, phase="pre_request",
        api_request_id="r1", seconds=1.0,
    )
    assert first["value"] == (25_000 if has_estimate else 0)
    assert first["crossed"] is has_estimate
    assert first["accounting_complete"] is has_estimate
    assert first["stop_required"] is True

    responses.append({"api_request_id": "r1",
                      "usage": _usage(uncached=100, cache_read=20_000, cache_write=20)})
    settled = convergence.observe_input_ceiling(
        requests, responses, observations, limit=25_000, phase="post_request",
        api_request_id="r1", seconds=2.0,
    )
    assert settled["value"] == 120
    assert settled["crossed"] is False
    assert settled["accounting_complete"] is True
    assert settled["stop_required"] is True

    requests.append({"api_request_id": "r2", "approx_input_tokens": 5_000})
    assert observations == [first, settled]
    assert first["requests_recorded"] == settled["requests_recorded"] == 1
    assert first["value"] == (25_000 if has_estimate else 0)


def test_real_harness_hooks_observe_the_request_limit_and_unknown_accounting(tmp_path):
    """The wired hooks publish their snapshots even when another stop already applies."""
    repo = Path(__file__).resolve().parents[2]
    script = r'''
import json
import os
from pathlib import Path
import runpy
import sys
import traceback

repo, output = map(Path, sys.argv[1:])
harness = repo / "evals/ultra_delegation/harness.py"
sys.path.insert(0, str(harness.parent))
sys.argv = [str(harness), "large", "--review-skill=none", "--budget=0",
            f"--output-root={output}", "--name=hook-probe"]
real_exit = os._exit

def finish_probe(status):
    if status not in (0, 2):
        real_exit(status)
    runtime = sys._getframe(1).f_globals
    try:
        with runtime["log_lock"]:
            for name in ("requests", "responses", "input_ceiling_observations", "caps"):
                runtime[name].clear()
            runtime["cap_event"].clear()
            runtime["request_limit"] = 2
            runtime["input_limit"] = 2_000_000
            runtime["pre_request"](api_request_id="probe:1", approx_input_tokens=25_000)
            runtime["pre_request"](api_request_id="probe:2", approx_input_tokens=5_000)
            at_request_limit = list(runtime["input_ceiling_observations"])
            limit_caps = list(runtime["caps"])
            limit_stopped = runtime["cap_event"].is_set()

            for name in ("requests", "responses", "input_ceiling_observations", "caps"):
                runtime[name].clear()
            runtime["cap_event"].clear()
            runtime["request_limit"] = 64
            runtime["pre_request"](api_request_id="probe:missing-estimate")
            receipt = {"offline_stop": runtime["report"]["stop_reason"],
                       "at_request_limit": at_request_limit,
                       "limit_caps": limit_caps, "limit_stopped": limit_stopped,
                       "incomplete": runtime["input_ceiling_observations"][-1],
                       "incomplete_caps": list(runtime["caps"]),
                       "incomplete_stopped": runtime["cap_event"].is_set()}
        print("HOOK_PROBE:" + json.dumps(receipt), file=sys.__stdout__, flush=True)
        real_exit(0)
    except BaseException:
        traceback.print_exc(file=sys.__stderr__)
        real_exit(1)

os._exit = finish_probe
runpy.run_path(str(harness), run_name="__main__")
'''
    completed = subprocess.run(
        [sys.executable, "-c", script, str(repo), str(tmp_path)],
        cwd=repo, text=True, capture_output=True, timeout=60,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    receipts = [json.loads(line.removeprefix("HOOK_PROBE:"))
                for line in completed.stdout.splitlines() if line.startswith("HOOK_PROBE:")]
    assert len(receipts) == 1, completed.stdout + completed.stderr
    receipt = receipts[0]
    assert receipt["offline_stop"] == "timeout"
    assert [(row["api_request_id"], row["requests_recorded"], row["value"])
            for row in receipt["at_request_limit"]] == [
        ("probe:1", 1, 25_000), ("probe:2", 2, 30_000),
    ]
    assert receipt["limit_stopped"] is True
    assert "aggregate_request_or_input_threshold" in receipt["limit_caps"]
    assert receipt["incomplete"]["accounting_complete"] is False
    assert receipt["incomplete"]["stop_required"] is True
    assert receipt["incomplete"]["requests_recorded"] == 1
    assert receipt["incomplete_caps"] == ["input_accounting_incomplete"]
    assert receipt["incomplete_stopped"] is True


def test_report_names_the_basis_and_records_peak_and_first_crossing(tmp_path):
    """The report must state the policy and let a reader see whether the ceiling was reached."""
    report = _run_offline_harness(tmp_path, ["--budget=60"])
    accounting = report["input_accounting"]
    assert accounting["basis"] == "input_excluding_cache_reads"
    assert accounting["policy"] == "acceptance_policy_change"
    assert report["limits"]["cumulative_input_basis"] == "input_excluding_cache_reads"
    assert "not comparable" in report["limits"]["cumulative_input_policy"]
    # Superseded basis stays recorded, and is labelled as superseded rather than wrong.
    assert accounting["superseded_basis"] == "approx_represented_input"
    assert isinstance(accounting["approx_represented_input"], int)
    # Non-monotonic value: a final figure alone cannot settle whether the limit was hit.
    assert accounting["ever_crossed"] is False
    assert accounting["first_crossing"] is None
    assert accounting["peak_value"] >= accounting["final_value"]
    assert accounting["observations"] >= 1
    assert report["stop_reason"] == "normal_final"


def test_aggregate_input_ceiling_still_fires_on_the_new_basis(tmp_path):
    """Relaxing the basis must not remove the stop: a tiny ceiling still interrupts."""
    report = _run_offline_harness(tmp_path, ["--budget=60", "--input-cap=1"])
    assert report["stop_reason"] == "token_request_cap"
    assert "aggregate_request_or_input_threshold" in report["caps"]
    accounting = report["input_accounting"]
    assert accounting["ever_crossed"] is True
    assert accounting["first_crossing"]["value"] >= 1
    assert accounting["peak_value"] >= 1


@pytest.mark.parametrize("option,config_path,value", [
    ("--file-read-max-chars=40000", ("file_read_max_chars",), 40_000),
    ("--child-compression-threshold-tokens=96000", ("delegation", "compression_threshold_tokens"), 96_000),
    ("--child-reasoning-effort=high", ("delegation", "reasoning_effort"), "high"),
])
def test_context_candidate_preserves_task_and_aggregate_limits(tmp_path, option, config_path, value):
    """Existing context settings never quietly weaken the acceptance contract."""
    baseline = _run_offline_harness(tmp_path / "baseline", ["--budget=60"])
    candidate = _run_offline_harness(
        tmp_path / "candidate", ["--budget=60", option],
    )
    candidate_config, baseline_config = candidate["config"], baseline["config"]
    for key in config_path[:-1]:
        candidate_config, baseline_config = candidate_config[key], baseline_config[key]
    assert candidate_config[config_path[-1]] == value
    assert config_path[-1] not in baseline_config
    del candidate_config[config_path[-1]]
    candidate["config"]["terminal"]["cwd"] = baseline["config"]["terminal"]["cwd"]
    assert candidate["config"] == baseline["config"]
    assert candidate["limits"] == baseline["limits"]
    assert candidate["fixture_hashes"] == baseline["fixture_hashes"]
    assert candidate["review_skill_hashes"] == baseline["review_skill_hashes"]
    assert candidate["prompt"].replace(candidate["execution_workspace"], "<workspace>") == (
        baseline["prompt"].replace(baseline["execution_workspace"], "<workspace>")
    )
    assert candidate["stop_reason"] == baseline["stop_reason"] == "normal_final"
    assert candidate["completion_guard"]["eligible"] is True

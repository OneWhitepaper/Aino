"""Real harness stop causes, observer hooks and input ceilings."""
import json
from pathlib import Path
import subprocess
import sys
import pytest
from evals.ultra_delegation import convergence
from tests.evals.ultra_delegation_harness_fixture import _run_offline_harness


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



@pytest.mark.parametrize("input_cap", [1_000_000, 2_000_000, 3_000_000],
                         ids=["lower", "same", "higher"])
def test_explicit_input_cap_never_claims_original_acceptance(tmp_path, input_cap):
    """Any explicit override is diagnostic, independently of observed delivery."""
    skill = tmp_path / "review-skill"
    skill.mkdir()
    (skill / "SKILL.md").write_text(
        "---\nname: read-only-source-review\ndescription: Local review fixture\n---\n"
        "Inspect only the requested source files.\n", encoding="utf-8",
    )
    report = _run_offline_harness(tmp_path / "run", [
        "--review-skill=original", f"--review-skill-path={skill}",
        "--budget=0", f"--input-cap={input_cap}",
    ])
    assert report["limits"]["scenario_ceiling_overridden"] is True
    assert report["limits"]["approx_cumulative_input"] == input_cap
    assert report["input_accounting"]["limit"] == input_cap
    assert report["diagnostic"]["original_acceptance_eligible"] is False
    summary = convergence.summarize(report)
    assert summary["diagnostic"]["original_acceptance_eligible"] is False
    assert summary["natural_delivery"] is False
    # Changing historical eligibility cannot manufacture a missing final answer.
    report["diagnostic"]["original_acceptance_eligible"] = True
    assert convergence.summarize(report)["natural_delivery"] is False


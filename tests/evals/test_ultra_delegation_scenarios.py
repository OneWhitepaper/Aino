"""Task and skill variants preserve provenance and reject invalid combinations."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import pytest
from evals.ultra_delegation import convergence
from tests.evals.ultra_delegation_harness_fixture import _run_offline_harness


@pytest.mark.parametrize("review_skill", ["original", "none"])
def test_large_report_length_only_removes_the_limit_and_preserves_diagnostic_provenance(
    tmp_path, review_skill,
):
    """An unbounded report is a changed task, including when its parent is replayed."""
    skill = tmp_path / "review-skill"
    (skill / "references").mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\nname: read-only-source-review\ndescription: Local review fixture\n---\n"
        "Inspect only the requested source files.\n", encoding="utf-8",
    )
    (skill / "references/evidence-rating.md").write_text("Keep uncertain claims separate.\n", encoding="utf-8")
    options = ["--budget=60", f"--review-skill={review_skill}"]
    if review_skill == "original":
        options.append(f"--review-skill-path={skill}")
    baseline = _run_offline_harness(tmp_path / "baseline", options)
    candidate_root = tmp_path / "candidate"
    candidate = _run_offline_harness(candidate_root, [*options, "--large-report-length=unbounded"])

    baseline_prompt = baseline["prompt"].replace(baseline["execution_workspace"], "<workspace>")
    candidate_prompt = candidate["prompt"].replace(candidate["execution_workspace"], "<workspace>")
    length_instruction = "每组结论控制在400字以内。"
    assert length_instruction in baseline_prompt
    assert candidate_prompt == baseline_prompt.replace(length_instruction, "", 1)
    assert next(row["content"] for row in candidate["db_messages"]
                if row["session_id"] == candidate["stored_session_id"] and row["role"] == "user") == candidate["prompt"]
    candidate["config"]["terminal"]["cwd"] = baseline["config"]["terminal"]["cwd"]
    for key in ("config", "limits", "fixture_hashes", "review_skill_hashes"):
        assert candidate[key] == baseline[key]
    assert candidate["fixture_changed"] == baseline["fixture_changed"] == []
    assert baseline["diagnostic"]["large_report_length"] == "original"
    assert baseline["diagnostic"]["original_acceptance_eligible"] is (review_skill == "original")
    assert candidate["diagnostic"]["large_report_length"] == "unbounded"
    assert candidate["diagnostic"]["original_acceptance_eligible"] is False
    assert candidate["diagnostic"]["large_report_length_boundary"]
    summary = convergence.summarize(candidate)
    assert summary["diagnostic"] == candidate["diagnostic"]
    assert summary["natural_final"] is True
    assert summary["natural_delivery"] is True
    assert convergence.summarize({})["diagnostic"]["original_acceptance_eligible"] is None

    if review_skill == "original":
        replay = _run_offline_harness(
            tmp_path / "replay", ["--budget=60", "--review-skill=original",
                                  f"--review-skill-path={skill}",
                                  f"--legacy-replay-source={candidate_root / 'offline'}"], scenario="replay",
        )
        assert replay["prompt"] == candidate["prompt"]
        assert replay["diagnostic"]["large_report_length"] == "unbounded"
        assert replay["diagnostic"]["original_acceptance_eligible"] is False



@pytest.mark.parametrize("scenario,policy,options", [
    ("simple", "unbounded", []), ("no_subagent", "unbounded", []), ("length", "unbounded", []),
    ("daily", "unbounded", []), ("replay", "unbounded", []), ("daily_replay", "unbounded", []),
    ("large", "unknown", []),
    pytest.param("large", "unbounded",
                 ["--review-skill=none", "--matched-comparison", "--budget=0"],
                 id="conflicting-matched-comparison"),
    pytest.param("large", "unbounded",
                 ["--review-skill=none", "--matched-comparison", "--evidence-contract", "--budget=0"],
                 id="conflicting-evidence-contract"),
])
def test_large_report_length_rejects_other_tasks_before_creating_a_run(tmp_path, scenario, policy, options):
    repo = Path(__file__).resolve().parents[2]
    output = tmp_path / "runs"
    completed = subprocess.run(
        [sys.executable, str(repo / "evals/ultra_delegation/harness.py"), scenario,
         f"--large-report-length={policy}", *options, f"--output-root={output}"],
        cwd=repo, text=True, capture_output=True, timeout=10,
    )
    assert completed.returncode == 2
    assert "--large-report-length" in completed.stderr
    assert "unrecognized arguments" not in completed.stderr
    assert not output.exists()



@pytest.mark.parametrize("same_content", [False, True])
def test_review_skill_candidate_installs_exact_input_without_changing_task_or_limits(tmp_path, same_content):
    """Experimental instructions are installed and identified even after natural delivery."""
    skill = tmp_path / "external-review"
    (skill / "references").mkdir(parents=True)
    files = {
        "SKILL.md": "---\nname: read-only-source-review\ndescription: Review source evidence.\n---\nRead only the named snapshot.\n",
        "references/evidence-rating.md": "Separate facts, required conditions, and unproven effects.\n",
    }
    for name, text in files.items():
        (skill / name).write_text(text, encoding="utf-8")
    original = tmp_path / "original-review"
    (original / "references").mkdir(parents=True)
    original_files = {**files, "references/evidence-rating.md": (
        files["references/evidence-rating.md"] if same_content else "Keep uncertain claims separate.\n"
    )}
    for name, text in original_files.items():
        (original / name).write_text(text, encoding="utf-8")
    options = [f"--review-skill-path={skill}", "--budget=60"]
    baseline = _run_offline_harness(
        tmp_path / "baseline", ["--budget=60", "--review-skill=original", f"--review-skill-path={original}"],
    )
    candidate = _run_offline_harness(tmp_path / "candidate", [*options, "--review-skill=candidate"])
    installed = tmp_path / "candidate/offline/profile/skills/software-development/read-only-source-review"
    for name, text in files.items():
        assert (installed / name).read_text(encoding="utf-8") == text
    assert candidate["review_skill_hashes"] == {
        name: hashlib.sha256(text.encode()).hexdigest() for name, text in files.items()
    }
    assert baseline["review_skill_hashes"] == {
        name: hashlib.sha256(text.encode()).hexdigest() for name, text in original_files.items()
    }
    for name, text in original_files.items():
        assert (original / name).read_text(encoding="utf-8") == text
    candidate["config"]["terminal"]["cwd"] = baseline["config"]["terminal"]["cwd"]
    for key in ("config", "limits", "fixture_hashes"):
        assert candidate[key] == baseline[key]
    assert candidate["prompt"].replace(candidate["execution_workspace"], "<workspace>") == (
        baseline["prompt"].replace(baseline["execution_workspace"], "<workspace>")
    )
    assert candidate["fixture_changed"] == baseline["fixture_changed"] == []
    assert baseline["diagnostic"]["original_acceptance_eligible"] is True
    assert candidate["diagnostic"]["review_skill"] == "candidate"
    assert candidate["diagnostic"]["original_acceptance_eligible"] is False
    assert candidate["diagnostic"]["boundary"] != baseline["diagnostic"]["boundary"]
    summary = convergence.summarize(candidate)
    assert summary["diagnostic"] == candidate["diagnostic"]
    assert summary["natural_delivery"] is True



@pytest.mark.parametrize("scenario,options,source_kind", [
    ("large", ["--review-skill=candidate"], None),
    ("simple", ["--review-skill=candidate"], None),
    ("large", ["--review-skill=candidate", "--driver=codex"], None),
    ("large", ["--review-skill=candidate", "--matched-comparison"], None),
    ("replay", [], "--replay-source"),
    ("replay", [], "--legacy-replay-source"),
    ("length", [], "--length-source"),
])
def test_review_skill_candidate_rejects_unsupported_paths_before_creating_a_run(
    tmp_path, scenario, options, source_kind,
):
    """Neither explicit nor inherited candidate instructions may become original acceptance."""
    repo = Path(__file__).resolve().parents[2]
    output = tmp_path / "runs"
    if source_kind:
        source = tmp_path / "saved-candidate"
        source.mkdir()
        report_path = source / "report.json"
        report_path.write_text(json.dumps({
            "diagnostic": {"review_skill": "candidate", "original_acceptance_eligible": False},
        }), encoding="utf-8")
        source_path = report_path if source_kind == "--length-source" else source
        options = [*options, f"{source_kind}={source_path}"]
    completed = subprocess.run(
        [sys.executable, str(repo / "evals/ultra_delegation/harness.py"), scenario,
         *options, f"--output-root={output}"],
        cwd=repo, text=True, capture_output=True, timeout=10,
    )
    assert completed.returncode == 2
    assert "candidate" in completed.stderr
    assert "invalid choice" not in completed.stderr
    assert "Traceback" not in completed.stderr
    assert not output.exists()


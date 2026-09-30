"""Existing context and budget settings preserve unrelated task contracts."""
import pytest
from evals.ultra_delegation import convergence
from tests.evals.ultra_delegation_harness_fixture import _run_offline_harness


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



@pytest.mark.parametrize("seconds,spend", [(3600, 5), (1200, 10)])
def test_extended_budget_is_reported_without_weakening_other_limits(tmp_path, seconds, spend):
    """Longer or more expensive runs cannot pass the historical budget contract."""
    skill = tmp_path / "review-skill"
    skill.mkdir()
    (skill / "SKILL.md").write_text(
        "---\nname: read-only-source-review\ndescription: Local review fixture\n---\n"
        "Inspect only the requested source files.\n", encoding="utf-8",
    )
    options = ["--review-skill=original", f"--review-skill-path={skill}"]
    baseline = _run_offline_harness(tmp_path / "baseline", [*options, "--budget=1200", "--spend-target=5"])
    candidate = _run_offline_harness(
        tmp_path / "candidate", [*options, f"--budget={seconds}", f"--spend-target={spend}"],
    )
    assert baseline["diagnostic"]["original_acceptance_eligible"] is True
    assert candidate["diagnostic"]["original_acceptance_eligible"] is False
    policy = candidate["diagnostic"]["extended_budget"]
    assert policy["seconds_extended"] is (seconds > 1200)
    assert policy["spend_target_raised"] is (spend > 5)
    assert policy["reference_seconds"] == baseline["limits"]["seconds"]
    assert policy["reference_spend_target_usd"] == baseline["budget_target_usd"]
    assert candidate["limits"]["seconds"] == seconds
    assert candidate["limits"]["observed_spend_target_usd"] == spend
    candidate["limits"]["seconds"] = baseline["limits"]["seconds"]
    candidate["limits"]["observed_spend_target_usd"] = baseline["limits"]["observed_spend_target_usd"]
    assert candidate["limits"] == baseline["limits"]
    candidate["config"]["terminal"]["cwd"] = baseline["config"]["terminal"]["cwd"]
    for key in ("config", "fixture_hashes", "review_skill_hashes"):
        assert candidate[key] == baseline[key]
    assert candidate["prompt"].replace(candidate["execution_workspace"], "<workspace>") == (
        baseline["prompt"].replace(baseline["execution_workspace"], "<workspace>")
    )
    assert candidate["stop_reason"] == "normal_final"
    summary = convergence.summarize(candidate)
    assert summary["natural_delivery"] is True
    assert summary["diagnostic"]["original_acceptance_eligible"] is False


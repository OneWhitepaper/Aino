"""Candidate re-smoke consumes only the exact already-built archive."""
import os
import subprocess

import pytest

from scripts.ci.native_candidate_artifact import validate_artifact
from tests.ci.desktop_release_roles import evaluate, gate
from tests.ci.test_desktop_bundle_smoke import smoke_workflow


def test_candidate_identity_requires_run_commit_architecture_and_archive_digest():
    commit, digest = "a" * 40, "b" * 64
    options = dict(artifact_id="17", run="23", commit=commit, target="linux-arm64", digest=digest)
    metadata = dict(id=17, name=f"aino-unverified-linux-arm64-{commit}", expired=False,
                    digest=f"sha256:{digest}", workflow_run=dict(id=23, head_sha=commit))
    validate_artifact(metadata, **options)
    for key, value in (("artifact_id", "18"), ("run", "24"), ("commit", "c" * 40),
                       ("target", "linux-x64"), ("digest", "d" * 64)):
        with pytest.raises(ValueError):
            validate_artifact(metadata, **{**options, key: value})
    with pytest.raises(ValueError):
        validate_artifact({**metadata, "expired": True}, **options)


def test_resmoke_admission_selects_one_source_and_requires_both_sandboxed_launches():
    jobs = smoke_workflow()["jobs"]
    (candidate,) = [job for job in jobs.values() if "inputs.artifact-id != ''" in job.get("if", "")]
    for artifact in ("", "17"):
        inputs = {"artifact-id": artifact}
        assert gate(candidate["if"], inputs, {}, github={"event_name": "workflow_dispatch"}) == bool(artifact)
        assert gate(jobs["validate"]["if"], inputs, {}) != bool(artifact)
        assert not gate(candidate["if"], inputs, {}, github={"event_name": "workflow_call"})
    for arch, runner in (("x64", "ubuntu-24.04"), ("arm64", "ubuntu-24.04-arm")):
        assert evaluate(candidate["runs-on"], {"arch": arch}, {}) == runner
    (verdict,) = [step for step in candidate["steps"] if set(step.get("env", {})) == {"DIRECT", "EXTRACTED"}]
    assert gate(verdict["if"], {}, {}, failed=True, job_if=False)
    for direct in ("success", "failure", "skipped", ""):
        for extracted in ("success", "failure", "skipped", ""):
            outcome = subprocess.run(["bash", "-c", verdict["run"]],
                                     env={**os.environ, "DIRECT": direct, "EXTRACTED": extracted},
                                     check=False, timeout=5)
            assert (outcome.returncode == 0) == (direct == extracted == "success")

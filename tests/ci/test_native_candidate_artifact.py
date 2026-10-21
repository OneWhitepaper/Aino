"""Candidate re-smoke consumes only the exact already-built archive."""
import os
import json
import subprocess
import sys

import pytest

from scripts.ci.native_candidate_artifact import validate_artifact
from tests.ci.desktop_release_roles import evaluate, gate
from tests.ci.test_desktop_bundle_smoke import smoke_workflow
from tests.ci.test_desktop_release_tag_admission import _workflow


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


def test_reusable_smoke_callers_grant_required_artifact_read_permission():
    for job in _workflow()["jobs"].values():
        if job.get("uses") == "./.github/workflows/desktop-bundle-smoke.yml":
            assert job["permissions"]["actions"] == "read"


@pytest.mark.parametrize("tag", ["", "v0.1.0"])
def test_resmoke_checks_the_packaged_product_identity_for_tags_and_commits(tmp_path, tag):
    from pm.store import current_target
    commit = "a" * 40
    install = tmp_path / "install"
    root = install / "resources/agent-payload"
    root.mkdir(parents=True)
    python = root / "python"
    python.symlink_to(sys.executable)
    (root / "manifest.json").write_text(json.dumps({"runtime": {"storePython": "python"}}))
    env = {**os.environ, "HERMES_DESKTOP_VARIANT": "bundled", "HERMES_PAYLOAD_TAG": tag,
           "HERMES_BUILD_COMMIT": "" if tag else commit, "_HERMES_CHANNEL_REQUEST_JSON": ""}
    name = subprocess.check_output(["node", "-e",
        "console.log(require('./apps/desktop/product-identity.cjs').displayName)"],
        env=env, text=True, encoding="utf-8", timeout=10).strip()
    (install / name).symlink_to(sys.executable)
    artifact = tmp_path / "fixture.AppImage"
    artifact.write_bytes(b"identity audit fixture")
    (tmp_path / "candidate-proof").mkdir()
    (tmp_path / "candidate-download").mkdir()
    (tmp_path / "candidate-download/source-artifact.json").write_text("{}")
    # Run the audit's Python block; stamp validation is independently covered.
    job = smoke_workflow()["jobs"]["native-candidate"]
    step = next(step for step in job["steps"] if step.get("name") == "Verify product identity architecture and provenance")
    script = step["run"].split("PYCODE", 2)[1].removeprefix("'\n")
    env.update(EXPECTED_COMMIT=commit, EXPECTED_TARGET=current_target(), RELEASE_TAG=tag,
               CANDIDATE_ROOT=str(root), CANDIDATE_INSTALL=str(install), CANDIDATE_APPIMAGE=str(artifact),
               RUNNER_TEMP=str(tmp_path), GITHUB_ENV=str(tmp_path / "env"))
    subprocess.run([sys.executable, "-c", script], env=env, check=True, timeout=15)
    assert f"CANDIDATE_EXE={install / name}" in (tmp_path / "env").read_text()

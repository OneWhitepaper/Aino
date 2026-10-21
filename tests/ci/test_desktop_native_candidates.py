"""Native candidates never enter signing/publication and keep x64 dispatch compatibility."""

from tests.ci.desktop_release_roles import evaluate, gate
from tests.ci.test_desktop_release_tag_admission import _workflow


def candidate_job():
    return next(job for job in _workflow()["jobs"].values()
                if "inputs.unsigned_windows_zip == true" in job.get("if", ""))


def test_candidate_selection_runs_each_requested_architecture_on_its_native_host():
    workflow = _workflow()
    selector = workflow.get("on", workflow.get(True))["workflow_dispatch"]["inputs"]["candidate_target"]
    job = candidate_job()
    native_runners = {
        "win32-x64": "windows-latest", "win32-arm64": "windows-11-arm",
        "linux-x64": "ubuntu-24.04", "linux-arm64": "ubuntu-24.04-arm",
        "darwin-x64": "macos-15-intel",
    }
    assert selector["default"] == "win32-x64"
    for target in selector["options"]:
        selected = evaluate(job["strategy"]["matrix"]["target"], {"candidate_target": target}, {})
        expected = native_runners if target == "all" else {target: native_runners[target]}
        assert {row["label"]: row["runner"] for row in selected} == expected
        assert all(row["label"] == f'{row["platform"]}-{row["arch"]}' for row in selected)
    legacy = evaluate(job["strategy"]["matrix"]["target"], {}, {})
    assert [row["label"] for row in legacy] == [selector["default"]]
    assert job["runs-on"] == "${{ matrix.target.runner }}"
    assert job["strategy"]["fail-fast"] is False


def test_candidate_upload_cannot_label_failed_smoke_or_unsigned_macos_as_verified():
    job = candidate_job()
    uploads = [step for step in job["steps"] if "upload-artifact@" in step.get("uses", "")]
    unverified = [step for step in uploads if "unverified" in step["with"]["name"]]
    verified = [step for step in uploads if step.get("id") == "verified"]
    assert unverified and len(verified) == 1
    assert all(gate(step.get("if", "success()"), {}, {}, failed=True, job_if=False) for step in unverified)
    expression = verified[0]["if"].replace("matrix.target.platform", "env.platform")
    for platform in ("win32", "linux", "darwin"):
        assert gate(expression, {}, {}, env={"platform": platform}, job_if=False) == (platform != "darwin")
        assert not gate(expression, {}, {}, env={"platform": platform}, failed=True, job_if=False)

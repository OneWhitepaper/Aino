"""Public receipts-only execution is an explicit hosted feature-branch capability."""
from __future__ import annotations

import json

import pytest

from scripts.ci import windows_installer_candidate as candidate


def public_workflow(event_name="push"):
    env = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": event_name,
           "RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_OS": "Windows",
           "GITHUB_REPOSITORY": "OneWhitepaper/Aino", "GITHUB_SHA": "a" * 40,
           "GITHUB_REF": "refs/heads/validation/windows-installer-public/receipts"}
    event = {"repository": {"private": False, "full_name": env["GITHUB_REPOSITORY"]},
             "inputs": {"public-receipts-only": "true"}}
    return env, event


@pytest.mark.parametrize("event_name", ["push", "workflow_dispatch"])
def test_public_receipts_admission_accepts_only_explicit_public_hosted_feature_branch(event_name):
    env, event = public_workflow(event_name)
    assert candidate.admit(env, event, public_receipts_only=True) == env["GITHUB_SHA"]
    with pytest.raises(ValueError):
        candidate.admit(env, event)


@pytest.mark.parametrize("key,value", [
    ("GITHUB_ACTIONS", "false"), ("RUNNER_ENVIRONMENT", "self-hosted"),
    ("RUNNER_OS", "Linux"), ("GITHUB_SHA", "main"),
    ("GITHUB_EVENT_NAME", "pull_request"), ("GITHUB_REF", "refs/heads/main"),
    ("GITHUB_REF", "refs/heads/validation/windows-installer/ordinary-private-prefix"),
    ("GITHUB_REF", "refs/tags/validation/windows-installer-public/tag"),
    ("GITHUB_REPOSITORY", "fork/Aino"),
])
def test_public_receipts_admission_rejects_other_hosts_events_refs_and_repositories(key, value):
    env, event = public_workflow()
    with pytest.raises(ValueError):
        candidate.admit({**env, key: value}, event, public_receipts_only=True)


@pytest.mark.parametrize("opt_in", [None, False, "false", "", 1])
def test_public_manual_dispatch_requires_its_input_as_well_as_cli_mode(opt_in):
    env, event = public_workflow("workflow_dispatch")
    event["inputs"] = {"public-receipts-only": opt_in}
    with pytest.raises(ValueError):
        candidate.admit(env, event, public_receipts_only=True)


def test_public_receipts_mode_rejects_private_or_mismatched_repository_claims():
    env, event = public_workflow()
    event["repository"]["private"] = True
    with pytest.raises(ValueError):
        candidate.admit(env, event, public_receipts_only=True)
    event["repository"] = {"private": False, "full_name": "fork/Aino"}
    with pytest.raises(ValueError):
        candidate.admit({**env, "GITHUB_REPOSITORY": "fork/Aino"}, event, public_receipts_only=True)


@pytest.mark.parametrize("public_mode", [False, True])
def test_prerequisite_api_confirmation_matches_the_admitted_repository_visibility(tmp_path, monkeypatch, public_mode):
    env, _ = public_workflow()
    native_calls = []
    monkeypatch.setattr(candidate, "powershell", lambda *_args: native_calls.append("native"))
    monkeypatch.setattr(candidate, "run", lambda *_args: json.dumps({"isPrivate": not public_mode, "nameWithOwner": env["GITHUB_REPOSITORY"]}))
    candidate.check_prerequisites(env, tmp_path, public_receipts_only=public_mode)
    assert native_calls == ["native"]
    native_calls.clear()
    monkeypatch.setattr(candidate, "run", lambda *_args: json.dumps({"isPrivate": public_mode, "nameWithOwner": env["GITHUB_REPOSITORY"]}))
    with pytest.raises(ValueError):
        candidate.check_prerequisites(env, tmp_path, public_receipts_only=public_mode)
    assert native_calls == []


@pytest.mark.parametrize("reuse_input", ["reuse-run-id", "reuse-artifact-id", "reuse-source-commit"])
def test_public_mode_never_reuses_private_artifacts(reuse_input):
    env, event = public_workflow("workflow_dispatch")
    event["inputs"][reuse_input] = "pinned-private-input"
    with pytest.raises(ValueError):
        candidate.admit(env, event, public_receipts_only=True)


def test_public_collection_cli_writes_only_pinned_receipts_with_native_missing(tmp_path, monkeypatch):
    import sys

    env, event = public_workflow()
    event_path = tmp_path / "event.json"
    event_path.write_text(json.dumps(event), encoding="utf-8")
    for key, value in {**env, "GITHUB_EVENT_PATH": str(event_path), "RUNNER_TEMP": str(tmp_path)}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(sys, "argv", ["candidate", "--public-receipts-only", "--collect-public-receipts", "--arch", "arm64"])
    candidate.main()
    output = tmp_path / "aino-windows-public-receipts/receipts.json"
    receipt = json.loads(output.read_text(encoding="utf-8"))
    assert receipt["sourceCommit"] == env["GITHUB_SHA"]
    assert receipt["arch"] == "arm64"
    assert receipt["nativeAcceptance"] == {"document": "missing"}
    assert list(output.parent.iterdir()) == [output]


def test_public_collection_cli_rejects_non_opt_in_before_creating_any_output(tmp_path, monkeypatch):
    import sys

    env, event = public_workflow()
    env["GITHUB_REF"] = "refs/heads/main"
    event_path = tmp_path / "event.json"
    event_path.write_text(json.dumps(event), encoding="utf-8")
    for key, value in {**env, "GITHUB_EVENT_PATH": str(event_path), "RUNNER_TEMP": str(tmp_path)}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(sys, "argv", ["candidate", "--public-receipts-only", "--collect-public-receipts"])
    with pytest.raises(ValueError):
        candidate.main()
    assert not (tmp_path / "aino-windows-public-receipts").exists()

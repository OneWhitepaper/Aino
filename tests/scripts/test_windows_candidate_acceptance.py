"""The actual public collection CLI never upgrades partial receipts to acceptance."""
from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

SOURCE = "a" * 40
LEGACY = "22a472fcbca8775f56c0f89374027b8e4c68ab5b"
PROOF = "hermes-bundled-update/proof/"
CANDIDATE = "aino-windows-installer/"
ROOT = Path(__file__).resolve().parents[2]


def complete_proof(arch="x64"):
    """Non-sensitive fields from the existing candidate/native driver's receipts."""
    auth = {"authenticationPreservedWithoutLogin": True, "authenticatedProfileRequests": 2,
            "freshAuthenticationRequests": 0}
    preparation = {"ok": True, "scenario": "preparation-failure", "sameOldProcess": True,
                   "descriptorHttpStatus": 404, "proof": "preparation-failure/recovery.json"}
    cancellation = {"ok": True, "scenario": "os-cancel-manual-reopen", "installerCancellationObserved": True,
                    "oldVersionPreserved": True, "manualReopen": True, "automaticRecovery": False,
                    "proof": "cancel-reopen/manual-reopen/recovery.json"}
    migration = {"status": "passed", "tested": True, "releasedZipOpened": True,
                 "manualFirstMsixInstall": True, "sameUserData": True, "oldWrittenHistoryPreserved": True,
                 "extractedPayloadRemoved": True, "currentCodeSha": SOURCE, "legacyCodeSha": LEGACY}
    stamp = {"schemaVersion": 1, "commit": SOURCE, "tag": "v0.1.7", "payload": "bundled",
             "distribution": "desktop-app", "updateMechanism": "app-installer"}
    native = {"ok": True, "candidateOnly": True, "automaticRelaunch": True, "userStatePreserved": True,
              "oldVersion": "0.1.6.0", "newVersion": "0.1.7.0", "oldPid": 101, "newPid": 202,
              "oldBirth": "/Date(1794816000000)/", "newBirth": "/Date(1794816001000)/", "stamp": stamp}
    rows = {slot: {"platform": "windows", "arch": arch, "commit": SOURCE, "tag": tag,
                   "identity": "Aino.Agent", "publisher": "CN=Aino Installer Candidate fixture",
                   "applicationId": "Aino", "version": version, "artifact": {"sha256": digest * 64}}
            for slot, tag, version, digest in (("old", "v0.1.6", "0.1.6.0", "b"), ("new", "v0.1.7", "0.1.7.0", "c"))}
    docs = {
        CANDIDATE + "candidate-receipt.json": {"schema": 1, "candidateOnly": True, "testSigning": True,
            "sourceCommit": SOURCE, "arch": arch, "status": "accepted", "certificateCleanup": "removed"},
        CANDIDATE + "candidate-inputs.json": {"schema": 1, "platform": "windows", "arch": arch,
            "candidateOnly": True, "testSigning": True, **rows},
        CANDIDATE + "cleanup-receipt.json": {"candidateOnly": True, "testSigning": True, "certificateCleanup": "removed"},
        CANDIDATE + "runner-prerequisites.json": {"version": "10.0.26100", "productType": 1, "administrator": True},
        PROOF + "native-update-success.json": native,
        PROOF + "acceptance.json": {**deepcopy(native), "status": "accepted", "uninstallPreservedUserState": True,
            "recovery": {"preparation": preparation, "cancellation": cancellation}, "publishedZipMigration": migration},
        PROOF + "published-zip-migration.json": migration,
        PROOF + "preparation-failure/scenario-result.json": preparation,
        PROOF + "cancel-reopen/scenario-result.json": cancellation,
        PROOF + "preparation-failure/recovery.json": {"status": "passed", "scenario": "preparation-failure",
            "expectedCommit": SOURCE, "manualReopen": False, "automaticRecovery": False, "account": auth},
        PROOF + "cancel-reopen/manual-reopen/recovery.json": {"status": "passed", "scenario": "manual-old-reopen",
            "expectedCommit": SOURCE, "manualReopen": True, "automaticRecovery": False, "account": auth},
        PROOF + "cancel-reopen/cancel-click.json": {"ok": True, "exited": True, "appInstallerObserved": True,
            "appInstallerCancelled": True, "newVisibleWindow": True, "installerAction": "Cancel", "action": "cancel-button"},
        PROOF + "released-zip-artifact.json": {"status": "passed", "release": "v0.1.5", "commit": LEGACY,
            "arch": arch, "target": f"win32-{arch}"},
        PROOF + "automatic-new-workspace.json": {"status": "passed", "pid": 202,
            "startedAt": 1794816001000, "observedAt": 1794816002000, "owner": {"commit": SOURCE},
            "workspace": {"identity": {"commit": SOURCE, "platform": "win32"},
                          "account": {"phase": "signed_in", "userId": "17", "rememberState": "encrypted"}},
            "authentication": {**auth, "status": "passed", "phase": "automatic-new",
                               "startedAt": 1794816001000, "observedAt": 1794816002000}},
    }
    for phase in ("install", "preparation-failure", "update", "uninstall", "os-cancel", "cancel-manual-reopen"):
        docs[PROOF + f"user-state-after-{phase}.json"] = {"ok": True, "checked": 25, "missing": [], "changed": [], "unsafe": []}
    return docs


def collect_cli(tmp_path, documents, arch="x64"):
    for relative, value in documents.items():
        filename = tmp_path / relative
        filename.parent.mkdir(parents=True, exist_ok=True)
        filename.write_text(json.dumps(value), encoding="utf-16" if relative == PROOF + "acceptance.json" else "utf-8")
    event = tmp_path / "event.json"
    event.write_text(json.dumps({"repository": {"private": False, "full_name": "OneWhitepaper/Aino"}}), encoding="utf-8")
    env = {**os.environ, "GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "push", "RUNNER_ENVIRONMENT": "github-hosted",
           "RUNNER_OS": "Windows", "GITHUB_REPOSITORY": "OneWhitepaper/Aino", "GITHUB_SHA": SOURCE,
           "GITHUB_REF": "refs/heads/validation/windows-installer-public/receipt-contract",
           "GITHUB_EVENT_PATH": str(event), "RUNNER_TEMP": str(tmp_path)}
    subprocess.run([sys.executable, str(ROOT / "scripts/ci/windows_installer_candidate.py"), "--arch", arch,
                    "--public-receipts-only", "--collect-public-receipts"], cwd=ROOT, env=env, check=True, capture_output=True)
    return json.loads((tmp_path / "aino-windows-public-receipts/receipts.json").read_text(encoding="utf-8"))


def test_actual_cli_keeps_sparse_accepted_claims_unaccepted(tmp_path):
    result = collect_cli(tmp_path, {
        CANDIDATE + "candidate-receipt.json": complete_proof()[CANDIDATE + "candidate-receipt.json"],
        PROOF + "acceptance.json": {"status": "accepted"},
    })
    assert result["candidate"].get("status") != "accepted"
    assert result["nativeAcceptance"].get("status") != "accepted"
    assert result["status"] == "unaccepted"
    assert result["cleanup"]["document"] == "missing"


@pytest.mark.parametrize("arch", ["x64", "arm64"])
def test_actual_cli_accepts_complete_matching_native_proof_only(tmp_path, arch):
    result = collect_cli(tmp_path, complete_proof(arch), arch)
    assert result["status"] == "accepted"
    assert result["candidate"]["status"] == "accepted"
    assert result["nativeAcceptance"]["status"] == "accepted"
    assert all(result["acceptanceGates"].values())


@pytest.mark.parametrize("missing", [
    CANDIDATE + "candidate-inputs.json", CANDIDATE + "cleanup-receipt.json", CANDIDATE + "runner-prerequisites.json",
    PROOF + "native-update-success.json", PROOF + "published-zip-migration.json", PROOF + "automatic-new-workspace.json",
    PROOF + "preparation-failure/scenario-result.json", PROOF + "preparation-failure/recovery.json",
    PROOF + "cancel-reopen/scenario-result.json", PROOF + "cancel-reopen/manual-reopen/recovery.json",
    PROOF + "cancel-reopen/cancel-click.json", PROOF + "released-zip-artifact.json",
    PROOF + "user-state-after-uninstall.json",
])
def test_actual_cli_requires_each_supporting_receipt(tmp_path, missing):
    documents = complete_proof()
    del documents[missing]
    result = collect_cli(tmp_path, documents)
    assert result["status"] == "unaccepted"
    assert result["candidate"].get("status") != "accepted"
    assert result["nativeAcceptance"].get("status") != "accepted"


@pytest.mark.parametrize("filename,field,value", [
    ("acceptance.json", "stamp.commit", "d" * 40), ("acceptance.json", "automaticRelaunch", False),
    ("acceptance.json", "oldPid", 202), ("acceptance.json", "newVersion", "0.1.8.0"),
    ("acceptance.json", "recovery.cancellation.ok", False),
    ("acceptance.json", "stamp.schemaVersion", 2),
    ("native-update-success.json", "status", "failed"),
    ("automatic-new-workspace.json", "workspace.identity.commit", "d" * 40),
    ("automatic-new-workspace.json", "pid", 303),
    ("automatic-new-workspace.json", "authentication.freshAuthenticationRequests", 1),
    ("published-zip-migration.json", "currentCodeSha", "d" * 40),
    ("cancel-reopen/manual-reopen/recovery.json", "expectedCommit", "d" * 40),
    ("released-zip-artifact.json", "arch", "arm64"),
    ("user-state-after-uninstall.json", "ok", False),
    (CANDIDATE + "candidate-receipt.json", "arch", "arm64"),
    (CANDIDATE + "candidate-receipt.json", "error", "never-publish-this-error"),
    (CANDIDATE + "cleanup-receipt.json", "certificateCleanup", "not-created"),
])
def test_actual_cli_rejects_failed_or_uncorrelated_native_gates(tmp_path, filename, field, value):
    documents = complete_proof()
    row = documents[filename if filename.startswith(CANDIDATE) else PROOF + filename]
    for part in field.split(".")[:-1]:
        row = row[part]
    row[field.split(".")[-1]] = value
    result = collect_cli(tmp_path, documents)
    assert result["status"] == "unaccepted"
    assert result["candidate"].get("status") != "accepted"
    assert result["nativeAcceptance"].get("status") != "accepted"

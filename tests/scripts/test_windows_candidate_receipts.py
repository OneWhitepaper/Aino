"""Public evidence contains only typed acceptance facts, never source-file payloads."""
from __future__ import annotations

import json
import subprocess

import pytest

from scripts.ci.windows_candidate_receipts import export_public_receipts


SOURCE = "a" * 40
SECRET = "private-token-and-proxy-password-must-never-be-public"


def write_json(root, relative, value):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def test_export_retains_typed_native_facts_and_omits_secrets_and_entire_input_files(tmp_path):
    write_json(tmp_path, "aino-windows-installer/candidate-receipt.json", {
        "schema": 1, "candidateOnly": True, "testSigning": True,
        "sourceCommit": SOURCE, "arch": "x64", "status": "failed",
        "certificateCleanup": "removed", "error": SECRET,
    })
    rows = {slot: {"commit": SOURCE, "platform": "windows", "arch": "x64",
                   "tag": tag, "version": version, "identity": SECRET,
                   "artifact": {"sha256": digest * 64, "path": SECRET, "url": SECRET}}
            for slot, tag, version, digest in (("old", "v0.1.6", "2026.1.1.0", "b"),
                                                ("new", "v0.1.7", "2026.1.2.0", "c"))}
    write_json(tmp_path, "aino-windows-installer/candidate-inputs.json", {
        "schema": 1, "platform": "windows", "candidateOnly": True,
        "testSigning": True, "arch": "x64", **rows,
    })
    write_json(tmp_path, "aino-windows-installer/runner-prerequisites.json", {
        "os": SECRET, "version": "10.0.26100", "productType": 1, "administrator": True,
        "appInstaller": [{"Version": "1.26.0.0", "PackageFullName": SECRET}],
    })
    proof = "hermes-bundled-update/proof/"
    acceptance = write_json(tmp_path, proof + "acceptance.json", {
        "status": "failed", "ok": False, "automaticRelaunch": True,
        "userStatePreserved": True, "uninstallPreservedUserState": True,
        "oldPid": 101, "newPid": 202, "stamp": {"token": SECRET}, "newPath": SECRET,
    })
    acceptance.write_text(acceptance.read_text(encoding="utf-8"), encoding="utf-16")
    write_json(tmp_path, proof + "published-zip-migration.json", {
        "tested": True, "status": "passed", "oldWrittenHistoryPreserved": True,
        "sameUserData": True, "account": {"access_token": SECRET}, "hermesHome": SECRET,
    })
    write_json(tmp_path, proof + "automatic-new-workspace.json", {
        "status": "passed", "pid": 202, "startedAt": 1794816000000, "observedAt": 1794816000100,
        "authentication": {"authenticationPreservedWithoutLogin": True,
                           "authenticatedProfileRequests": 2, "freshAuthenticationRequests": 0,
                           "requests": [SECRET]},
        "workspace": {"histories": [SECRET]},
    })
    write_json(tmp_path, proof + "preparation-failure/scenario-result.json", {
        "ok": True, "sameOldProcess": True, "descriptorHttpStatus": 404, "error": SECRET,
    })
    write_json(tmp_path, proof + "cancel-reopen/scenario-result.json", {
        "ok": False, "installerCancellationObserved": False, "manualReopen": False, "error": SECRET,
    })
    write_json(tmp_path, proof + "preparation-failure/native-checker-before-apply.json", {
        "code": 1, "stdout": json.dumps({"available": None, "error": "check failed: " + SECRET}),
        "stderr": SECRET, "error": SECRET,
    })
    for relative in ("aino-windows-installer/certificate-state.json",
                     "aino-windows-installer/private-key.pfx", "aino-windows-installer/old.msixbundle",
                     proof + "native-relaunch-environment.json", proof + "diagnostic.log",
                     proof + "screenshot.png", proof + "nested/acceptance.json"):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(SECRET, encoding="utf-8")

    output = export_public_receipts(tmp_path, SOURCE, "x64")
    assert output == tmp_path / "aino-windows-public-receipts/receipts.json"
    assert list(output.parent.iterdir()) == [output]
    serialized = output.read_text(encoding="utf-8")
    assert SECRET not in serialized
    result = json.loads(serialized)
    assert result["sourceCommit"] == SOURCE
    assert result["arch"] == "x64"
    assert result["candidate"]["status"] == "failed"
    assert result["candidate"]["certificateCleanup"] == "removed"
    assert result["packages"]["old"]["sha256"] == "b" * 64
    assert result["packages"]["new"]["version"] == "2026.1.2.0"
    assert result["host"]["version"] == "10.0.26100"
    assert result["nativeAcceptance"]["automaticRelaunch"] is True
    assert result["migration"]["oldWrittenHistoryPreserved"] is True
    assert result["automaticNew"]["freshAuthenticationRequests"] == 0
    assert result["preparation"]["descriptorHttpStatus"] == 404
    assert result["cancellation"]["ok"] is False
    assert result["checker"]["failureClass"] == "check"
    assert result["checker"]["available"] is None


def test_missing_malformed_oversized_and_untyped_receipts_never_claim_acceptance(tmp_path):
    write_json(tmp_path, "aino-windows-installer/candidate-receipt.json", {
        "schema": 1, "candidateOnly": True, "testSigning": True,
        "sourceCommit": "b" * 40, "arch": "x64", "status": "accepted",
    })
    path = write_json(tmp_path, "hermes-bundled-update/proof/acceptance.json", {})
    path.write_text("not-json:" + SECRET, encoding="utf-8")
    write_json(tmp_path, "hermes-bundled-update/proof/automatic-new-workspace.json", {
        "status": "passed", "pid": True, "authentication": {"freshAuthenticationRequests": SECRET},
    })
    path = write_json(tmp_path, "hermes-bundled-update/proof/published-zip-migration.json", {})
    path.write_bytes(b" " * (1024 * 1024 + 1))
    result = json.loads(export_public_receipts(tmp_path, SOURCE, "x64").read_text(encoding="utf-8"))
    assert result["candidate"] == {"document": "invalid"}
    assert result["nativeAcceptance"] == {"document": "invalid"}
    assert result["automaticNew"] == {"document": "invalid"}
    assert result["migration"] == {"document": "invalid"}
    assert result["cancellation"] == {"document": "missing"}
    assert SECRET not in json.dumps(result)
    assert result["status"] == "unaccepted"
    assert all(summary.get("status") != "accepted" for summary in result.values() if isinstance(summary, dict))


def test_native_observation_projects_typed_failure_stages_without_private_evidence(tmp_path):
    write_json(tmp_path, "hermes-bundled-update/proof/native-observation.json", {
        "status": "unaccepted", "phase": "waiting-for-package", "samples": 20,
        "packageQuery": "ok", "processQuery": "ok", "waiterStage": "failed", "waiterHresult": "0x80073D02",
        "version": "1.0.0.0", "oldPayloadCount": 3, "oldMainCount": 0,
        "newMainCount": 0, "installerCount": 1, "deadlineOperation": "package",
        "events": {"queryStatus": "ok", "matchedCount": 5, "errorCount": 1,
                   "eventIds": [400, 401], "hresults": ["0x80073D02"], "raw": SECRET},
        "last": {"commandLine": SECRET, "path": SECRET, "processes": [SECRET]},
    })
    output = export_public_receipts(tmp_path, SOURCE, "x64")
    result = json.loads(output.read_text(encoding="utf-8"))
    assert result["observation"]["phase"] == "waiting-for-package"
    assert result["observation"]["oldPayloadCount"] == 3
    assert result["observation"]["deadlineOperation"] == "package"
    assert result["observation"]["hresults"] == ["0x80073D02"]
    assert result["observation"]["waiterHresult"] == "0x80073D02"
    assert result["status"] == "unaccepted"
    assert SECRET not in output.read_text(encoding="utf-8")


def test_installer_confirmation_and_remaining_process_facts_survive_without_window_or_process_payloads(tmp_path):
    write_json(tmp_path, "hermes-bundled-update/proof/click.json", {
        "ok": True, "exited": True, "appInstallerObserved": True, "appInstallerConfirmed": False,
        "installerAction": "Confirm", "installerState": "no-confirmation-control",
        "visibleWindowCount": 2, "matchingWindowCount": 1,
        "installerWindow": {"title": SECRET, "controls": [SECRET]},
    })
    write_json(tmp_path, "hermes-bundled-update/proof/native-observation.json", {
        "status": "unaccepted", "phase": "waiting-for-package", "oldPythonCount": 1,
        "oldNodeCount": 0, "oldOtherCount": 0,
        "installerQuery": "ok", "installerState": "confirmation-available",
        "installerVisibleWindowCount": 2, "installerMatchingWindowCount": 1, "installerConfirmButtonCount": 1,
        "installer": {"windows": [SECRET]},
        "last": {"processes": [{"commandLine": SECRET, "path": SECRET}]},
    })
    output = export_public_receipts(tmp_path, SOURCE, "x64")
    result = json.loads(output.read_text(encoding="utf-8"))
    assert result["updateTrigger"]["installerState"] == "no-confirmation-control"
    assert result["updateTrigger"]["appInstallerConfirmed"] is False
    assert result["observation"]["oldPythonCount"] == 1
    assert result["observation"]["installerState"] == "confirmation-available"
    assert SECRET not in output.read_text(encoding="utf-8")
    assert result["status"] == "unaccepted"


@pytest.mark.parametrize("field,value", [("phase", SECRET), ("oldPayloadCount", True),
                                         ("events.hresults", [SECRET]), ("deadlineOperation", SECRET),
                                         ("installerState", SECRET), ("oldPythonCount", True)])
def test_malformed_observation_is_never_copied_to_the_public_receipt(tmp_path, field, value):
    document = {"status": "unaccepted", "phase": "waiting-for-process", "oldPayloadCount": 0,
                "events": {"hresults": ["0x80073D02"]}}
    target = document
    *parents, key = field.split(".")
    for parent in parents:
        target = target[parent]
    target[key] = value
    write_json(tmp_path, "hermes-bundled-update/proof/native-observation.json", document)
    output = export_public_receipts(tmp_path, SOURCE, "x64")
    result = json.loads(output.read_text(encoding="utf-8"))
    assert result["observation"] == {"document": "invalid"}
    assert SECRET not in output.read_text(encoding="utf-8")


@pytest.mark.parametrize("source,arch", [("main", "x64"), (SOURCE, "amd64"), (None, "x64")])
def test_export_rejects_unpinned_authority_before_creating_output(tmp_path, source, arch):
    before = set(tmp_path.iterdir())
    with pytest.raises(ValueError):
        export_public_receipts(tmp_path, source, arch)
    assert set(tmp_path.iterdir()) == before


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("link_kind", ["root", "parent", "file", "output"])
def test_export_refuses_symlinked_input_or_output_paths(tmp_path, link_kind):
    root = tmp_path / "temp"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    write_json(outside, "acceptance.json", {"status": "accepted", "error": SECRET})
    if link_kind == "root":
        (tmp_path / "linked-root").symlink_to(root, target_is_directory=True)
        root = tmp_path / "linked-root"
    elif link_kind == "parent":
        (root / "hermes-bundled-update").symlink_to(outside, target_is_directory=True)
    elif link_kind == "file":
        parent = root / "hermes-bundled-update/proof"
        parent.mkdir(parents=True)
        (parent / "acceptance.json").symlink_to(outside / "acceptance.json")
    else:
        (root / "aino-windows-public-receipts").symlink_to(outside, target_is_directory=True)
    with pytest.raises((ValueError, FileExistsError)):
        export_public_receipts(root, SOURCE, "x64")
    assert not (outside / "receipts.json").exists()


@pytest.mark.platforms("windows")
def test_export_refuses_a_real_windows_input_junction(tmp_path):
    root = tmp_path / "temp"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    subprocess.run(["cmd.exe", "/c", "mklink", "/J", str(root / "hermes-bundled-update"), str(outside)],
                   check=True, capture_output=True)
    try:
        with pytest.raises(ValueError):
            export_public_receipts(root, SOURCE, "arm64")
        assert not (root / "aino-windows-public-receipts").exists()
    finally:
        (root / "hermes-bundled-update").rmdir()

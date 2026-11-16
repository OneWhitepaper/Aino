"""Project fixed native acceptance facts into the only uploadable public receipt.

The candidate caller owns hosted/public admission. This module never copies
diagnostics: every output value is a constant or passes a field-specific rule.
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
import json
from pathlib import Path
import re
import stat


_MAX_DOCUMENT = 1024 * 1024
_MISSING = object()
_SOURCE = re.compile(r"[a-f0-9]{40}")
_SHA256 = re.compile(r"[a-f0-9]{64}")
_TAG = re.compile(r"v[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}")
_VERSION = re.compile(r"[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}")
_OS_VERSION = re.compile(r"[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}(?:\.[0-9]{1,5})?")


def _enum(*choices: str) -> Callable[[object], bool]:
    return lambda value: type(value) is str and value in choices


def _matches(pattern: re.Pattern, value: object) -> bool:
    return type(value) is str and pattern.fullmatch(value) is not None


def _version(value: object) -> bool:
    return _matches(_VERSION, value) and all(int(part) <= 65535 for part in value.split("."))


def _boolean(value: object) -> bool:
    return type(value) is bool


def _count(value: object) -> bool:
    return type(value) is int and 0 <= value <= 2**63 - 1


def _hresults(value: object) -> bool:
    return (type(value) is list and len(value) <= 20
            and all(type(code) is str and re.fullmatch(r"0x[89A-F][0-9A-F]{7}", code) for code in value))


_STATUS = _enum("accepted", "failed", "passed", "not-run", "building", "packaged")
_CLEANUP = _enum("removed", "not-created")
_NATIVE_RULES = {
    "status": _STATUS, "ok": _boolean, "automaticRelaunch": _boolean,
    "userStatePreserved": _boolean, "uninstallPreservedUserState": _boolean,
    "oldPid": _count, "newPid": _count, "oldVersion": _version, "newVersion": _version,
}
_DOCUMENTS = {
    "cleanup": ("aino-windows-installer/cleanup-receipt.json", {"certificateCleanup": _CLEANUP}),
    "nativeAcceptance": ("hermes-bundled-update/proof/acceptance.json", _NATIVE_RULES),
    "nativeUpdate": ("hermes-bundled-update/proof/native-update-success.json", _NATIVE_RULES),
    "migration": ("hermes-bundled-update/proof/published-zip-migration.json", {
        "status": _STATUS, "tested": _boolean, "releasedZipOpened": _boolean,
        "manualFirstMsixInstall": _boolean, "sameUserData": _boolean,
        "oldWrittenHistoryPreserved": _boolean, "extractedPayloadRemoved": _boolean,
    }),
    "preparation": ("hermes-bundled-update/proof/preparation-failure/scenario-result.json", {
        "ok": _boolean, "sameOldProcess": _boolean, "descriptorHttpStatus": lambda value: type(value) is int and value == 404,
    }),
    "cancellation": ("hermes-bundled-update/proof/cancel-reopen/scenario-result.json", {
        "ok": _boolean, "installerCancellationObserved": _boolean,
        "oldVersionPreserved": _boolean, "manualReopen": _boolean, "automaticRecovery": _boolean,
    }),
    "manualReopen": ("hermes-bundled-update/proof/cancel-reopen/manual-reopen/recovery.json", {
        "status": _STATUS, "manualReopen": _boolean, "automaticRecovery": _boolean,
        "account.authenticationPreservedWithoutLogin": _boolean,
        "account.authenticatedProfileRequests": _count, "account.freshAuthenticationRequests": _count,
    }),
    "automaticNew": ("hermes-bundled-update/proof/automatic-new-workspace.json", {
        "status": _STATUS, "pid": _count, "startedAt": _count, "observedAt": _count,
        "authentication.authenticationPreservedWithoutLogin": _boolean,
        "authentication.authenticatedProfileRequests": _count, "authentication.freshAuthenticationRequests": _count,
    }),
    "observation": ("hermes-bundled-update/proof/native-observation.json", {
        "status": _enum("observing", "observed", "unaccepted"),
        "phase": _enum("starting", "observation-timeout", "supervisor-timeout", "waiting-for-package", "waiting-for-process", "new-observed",
                       "invalid-package", "invalid-process", "package-query-timeout", "package-query-failed",
                       "package-query-invalid", "process-query-timeout", "process-query-failed", "process-query-invalid"),
        "samples": _count, "version": _version,
        "packageQuery": _enum("ok", "timeout", "failed", "invalid", "not-run"),
        "processQuery": _enum("ok", "timeout", "failed", "invalid", "not-run"),
        "oldPayloadCount": _count, "oldMainCount": _count, "newMainCount": _count, "installerCount": _count,
        "waiterStage": _enum("not-observed", "starting", "ready", "parent-exited", "query-started",
                             "package-changed", "launched", "parent-timeout", "package-timeout", "failed"),
        "waiterHresult": lambda value: _hresults([value]),
        "events.queryStatus": _enum("ok", "timeout", "failed", "invalid"),
        "events.matchedCount": _count, "events.errorCount": _count, "events.hresults": _hresults,
    }),
}


def _plain(path: Path, *, directory: bool = False):
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise ValueError("Public receipt paths must be plain files and directories")
    return info


def _document(root: Path, relative: str) -> tuple[str, dict]:
    path = root
    parts = relative.split("/")
    try:
        for index, part in enumerate(parts):
            path /= part
            info = _plain(path, directory=index < len(parts) - 1)
    except FileNotFoundError:
        return "missing", {}
    if info.st_size > _MAX_DOCUMENT:
        return "invalid", {}
    with path.open("rb") as source:
        raw = source.read(_MAX_DOCUMENT + 1)
    if len(raw) > _MAX_DOCUMENT:
        return "invalid", {}
    try:
        # Windows PowerShell 5.1's default Set-Content emits UTF-16; explicit
        # UTF8 and Python/Node receipts use UTF-8, sometimes with a BOM.
        value = json.loads(raw.decode("utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"))
    except (UnicodeError, ValueError, RecursionError):
        return "invalid", {}
    return ("available", value) if isinstance(value, dict) else ("invalid", {})


def _value(document: dict, field: str):
    current = document
    for part in field.split("."):
        if not isinstance(current, dict) or part not in current:
            return _MISSING
        current = current[part]
    return current


def _project(state: str, document: dict, rules: dict) -> dict:
    result = {"document": state}
    if state != "available":
        return result
    for field, rule in rules.items():
        value = _value(document, field)
        if value is _MISSING:
            continue
        if not rule(value):
            return {"document": "invalid"}
        result[field.rsplit(".", 1)[-1]] = value
    result["errorPresent"] = "error" in document
    return result


def _expected(document: dict, expected: dict) -> bool:
    return all(type(document.get(field)) is type(value) and document[field] == value
               for field, value in expected.items())


def _candidate(root: Path, source: str, arch: str) -> dict:
    state, document = _document(root, "aino-windows-installer/candidate-receipt.json")
    if state == "available" and not _expected(document, {
            "schema": 1, "candidateOnly": True, "testSigning": True, "sourceCommit": source, "arch": arch}):
        state = "invalid"
    return _project(state, document, {"status": _STATUS, "certificateCleanup": _CLEANUP})


def _packages(root: Path, source: str, arch: str) -> dict:
    state, manifest = _document(root, "aino-windows-installer/candidate-inputs.json")
    result = {"document": state}
    if state != "available":
        return result
    if not _expected(manifest, {"schema": 1, "platform": "windows", "arch": arch,
                                "candidateOnly": True, "testSigning": True}):
        return {"document": "invalid"}
    for slot in ("old", "new"):
        row = manifest.get(slot)
        if not isinstance(row, dict) or not _expected(row, {"commit": source, "platform": "windows", "arch": arch}):
            return {"document": "invalid"}
        artifact = row.get("artifact")
        if (not _version(row.get("version")) or not _matches(_TAG, row.get("tag"))
                or not isinstance(artifact, dict) or not _matches(_SHA256, artifact.get("sha256"))):
            return {"document": "invalid"}
        result[slot] = {"sourceCommit": source, "version": row["version"], "tag": row["tag"], "sha256": artifact["sha256"]}
    return result


def _host(root: Path) -> dict:
    state, document = _document(root, "aino-windows-installer/runner-prerequisites.json")
    return _project(state, document, {"version": lambda value: _matches(_OS_VERSION, value),
                                      "productType": lambda value: type(value) is int and value in (1, 2, 3),
                                      "administrator": _boolean})


def _checker(root: Path) -> dict:
    state, document = _document(root, "hermes-bundled-update/proof/preparation-failure/native-checker-before-apply.json")
    result = _project(state, document, {"code": lambda value: type(value) is int and -32768 <= value <= 65535})
    if result["document"] != "available":
        return result
    try:
        stdout = json.loads(document.get("stdout", ""))
    except (TypeError, ValueError, RecursionError):
        result["stdoutJson"] = "invalid"
        return result
    parsed = _project("available" if isinstance(stdout, dict) else "invalid", stdout, {
        "available": lambda value: value is None or _boolean(value),
        "reason": _enum("not-packaged", "no-app-installer-source"),
        "availability": _enum("NO_UPDATES", "AVAILABLE", "REQUIRED", "UNKNOWN", "ERROR"),
    })
    result["stdoutJson"] = parsed.pop("document")
    result.update(parsed)
    result["failureClass"] = "unclassified"
    error = stdout.get("error") if isinstance(stdout, dict) else None
    for prefix, classification in (("winrt import failed:", "winrt-import"), ("package identity failed:", "package-identity"),
                                   ("check failed:", "check"), ("availability unknown:", "availability-unknown")):
        if type(error) is str and error.startswith(prefix):
            result["failureClass"] = classification
            break
    return result


_LEGACY_COMMIT = "22a472fcbca8775f56c0f89374027b8e4c68ab5b"
_PREPARATION = {"ok": True, "scenario": "preparation-failure", "sameOldProcess": True, "descriptorHttpStatus": 404}
_CANCELLATION = {"ok": True, "scenario": "os-cancel-manual-reopen", "installerCancellationObserved": True,
                 "oldVersionPreserved": True, "manualReopen": True, "automaticRecovery": False}
_MIGRATION = {"status": "passed", "tested": True, "releasedZipOpened": True, "manualFirstMsixInstall": True,
              "sameUserData": True, "oldWrittenHistoryPreserved": True, "extractedPayloadRemoved": True}
_AUTHENTICATION = {"authenticationPreservedWithoutLogin": True, "freshAuthenticationRequests": 0}


def _satisfies(document: dict, expected: dict) -> bool:
    return ("error" not in document and document.get("errorPresent", False) is False
            and all(type(_value(document, field)) is type(value)
            and _value(document, field) == value for field, value in expected.items()))


def _positive(value: object) -> bool:
    return _count(value) and value > 0


def _birth_millis(value: object) -> int:
    if type(value) is not str:
        return -1
    microsoft = re.fullmatch(r"/Date\(([0-9]{1,16})(?:[+-][0-9]{4})?\)/", value)
    if microsoft:
        return int(microsoft[1])
    try:
        instant = datetime.fromisoformat(value)
        return int(instant.replace(tzinfo=instant.tzinfo or UTC).timestamp() * 1000)
    except (OverflowError, OSError, ValueError):
        return -1


def _native_complete(document: dict, packages: dict, source: str, *, final: bool) -> bool:
    if packages["document"] != "available":
        return False
    if not final and document.get("status", "passed") not in ("accepted", "passed"):
        return False
    expected = {"ok": True, "candidateOnly": True, "automaticRelaunch": True, "userStatePreserved": True,
                "oldVersion": packages["old"]["version"], "newVersion": packages["new"]["version"],
                "stamp.schemaVersion": 1, "stamp.commit": source, "stamp.tag": packages["new"]["tag"], "stamp.payload": "bundled",
                "stamp.distribution": "desktop-app", "stamp.updateMechanism": "app-installer"}
    if final:
        expected.update(status="accepted", uninstallPreservedUserState=True)
        for prefix, required in (("recovery.preparation", _PREPARATION), ("recovery.cancellation", _CANCELLATION),
                                 ("publishedZipMigration", {**_MIGRATION, "currentCodeSha": source, "legacyCodeSha": _LEGACY_COMMIT})):
            expected.update({f"{prefix}.{field}": value for field, value in required.items()})
    return (_satisfies(document, expected) and _positive(document.get("oldPid")) and _positive(document.get("newPid"))
            and document["oldPid"] != document["newPid"]
            and 0 < _birth_millis(document.get("oldBirth")) < _birth_millis(document.get("newBirth")))


def _recovery_complete(document: dict, source: str, *, manual: bool) -> bool:
    expected = {"status": "passed", "expectedCommit": source, "automaticRecovery": False, "manualReopen": manual,
                "scenario": "manual-old-reopen" if manual else "preparation-failure"}
    expected.update({f"account.{field}": value for field, value in _AUTHENTICATION.items()})
    return _satisfies(document, expected) and _positive(_value(document, "account.authenticatedProfileRequests"))


def _automatic_complete(document: dict, native: dict, source: str) -> bool:
    expected = {"status": "passed", "pid": native.get("newPid"), "workspace.identity.commit": source,
                "workspace.identity.platform": "win32", "owner.commit": source, "workspace.account.phase": "signed_in",
                "workspace.account.userId": "17", "workspace.account.rememberState": "encrypted",
                "authentication.status": "passed", "authentication.phase": "automatic-new",
                "authentication.startedAt": document.get("startedAt"), "authentication.observedAt": document.get("observedAt")}
    expected.update({f"authentication.{field}": value for field, value in _AUTHENTICATION.items()})
    return (_satisfies(document, expected) and _positive(document.get("startedAt"))
            and _positive(document.get("observedAt")) and document["observedAt"] >= document["startedAt"]
            and abs(document["startedAt"] - _birth_millis(native.get("newBirth"))) <= 1
            and _positive(_value(document, "authentication.authenticatedProfileRequests")))


def _package_transition(root: Path, packages: dict) -> bool:
    if packages["document"] != "available":
        return False
    _, manifest = _document(root, "aino-windows-installer/candidate-inputs.json")
    old, new = manifest["old"], manifest["new"]
    identities_match = all(type(old.get(field)) is str and bool(old[field]) and old[field] == new.get(field)
                           for field in ("identity", "publisher", "applicationId"))
    return (identities_match and old["tag"] != new["tag"] and old["artifact"]["sha256"] != new["artifact"]["sha256"]
            and tuple(map(int, old["version"].split("."))) < tuple(map(int, new["version"].split("."))))


def _user_state_complete(root: Path) -> bool:
    for phase in ("install", "preparation-failure", "update", "uninstall", "os-cancel", "cancel-manual-reopen"):
        state, document = _document(root, f"hermes-bundled-update/proof/user-state-after-{phase}.json")
        if (state != "available" or not _satisfies(document, {"ok": True, "missing": [], "changed": [], "unsafe": []})
                or not _positive(document.get("checked"))):
            return False
    return True


def _acceptance_gates(root: Path, receipt: dict, source: str, arch: str) -> dict[str, bool]:
    documents = {name: _document(root, relative)[1] for name, (relative, _) in _DOCUMENTS.items()}
    native = documents["nativeAcceptance"]
    _, preparation = _document(root, "hermes-bundled-update/proof/preparation-failure/recovery.json")
    _, click = _document(root, "hermes-bundled-update/proof/cancel-reopen/cancel-click.json")
    _, released = _document(root, "hermes-bundled-update/proof/released-zip-artifact.json")
    linked_update = {field: native.get(field) for field in ("oldPid", "newPid", "oldBirth", "newBirth")}
    return {
        "candidate": _satisfies(receipt["candidate"], {"document": "available", "status": "accepted", "certificateCleanup": "removed"}),
        "packages": _package_transition(root, receipt["packages"]),
        "host": _satisfies(receipt["host"], {"document": "available", "administrator": True})
                and _matches(_OS_VERSION, receipt["host"].get("version")) and "productType" in receipt["host"],
        "nativeAcceptance": _native_complete(native, receipt["packages"], source, final=True),
        "nativeUpdate": _native_complete(documents["nativeUpdate"], receipt["packages"], source, final=False)
                        and _satisfies(documents["nativeUpdate"], linked_update),
        "cleanup": _satisfies(documents["cleanup"], {"candidateOnly": True, "testSigning": True, "certificateCleanup": "removed"}),
        "migration": _satisfies(documents["migration"], {**_MIGRATION, "currentCodeSha": source, "legacyCodeSha": _LEGACY_COMMIT}),
        "preparation": _satisfies(documents["preparation"], _PREPARATION) and _recovery_complete(preparation, source, manual=False),
        "cancellation": _satisfies(documents["cancellation"], _CANCELLATION) and _satisfies(click, {
            "ok": True, "exited": True, "appInstallerObserved": True, "appInstallerCancelled": True,
            "newVisibleWindow": True, "installerAction": "Cancel"}) and click.get("action") in ("cancel-button", "window-close"),
        "manualReopen": _recovery_complete(documents["manualReopen"], source, manual=True),
        "automaticNew": _automatic_complete(documents["automaticNew"], native, source),
        "releasedZip": _satisfies(released, {"status": "passed", "release": "v0.1.5", "commit": _LEGACY_COMMIT,
                                            "arch": arch, "target": f"win32-{arch}"}),
        "userState": _user_state_complete(root),
    }


def export_public_receipts(temp_root: Path, source: str, arch: str) -> Path:
    """Write one fresh projection; absence never turns into a passing lifecycle."""
    if not _matches(_SOURCE, source) or arch not in ("x64", "arm64"):
        raise ValueError("Exact source commit and native candidate architecture required")
    root = Path(temp_root)
    if not root.is_absolute():
        raise ValueError("Absolute runner temporary directory required")
    _plain(root, directory=True)
    receipt = {"schema": 1, "kind": "windows-native-acceptance-public-receipts", "candidateOnly": True,
               "testSigning": True, "sourceCommit": source, "arch": arch,
               "candidate": _candidate(root, source, arch), "packages": _packages(root, source, arch), "host": _host(root)}
    for name, (relative, rules) in _DOCUMENTS.items():
        receipt[name] = _project(*_document(root, relative), rules)
    receipt["checker"] = _checker(root)
    receipt["acceptanceGates"] = _acceptance_gates(root, receipt, source, arch)
    receipt["status"] = "accepted" if all(receipt["acceptanceGates"].values()) else "unaccepted"
    if receipt["status"] == "unaccepted":
        for summary in receipt.values():
            if isinstance(summary, dict) and summary.get("status") == "accepted":
                summary["status"] = "unaccepted"
    out = root / "aino-windows-public-receipts"
    out.mkdir()
    path = out / "receipts.json"
    with path.open("x", encoding="utf-8") as destination:
        json.dump(receipt, destination, indent=2, sort_keys=True)
        destination.write("\n")
    return path

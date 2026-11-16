"""Project fixed native acceptance facts into the only uploadable public receipt.

The candidate caller owns hosted/public admission. This module never copies
diagnostics: every output value is a constant or passes a field-specific rule.
"""
from __future__ import annotations

from collections.abc import Callable
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
    out = root / "aino-windows-public-receipts"
    out.mkdir()
    path = out / "receipts.json"
    with path.open("x", encoding="utf-8") as destination:
        json.dump(receipt, destination, indent=2, sort_keys=True)
        destination.write("\n")
    return path

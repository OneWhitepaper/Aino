"""Admit immutable private candidate inputs without rebuilding or changing provenance.

The caller owns private-host admission, archive transport/digest verification,
certificate trust and native execution. These helpers never execute artifact files.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
import hashlib
import json
from pathlib import Path
import re
import stat


_COMMIT = re.compile(r"[a-f0-9]{40}")
_DIGEST = re.compile(r"[a-f0-9]{64}")
_WORKFLOW = ".github/workflows/windows-installer-candidate.yml"
_REQUIRED = ("old.msixbundle", "new.msixbundle", "candidate-inputs.json",
             "candidate-public.cer", "candidate-receipt.json")


def _inputs(source: str, arch: str) -> None:
    if not isinstance(source, str) or not _COMMIT.fullmatch(source) or arch not in {"x64", "arm64"}:
        raise ValueError("An exact candidate source commit and native architecture are required")


def _time(value: object) -> datetime:
    if not isinstance(value, str):
        raise ValueError("GitHub timestamps must be explicit UTC dates")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise ValueError("Invalid GitHub timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset().total_seconds() != 0:
        raise ValueError("GitHub timestamps must be explicit UTC dates")
    return parsed


def validate_origin(metadata: dict, run: dict, source: str, arch: str,
                    run_id: int, artifact_id: int, *, now: datetime | None = None) -> dict:
    """Bind API responses to the caller's exact run/artifact, allowing failed E2E runs."""
    _inputs(source, arch)
    if (type(run_id) is not int or run_id <= 0 or type(artifact_id) is not int or artifact_id <= 0
            or not isinstance(metadata, dict) or not isinstance(run, dict)):
        raise ValueError("Exact positive GitHub run and artifact IDs are required")
    workflow_run = metadata.get("workflow_run")
    name = f"aino-windows-installer-candidate-{arch}-{source}"
    if (run.get("id") != run_id or run.get("head_sha") != source or run.get("path") != _WORKFLOW
            or run.get("event") not in {"push", "workflow_dispatch"} or run.get("status") != "completed"
            or not isinstance(workflow_run, dict) or workflow_run.get("id") != run_id
            or workflow_run.get("head_sha") != source or metadata.get("id") != artifact_id
            or metadata.get("name") != name or metadata.get("expired") is not False
            or type(metadata.get("size_in_bytes")) is not int or metadata["size_in_bytes"] <= 0):
        raise ValueError("Artifact does not belong to the exact completed candidate workflow and source")
    current = now or datetime.now(UTC)
    created, updated = _time(run.get("created_at")), _time(run.get("updated_at"))
    artifact_created = _time(metadata.get("created_at"))
    artifact_updated = _time(metadata.get("updated_at"))
    if not created <= artifact_created <= artifact_updated <= updated <= current:
        raise ValueError("Artifact/run dates are inconsistent or in the future")
    if _time(metadata.get("expires_at")) <= current:
        raise ValueError("Candidate artifact has expired")
    digest = metadata.get("digest")
    if digest is not None and (not isinstance(digest, str) or not digest.startswith("sha256:")
                               or not _DIGEST.fullmatch(digest[7:])):
        raise ValueError("Artifact archive digest is invalid")
    return {"runId": run_id, "artifactId": artifact_id, "sourceCommit": source, "arch": arch,
            "artifactName": name, "archiveSha256": digest[7:] if digest else None}


def _plain_path(filename: Path, *, directory: bool = False) -> None:
    info = filename.lstat()
    expected_kind = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected_kind(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise ValueError(f"Candidate input must be a plain {'directory' if directory else 'file'}: {filename.name}")


def _document(filename: Path) -> dict:
    value = json.loads(filename.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"Candidate JSON must be an object: {filename.name}")
    return value


def _side(row: object, slot: str, source: str, arch: str, root: Path) -> dict:
    if (not isinstance(row, dict) or row.get("commit") != source
            or row.get("platform") != "windows" or row.get("arch") != arch
            or not isinstance(row.get("tag"), str) or not re.fullmatch(r"v\d+\.\d+\.\d+", row["tag"])
            or any(not isinstance(row.get(field), str) or not row[field]
                   for field in ("identity", "publisher", "applicationId", "version"))):
        raise ValueError(f"{slot} candidate identity, commit or architecture mismatch")
    if not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", row["version"]):
        raise ValueError(f"{slot} candidate needs a native numeric version")
    if any(int(part) > 65535 for part in row["version"].split(".")):
        raise ValueError(f"{slot} candidate version exceeds native bounds")
    artifact = row.get("artifact")
    if (not isinstance(artifact, dict) or not isinstance(artifact.get("sha256"), str)
            or not _DIGEST.fullmatch(artifact["sha256"])):
        raise ValueError(f"{slot} candidate requires an exact SHA-256")
    filename = root / f"{slot}.msixbundle"
    with filename.open("rb") as source_file:
        digest = hashlib.file_digest(source_file, "sha256").hexdigest()
    if digest != artifact["sha256"]:
        raise ValueError(f"{slot} candidate SHA-256 mismatch")
    return {**deepcopy(row), "artifact": {**artifact, "path": str(filename)}}


def relocate_manifest(artifactdir: Path, source: str, arch: str) -> Path:
    """Validate fixed local inputs; write a separate manifest and leave source receipts intact."""
    _inputs(source, arch)
    root = Path(artifactdir)
    if not root.is_absolute():
        raise ValueError("Candidate artifact directory must be absolute")
    _plain_path(root, directory=True)
    root = root.resolve(strict=True)
    for name in _REQUIRED:
        _plain_path(root / name)
    manifest = _document(root / "candidate-inputs.json")
    receipt = _document(root / "candidate-receipt.json")
    for document in (manifest, receipt):
        if (type(document.get("schema")) is not int or document["schema"] != 1
                or document.get("candidateOnly") is not True or document.get("testSigning") is not True
                or document.get("arch") != arch):
            raise ValueError("Reused inputs must be same-architecture test-signed private candidates")
    if manifest.get("platform") != "windows" or receipt.get("sourceCommit") != source:
        raise ValueError("Candidate manifest/receipt source differs from the pinned artifact")
    rows = {slot: _side(manifest.get(slot), slot, source, arch, root) for slot in ("old", "new")}
    old, new = rows["old"], rows["new"]
    if (any(old[field] != new[field] for field in ("identity", "publisher", "applicationId"))
            or old["tag"] == new["tag"] or old["artifact"]["sha256"] == new["artifact"]["sha256"]
            or tuple(map(int, new["version"].split("."))) <= tuple(map(int, old["version"].split(".")))):
        raise ValueError("Reused update must preserve native identity and increase its version")
    output = root / "reuse-inputs.json"
    with output.open("x", encoding="utf-8") as destination:
        json.dump({**manifest, **rows}, destination, indent=2)
        destination.write("\n")
    return output

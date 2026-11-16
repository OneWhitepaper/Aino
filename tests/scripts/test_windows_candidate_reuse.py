"""Reused private packages retain their original provenance and never select external files."""
from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
import hashlib
import json

import pytest

from scripts.ci.windows_candidate_reuse import relocate_manifest, validate_origin


SOURCE = "a" * 40
NOW = datetime(2026, 11, 16, 1, tzinfo=UTC)


def origin():
    run = {"id": 100, "head_sha": SOURCE, "path": ".github/workflows/windows-installer-candidate.yml",
           "event": "push", "status": "completed", "conclusion": "failure",
           "created_at": "2026-11-16T00:00:00Z", "updated_at": "2026-11-16T00:15:00Z"}
    artifact = {"id": 200, "name": f"aino-windows-installer-candidate-x64-{SOURCE}",
                "expired": False, "size_in_bytes": 42, "digest": "sha256:" + "b" * 64,
                "created_at": "2026-11-16T00:10:00Z", "updated_at": "2026-11-16T00:11:00Z",
                "expires_at": "2026-11-23T00:10:00Z", "workflow_run": {"id": 100, "head_sha": SOURCE}}
    return artifact, run


def test_origin_admits_a_finished_failed_build_without_changing_its_provenance():
    artifact, run = origin()
    before = deepcopy((artifact, run))
    assert validate_origin(artifact, run, SOURCE, "x64", 100, 200, now=NOW) == {
        "runId": 100, "artifactId": 200, "sourceCommit": SOURCE, "arch": "x64",
        "artifactName": artifact["name"], "archiveSha256": "b" * 64,
    }
    assert (artifact, run) == before


@pytest.mark.parametrize("target,key,value", [
    ("artifact", "id", 201), ("artifact", "name", f"aino-windows-installer-candidate-arm64-{SOURCE}"),
    ("artifact", "expired", True), ("artifact", "expires_at", "2026-11-16T00:30:00Z"),
    ("artifact", "size_in_bytes", 0), ("artifact", "digest", "sha256:bad"),
    ("artifact", "workflow_run", {"id": 101, "head_sha": SOURCE}),
    ("artifact", "workflow_run", {"id": 100, "head_sha": "c" * 40}),
    ("artifact", "created_at", "2026-11-15T23:00:00Z"),
    ("artifact", "updated_at", "2026-11-17T00:00:00Z"),
    ("run", "id", 101), ("run", "head_sha", "c" * 40),
    ("run", "path", ".github/workflows/unrelated.yml"), ("run", "event", "pull_request"),
    ("run", "status", "in_progress"), ("run", "created_at", "tomorrow"),
    ("run", "updated_at", "2026-11-15T23:00:00Z"),
])
def test_origin_refuses_mixed_runs_expired_artifacts_and_unfinished_or_future_records(target, key, value):
    artifact, run = origin()
    (artifact if target == "artifact" else run)[key] = value
    with pytest.raises(ValueError):
        validate_origin(artifact, run, SOURCE, "x64", 100, 200, now=NOW)


def candidate_files(directory):
    directory.mkdir()
    rows = {}
    for slot, version in (("old", "2026.1.1.0"), ("new", "2026.1.2.0")):
        package = directory / f"{slot}.msixbundle"
        package.write_bytes(f"real package bytes for {slot}".encode())
        rows[slot] = {"platform": "windows", "arch": "x64", "commit": SOURCE,
                      "tag": "v0.1.6" if slot == "old" else "v0.1.7", "version": version,
                      "identity": "Ablankpaper.AinoBundled", "publisher": "CN=Candidate Fixture",
                      "applicationId": "AinoBundled", "artifact": {
                          "path": f"Z:\\previous-runner\\{slot}.msixbundle",
                          "url": f"http://127.0.0.1/{slot}.msixbundle",
                          "sha256": hashlib.sha256(package.read_bytes()).hexdigest()}}
    manifest = {"schema": 1, "platform": "windows", "arch": "x64",
                "candidateOnly": True, "testSigning": True, **rows}
    receipt = {"schema": 1, "candidateOnly": True, "testSigning": True, "sourceCommit": SOURCE,
               "arch": "x64", "status": "failed", "error": "original dependency failure"}
    (directory / "candidate-inputs.json").write_text(json.dumps(manifest), encoding="utf-8")
    (directory / "candidate-receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
    (directory / "candidate-public.cer").write_bytes(b"public certificate validated separately")
    (directory / "diagnostic.log").write_text("never executed", encoding="utf-8")
    return manifest, receipt


def test_relocation_checks_package_bytes_and_preserves_the_original_failed_receipt(tmp_path):
    root = tmp_path / "download"
    manifest, receipt = candidate_files(root)
    original = (root / "candidate-inputs.json").read_bytes()
    output = relocate_manifest(root, SOURCE, "x64")
    assert output == root / "reuse-inputs.json"
    relocated = json.loads(output.read_text(encoding="utf-8"))
    for slot in ("old", "new"):
        assert relocated[slot]["artifact"]["path"] == str(root / f"{slot}.msixbundle")
        assert relocated[slot]["artifact"]["sha256"] == manifest[slot]["artifact"]["sha256"]
        assert relocated[slot]["commit"] == SOURCE
    assert (root / "candidate-inputs.json").read_bytes() == original
    assert json.loads((root / "candidate-receipt.json").read_text(encoding="utf-8")) == receipt
    with pytest.raises(FileExistsError):
        relocate_manifest(root, SOURCE, "x64")


@pytest.mark.parametrize("document,keys,value", [
    ("manifest", ("new", "commit"), "c" * 40),
    ("manifest", ("old", "arch"), "arm64"),
    ("manifest", ("new", "publisher"), "CN=Another candidate"),
    ("manifest", ("new", "version"), "2026.1.1.0"),
    ("receipt", ("sourceCommit",), "c" * 40),
    ("manifest", ("candidateOnly",), False),
])
def test_relocation_refuses_substitution_before_writing_a_reuse_manifest(tmp_path, document, keys, value):
    root = tmp_path / "download"
    manifest, receipt = candidate_files(root)
    selected = {"manifest": manifest, "receipt": receipt}[document]
    for key in keys[:-1]:
        selected = selected[key]
    selected[keys[-1]] = value
    (root / "candidate-inputs.json").write_text(json.dumps(manifest), encoding="utf-8")
    (root / "candidate-receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
    with pytest.raises(ValueError):
        relocate_manifest(root, SOURCE, "x64")
    assert not (root / "reuse-inputs.json").exists()


def test_relocation_rejects_modified_package_bytes_before_writing_a_reuse_manifest(tmp_path):
    root = tmp_path / "download"
    candidate_files(root)
    (root / "new.msixbundle").write_bytes(b"tampered package")
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        relocate_manifest(root, SOURCE, "x64")
    assert not (root / "reuse-inputs.json").exists()


def test_relocation_never_reads_a_symlinked_package_outside_the_artifact_directory(tmp_path):
    root = tmp_path / "download"
    candidate_files(root)
    target = tmp_path / "outside.msixbundle"
    (root / "new.msixbundle").rename(target)
    (root / "new.msixbundle").symlink_to(target)
    with pytest.raises(ValueError, match="plain file"):
        relocate_manifest(root, SOURCE, "x64")
    assert not (root / "reuse-inputs.json").exists()

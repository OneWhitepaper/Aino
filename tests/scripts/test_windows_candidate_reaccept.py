"""Reuse extracts only admitted fixed files and verifies transport bytes before trust."""
from __future__ import annotations

import zipfile

import pytest

from scripts.ci import windows_candidate_reaccept as reaccept


@pytest.mark.parametrize("prefix", ["", "aino-windows-installer/"])
def test_extraction_admits_the_two_uploaded_root_layouts_without_diagnostics(tmp_path, prefix):
    archive = tmp_path / "artifact.zip"
    with zipfile.ZipFile(archive, "w") as package:
        for name in reaccept.REQUIRED:
            package.writestr(prefix + name, "candidate data")
        package.writestr("hermes-bundled-update/proof/run.ps1", "never execute")
        package.writestr("diagnostic.log", "never extract")
    out = tmp_path / "inputs"
    out.mkdir()
    reaccept.extract_inputs(archive, out)
    assert {file.name for file in out.iterdir()} == reaccept.REQUIRED
    assert all(file.read_text(encoding="utf-8") == "candidate data" for file in out.iterdir())


@pytest.mark.parametrize("unsafe", ["../old.msixbundle", "nested/old.msixbundle", "duplicate", "symlink"])
def test_extraction_refuses_ambiguous_or_unsafe_input_paths(tmp_path, unsafe):
    archive = tmp_path / "artifact.zip"
    with zipfile.ZipFile(archive, "w") as package:
        for name in reaccept.REQUIRED - {"old.msixbundle"}:
            package.writestr(name, "candidate data")
        if unsafe == "duplicate":
            package.writestr("old.msixbundle", "candidate data")
            package.writestr("aino-windows-installer/old.msixbundle", "duplicate")
        elif unsafe == "symlink":
            entry = zipfile.ZipInfo("old.msixbundle")
            entry.external_attr = 0o120777 << 16
            package.writestr(entry, "outside")
        else:
            package.writestr(unsafe, "candidate data")
    out = tmp_path / "inputs"
    out.mkdir()
    with pytest.raises(ValueError):
        reaccept.extract_inputs(archive, out)
    assert not list(out.iterdir())


def test_cleanup_does_not_create_trust_state_when_no_certificate_was_imported(tmp_path):
    out = tmp_path / "reaccept"
    out.mkdir()
    reaccept.cleanup_trust(out, {})
    assert not list(out.iterdir())

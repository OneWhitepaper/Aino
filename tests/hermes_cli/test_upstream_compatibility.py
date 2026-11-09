"""Plugin admission follows the merged Hermes API, not Aino's distribution identity."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

from hermes_cli import plugins_manifest, version_info


@pytest.fixture(autouse=True)
def fresh_runtime_identity():
    version_info._reset_version_info_cache()
    yield
    version_info._reset_version_info_cache()


def _git(root, *args):
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=True,
                          env={**os.environ, "GIT_CONFIG_GLOBAL": os.devnull}).stdout.strip()


def _assert_plugin_boundary():
    assert plugins_manifest.running_hermes_version() == "0.23.0"
    # Existing plugins such as OMH read the public runtime API directly.
    assert version_info.get_version_info().base_version == "0.23.0"
    for requirement in (">=0.21.1", ">=0.23.0", "<=0.23.0", ">=0.21.1,<=0.23.0"):
        assert plugins_manifest.requires_hermes_error({"requires_hermes": requirement}) is None
    for requirement in (">0.23.0", ">=0.24.0", "<0.23.0"):
        reason = plugins_manifest.requires_hermes_error({"requires_hermes": requirement})
        assert reason == f"requires hermes {requirement}, running 0.23.0"


@pytest.mark.parametrize("legacy_tag", [False, True])
def test_source_clone_without_upstream_tags_preserves_identity_and_gates_plugins(tmp_path, monkeypatch, legacy_tag):
    repo = tmp_path / "checkout"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.name", "Version Test")
    _git(repo, "config", "user.email", "version@example.invalid")
    project = repo / "pyproject.toml"
    project.write_text('[project]\nname = "hermes-agent"\nversion = "0.20.6"\n')
    _git(repo, "add", "pyproject.toml")
    _git(repo, "commit", "-qm", "old distribution")
    if legacy_tag:
        _git(repo, "tag", "v2026.8.27")
    project.write_text('[project]\nname = "hermes-agent"\nversion = "0.0.0"\n')
    _git(repo, "commit", "-qam", "updated source")
    monkeypatch.setattr(version_info, "_resolve_repo_dir", lambda: repo)
    monkeypatch.setattr(version_info, "_resolve_stamp_file", lambda: None)

    identity = version_info.get_version_info()
    original_base = "0.20.6" if legacy_tag else "unknown"
    assert identity.distribution_base_version == original_base
    assert identity.commit == _git(repo, "rev-parse", "HEAD")
    _assert_plugin_boundary()
    assert version_info.get_version_info() is identity
    assert version_info.get_code_identity()["version"] == original_base
    from hermes_cli.source_stamp import write_source_stamp
    stamped = write_source_stamp(repo)
    assert stamped["baseVersion"] == original_base
    assert stamped["displayVersion"] == identity.derived_version


@pytest.mark.parametrize("base_version", ["0.0.0", "0.20.6", "unknown", "2026.11.10", "0.24.0"])
def test_packaged_tree_without_git_uses_compatibility_without_rewriting_stamp(tmp_path, monkeypatch, base_version):
    stamp = tmp_path / "install-stamp.json"
    stamp.write_text(json.dumps({"commit": "a" * 40, "source": "commit-build", "baseVersion": base_version,
                                 "distribution": "desktop-app", "updateMechanism": "external"}))
    original = stamp.read_bytes()
    monkeypatch.setattr(version_info, "_resolve_stamp_file", lambda: stamp)
    monkeypatch.setattr(version_info, "_resolve_repo_dir", lambda: None)

    identity = version_info.get_version_info()
    assert identity.distribution_base_version == base_version
    assert identity.derived_version == identity.display_version == base_version
    assert (identity.commit, identity.source, identity.distribution) == ("a" * 40, "commit-build", "desktop-app")
    _assert_plugin_boundary()
    assert version_info.get_version_info() is identity
    assert version_info.get_code_identity()["version"] == base_version
    assert stamp.read_bytes() == original


@pytest.mark.parametrize("requirement, allowed", [("hermes-agent>=0.21.1", True),
                                                  ("hermes-agent<=0.23.0", True),
                                                  ("hermes-agent>0.23.0", False)])
def test_pm_core_requirements_share_the_plugin_compatibility_boundary(requirement, allowed):
    from pm.workspace import core_requirement_error
    declaration = SimpleNamespace(external=False, requirements=[requirement], pyproject=None)
    reason = core_requirement_error(declaration)
    assert (reason is None) is allowed
    if not allowed:
        assert "running 0.23.0" in reason


@pytest.mark.parametrize("required, accepted", [(">=0.21.1", True), (">=0.23.0", True), (">0.23.0", False)])
def test_profile_distribution_admission_uses_the_same_core_version(tmp_path, monkeypatch, required, accepted):
    from hermes_cli.profile_distribution import DistributionError, DistributionManifest, plan_install, write_manifest
    stamp = tmp_path / "install-stamp.json"
    stamp.write_text(json.dumps({"commit": "b" * 40, "baseVersion": "0.20.6", "updateMechanism": "self"}))
    monkeypatch.setattr(version_info, "_resolve_stamp_file", lambda: stamp)
    package = tmp_path / "profile-package"
    package.mkdir()
    write_manifest(package, DistributionManifest(name="compat-profile", version="1.0.0", hermes_requires=required))
    if accepted:
        assert plan_install(str(package), tmp_path / "staging").manifest.hermes_requires == required
    else:
        with pytest.raises(DistributionError, match="but you have 0.23.0"):
            plan_install(str(package), tmp_path / "staging")


def test_declared_upstream_baseline_is_an_ancestor_in_complete_source_history():
    from hermes_cli.upstream_compatibility import UPSTREAM_COMMIT, UPSTREAM_VERSION
    root = Path(__file__).resolve().parents[2]
    if not (root / ".git").exists():
        pytest.skip("packaged source has no history; compatibility is carried by the Python module")
    if _git(root, "rev-parse", "--is-shallow-repository") == "true":
        pytest.skip("shallow checkout omits ancestry; the full-history lane verifies the baseline")
    assert UPSTREAM_VERSION == "0.23.0"
    _git(root, "merge-base", "--is-ancestor", UPSTREAM_COMMIT, "HEAD")
    assert _git(root, "show", f"{UPSTREAM_COMMIT}:hermes_cli/version_info.py")

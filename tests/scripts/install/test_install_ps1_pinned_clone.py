"""A fresh pinned Windows install materializes only the selected commit."""

import pytest

from tests.scripts.install._install_ps1_test_support import clone_argv, git, pin_fixture, stage


pytestmark = pytest.mark.platforms("windows")


def test_pinned_fresh_clone_never_materializes_the_branch_tip(tmp_path):
    origin, pin, _ = pin_fixture(tmp_path)
    home, trace = tmp_path / "home", tmp_path / "install.trace"

    result, frame = stage(origin, home, "-Commit", pin, GIT_TRACE=str(trace))

    assert frame["ok"] is True, result.stdout + result.stderr
    install = home / "hermes-agent"
    assert (install / "README").read_text(encoding="utf-8-sig") == "one"
    assert git(install, "status", "--porcelain") == ""
    assert "--no-checkout" in clone_argv(trace)
    assert git(install, "rev-parse", "HEAD") == pin


def test_unpinned_fresh_clone_materializes_the_branch_tip(tmp_path):
    origin, _, _ = pin_fixture(tmp_path)
    home, trace = tmp_path / "home", tmp_path / "install.trace"

    result, frame = stage(origin, home, GIT_TRACE=str(trace))

    assert frame["ok"] is True, result.stdout + result.stderr
    install = home / "hermes-agent"
    assert (install / "README").read_text(encoding="utf-8-sig") == "tip"
    assert git(install, "status", "--porcelain") == ""
    assert "--no-checkout" not in clone_argv(trace)

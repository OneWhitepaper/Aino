"""Rerunning the Windows repository stage preserves local work."""

import pytest

from tests.scripts.install._install_ps1_test_support import git, rerun_fixture, stage


pytestmark = pytest.mark.platforms("windows")


def test_rerun_parks_local_work_and_updates_the_branch_tip(tmp_path):
    origin, home, install, _ = rerun_fixture(tmp_path)

    result, frame = stage(origin, home)

    assert frame["ok"] is True, result.stdout + result.stderr
    assert (install / "README").read_text(encoding="utf-8-sig") == "two"
    assert "local edit" in git(install, "stash", "show", "-p", "stash@{0}")

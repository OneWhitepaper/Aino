"""A rerun refuses to pin a commit outside the selected branch."""

import pytest

from tests.scripts.install._install_ps1_test_support import rerun_fixture, stage


pytestmark = pytest.mark.platforms("windows")


def test_rerun_rejects_a_pin_from_another_branch(tmp_path):
    origin, home, _, off_branch = rerun_fixture(tmp_path)

    _, frame = stage(origin, home, "-Commit", off_branch)

    assert frame["ok"] is False
    assert "is not on branch main" in frame["reason"]

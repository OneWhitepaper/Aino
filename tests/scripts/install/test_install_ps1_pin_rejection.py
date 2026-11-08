"""A rejected pin must not publish a partial Windows checkout."""

import pytest

from tests.scripts.install._install_ps1_test_support import pin_fixture, stage


pytestmark = pytest.mark.platforms("windows")


def test_pinned_fresh_clone_publishes_nothing_when_the_pin_is_refused(tmp_path):
    origin, _, off_branch = pin_fixture(tmp_path)
    home = tmp_path / "home"

    _, frame = stage(origin, home, "-Commit", off_branch)

    assert frame["ok"] is False
    assert "is not on branch main" in frame["reason"]
    assert not (home / "hermes-agent").exists()
    assert not list(home.glob(".hermes-clone-*"))

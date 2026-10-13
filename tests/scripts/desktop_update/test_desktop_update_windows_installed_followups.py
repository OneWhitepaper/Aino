"""Installed update follow-up outcomes from the real Windows handoff."""

from pathlib import Path

import pytest

from tests.scripts.desktop_update.windows_handoff_support import assert_post_commit_followup


@pytest.mark.platforms('windows')
@pytest.mark.parametrize(('receipt', 'ok'), [('interrupted', True), ('partial', True)])
def test_nonzero_exit_after_the_commit_point_is_installed_with_a_followup(tmp_path: Path, receipt: str, ok: bool) -> None:
    assert_post_commit_followup(tmp_path, receipt, ok)

"""Windows marker format verdicts on real processes; bounded per-file case group."""
from pathlib import (
    Path,
)
import subprocess

import pytest

from tests.scripts.desktop_update.windows_handoff_support import (
    assert_marker_body,
)


pytest_plugins = ("tests.scripts.desktop_update.windows_handoff_support",)

@pytest.mark.platforms('windows')
@pytest.mark.parametrize('case', ['crlf-bom-v2', 'delegate-without-ct-is-ignored', 'fractional-started-at'])
def test_marker_bodies_are_parsed_positionally_like_every_other_reader(
    tmp_path: Path, sleeper: subprocess.Popen, case: str,
) -> None:
    assert_marker_body(tmp_path, sleeper, case)

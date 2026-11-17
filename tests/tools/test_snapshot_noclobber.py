"""Noclobber shells preserve bootstrap and later exported session state."""

import shutil

import pytest

from tools.environments.local import LocalEnvironment


@pytest.mark.platforms("posix")
@pytest.mark.skipif(not shutil.which("bash"), reason="needs bash")
@pytest.mark.parametrize("phase", ["bootstrap", "command"])
def test_noclobber_preserves_exported_session_state(tmp_path, monkeypatch, phase):
    startup = tmp_path / "bash-env"
    startup.write_text(
        'set -C\nif shopt -q login_shell; then export SNAPSHOT_TEST_VALUE=boot; fi\n'
        if phase == "bootstrap" else "")
    temp = tmp_path / "tmp"
    temp.mkdir()
    monkeypatch.setenv("TERMINAL_TEMP_DIR", str(temp))
    env = LocalEnvironment(
        cwd=str(tmp_path), timeout=10, env={"TMPDIR": str(temp), "BASH_ENV": str(startup)})
    try:
        expected = "boot"
        if phase == "command":
            saved = env.execute("set -C; export SNAPSHOT_TEST_VALUE=saved")
            assert saved["returncode"] == 0, saved
            expected = "saved"
        result = env.execute('printf "%s" "${SNAPSHOT_TEST_VALUE-}"')
    finally:
        env.cleanup()
    assert result["returncode"] == 0, result
    assert result["output"].strip() == expected, result

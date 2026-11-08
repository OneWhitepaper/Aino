"""Native calls in Windows PowerShell 5.1 must preserve their exit status."""

import pytest

from tests.scripts.install._install_ps1_test_support import dot_sourced


pytestmark = pytest.mark.platforms("windows")


def test_native_stderr_under_stop_leaves_the_exit_code_to_the_caller():
    result = dot_sourced('Invoke-Native { cmd /c "echo soft-failure 1>&2 & exit 3" 2>$null }; '
                         '"exit=$LASTEXITCODE preference=$ErrorActionPreference"')
    assert result.returncode == 0, result.stdout + result.stderr
    assert "exit=3 preference=Stop" in result.stdout


def test_path_uv_must_run_and_meet_the_pin(tmp_path):
    for name, body in {"old": "@echo uv 0.6.17", "new": "@echo uv 99.0.0 (abc 2099-01-01)",
                       "broken": "@echo boom 1>&2 & exit /b 1"}.items():
        (tmp_path / f"{name}.cmd").write_text(body + "\r\n")
    checks = "; ".join(f'"{name}=$(Test-UvAtLeastPin \'{tmp_path / (name + ".cmd")}\')"'
                        for name in ("old", "new", "broken"))
    result = dot_sourced(checks)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.split() == ["old=False", "new=True", "broken=False"]

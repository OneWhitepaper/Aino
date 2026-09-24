"""Real Git subprocess coverage for the suite's proxy isolation fixture."""

import os
import subprocess

import pytest


@pytest.mark.parametrize("omit_empty_values", [False, True])
def test_git_proxy_isolation_preserves_other_settings(tmp_path, monkeypatch, omit_empty_values):
    global_config = tmp_path / "global.gitconfig"
    global_config.write_text(
        '[http]\n\tproxy = http://127.0.0.1:1\n'
        '[https]\n\tproxy = http://127.0.0.1:2\n'
        '[user]\n\tname = Fixture Identity\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(global_config))
    # Child launchers may omit empty values; Git must still see a complete
    # override and keep unrelated global settings. No host OS is mocked.
    env = {key: value for key, value in os.environ.items() if value or not omit_empty_values}
    repo = tmp_path / "repo"
    initialized = subprocess.run(
        ["git", "init", "--quiet", str(repo)], env=env, capture_output=True, text=True,
    )
    assert initialized.returncode == 0, initialized.stderr

    for key, expected in (("http.proxy", ""), ("https.proxy", ""), ("user.name", "Fixture Identity")):
        result = subprocess.run(
            ["git", "-C", str(repo), "config", "--get", key],
            env=env, capture_output=True, text=True,
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == expected

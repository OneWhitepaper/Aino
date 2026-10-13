"""Regression: branded desktop bootstrap must be able to select its repository.

The desktop bootstrap can download an installer from a downstream repository
and pass it a downstream branch/commit.  The installer must then clone that
same repository instead of silently falling back to the upstream Hermes URL.
This test drives the real POSIX repository stage against a local bare Git
remote, so it does not depend on GitHub or the network.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
INSTALL_SH = REPO_ROOT / "scripts" / "install.sh"
INSTALL_PS1 = REPO_ROOT / "scripts" / "install.ps1"

pytestmark = pytest.mark.skipif(
    shutil.which("git") is None or shutil.which("bash") is None,
    reason="needs git and bash",
)


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "git",
            "-c",
            "user.email=aino-test@example.invalid",
            "-c",
            "user.name=Aino installer test",
            *args,
        ],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )


def _make_remote(tmp_path: Path) -> Path:
    seed = tmp_path / "seed"
    seed.mkdir()
    _git(seed, "init")
    (seed / "origin-marker.txt").write_text("downstream repository\n", encoding="utf-8")
    _git(seed, "add", "origin-marker.txt")
    _git(seed, "commit", "-m", "downstream installer fixture")
    _git(seed, "branch", "-M", "downstream")

    remote = tmp_path / "downstream.git"
    _git(tmp_path, "init", "--bare", str(remote))
    _git(seed, "remote", "add", "origin", str(remote))
    _git(seed, "push", "-u", "origin", "downstream")
    return remote


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("override", ["HERMES_INSTALL_REPOSITORY_URL", "HERMES_REPO_URL"])
def test_install_sh_repository_stage_uses_explicit_repository_urls(tmp_path: Path, override: str) -> None:
    remote = _make_remote(tmp_path)
    install_dir = tmp_path / "install"
    hermes_home = tmp_path / "home"

    env = os.environ.copy()
    env.update(
        {
            "HERMES_HOME": str(hermes_home),
            "HERMES_INSTALL_DIR": str(install_dir),
            override: str(remote),
        }
    )

    command = [
            "bash",
            str(INSTALL_SH),
            "--stage",
            "repository",
            "--non-interactive",
            "--json",
            "--branch",
            "downstream",
        ]
    for rerun in (False, True):
        if rerun:
            _git(install_dir, "remote", "set-url", "origin", str(tmp_path / "wrong.git"))
        result = subprocess.run(command, cwd=REPO_ROOT, env=env, capture_output=True,
                                text=True, check=False, timeout=60)
        assert result.returncode == 0, result.stderr + "\n" + result.stdout
        assert _git(install_dir, "remote", "get-url", "origin").stdout.strip() == str(remote)

    assert result.returncode == 0, result.stderr + "\n" + result.stdout
    assert (install_dir / "origin-marker.txt").read_text(encoding="utf-8") == "downstream repository\n"
    assert '"ok":true' in result.stdout.splitlines()[-1]



@pytest.mark.platforms("windows")
@pytest.mark.parametrize("override", ["HERMES_INSTALL_REPOSITORY_URL", "HERMES_REPO_URL"])
def test_install_ps1_repository_stage_uses_explicit_repository_urls(tmp_path: Path, override: str) -> None:
    remote = _make_remote(tmp_path)
    install_dir = tmp_path / "install"
    shell = shutil.which("powershell") or shutil.which("pwsh")
    assert shell, "native Windows acceptance requires PowerShell"
    script = tmp_path / "repository.ps1"
    script.write_text(
        '$ErrorActionPreference = "Stop"\n'
        '. $env:PROBE_INSTALLER -Branch downstream -InstallDir $env:PROBE_INSTALL_DIR '
        '-HermesHome $env:HERMES_HOME -NonInteractive\n'
        # Reuse the lane's Git; downloading a pinned tool is outside this repository test.
        'function Get-PinnedGit { return $env:PROBE_GIT }\n'
        'Stage-Repository\n', encoding="utf-8-sig")
    env = {**os.environ, override: str(remote), "HERMES_HOME": str(tmp_path / "home"),
           "PROBE_INSTALLER": str(INSTALL_PS1), "PROBE_INSTALL_DIR": str(install_dir),
           "PROBE_GIT": shutil.which("git")}
    for rerun in (False, True):
        if rerun:
            _git(install_dir, "remote", "set-url", "origin", str(tmp_path / "wrong.git"))
        result = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                                 "-File", str(script)], env=env, capture_output=True,
                                text=True, check=False, timeout=60)
        assert result.returncode == 0, result.stdout + result.stderr
        assert _git(install_dir, "remote", "get-url", "origin").stdout.strip() == str(remote)
        assert (install_dir / "origin-marker.txt").read_text(encoding="utf-8") == "downstream repository\n"

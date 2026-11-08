"""Shared fixtures for native Windows PowerShell installer tests."""

import json
import os
from pathlib import Path
import shutil
import subprocess


INSTALLER = Path(__file__).resolve().parents[3] / "scripts" / "install.ps1"


def powershell() -> str:
    executable = shutil.which("powershell")
    assert executable, "Windows PowerShell 5.1 is part of every supported Windows"
    return executable


def dot_sourced(body: str) -> subprocess.CompletedProcess:
    script = f'$ErrorActionPreference = "Stop"; . "{INSTALLER}"; {body}'
    return subprocess.run([powershell(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
                          capture_output=True, text=True, timeout=120, check=False)


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t", *args],
                          check=True, capture_output=True, text=True).stdout.strip()


def stage(origin: Path, home: Path, *extra: str, **env_extra: str) -> tuple[subprocess.CompletedProcess, dict]:
    env = dict(os.environ, HERMES_REPO_URL=str(origin), HERMES_HOME=str(home), **env_extra)
    result = subprocess.run([powershell(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(INSTALLER),
                             "-Stage", "repository", "-Json", *extra],
                            env=env, capture_output=True, text=True, timeout=180, check=False)
    frames = [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]
    assert len(frames) == 1, result.stdout + result.stderr
    return result, frames[0]


def pin_fixture(tmp_path: Path) -> tuple[Path, str, str]:
    """main: pin <- tip; side: a commit off main."""
    origin = tmp_path / "origin"
    origin.mkdir()
    git(origin, "init", "-q", "-b", "main")
    (origin / "README").write_text("one", encoding="utf-8")
    git(origin, "add", "README")
    git(origin, "commit", "-qm", "one")
    pin = git(origin, "rev-parse", "HEAD")
    (origin / "README").write_text("tip", encoding="utf-8")
    git(origin, "commit", "-qam", "tip")
    git(origin, "config", "uploadpack.allowFilter", "true")
    git(origin, "checkout", "-qb", "side")
    (origin / "README").write_text("side", encoding="utf-8")
    git(origin, "commit", "-qam", "side")
    off_branch = git(origin, "rev-parse", "HEAD")
    git(origin, "checkout", "-q", "main")
    return origin, pin, off_branch


def clone_argv(trace: Path) -> list[str]:
    [line] = [line for line in trace.read_text(encoding="utf-8-sig", errors="replace").splitlines()
              if "built-in: git clone " in line]
    return line.split("built-in: git clone ", 1)[1].split()


def rerun_fixture(tmp_path: Path) -> tuple[Path, Path, Path, str]:
    origin = tmp_path / "origin"
    origin.mkdir()
    git(origin, "init", "-q", "-b", "main")
    (origin / "README").write_text("one", encoding="utf-8")
    git(origin, "add", "README")
    git(origin, "commit", "-qm", "one")

    home = tmp_path / "home"
    home.mkdir()
    install = home / "hermes-agent"
    git(home, "clone", "--branch", "main", str(origin), str(install))

    (install / "README").write_text("local edit", encoding="utf-8")
    (origin / "README").write_text("two", encoding="utf-8")
    git(origin, "commit", "-qam", "two")
    git(origin, "checkout", "-qb", "side")
    (origin / "README").write_text("side", encoding="utf-8")
    git(origin, "commit", "-qam", "side")
    off_branch = git(origin, "rev-parse", "HEAD")
    git(origin, "checkout", "-q", "main")
    return origin, home, install, off_branch

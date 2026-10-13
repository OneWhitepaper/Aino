"""Real PowerShell fixture helpers for Windows build dependency contracts."""

from pathlib import Path
import os
import shutil
import subprocess

HELPER = Path(__file__).resolve().parents[2] / "scripts" / "windows-build-deps.ps1"
ENTRYPOINT = HELPER.parent / "build" / "windows-deps.ps1"


def _powershell(script, *args, env=None):
    env = dict(os.environ) if env is None else env
    env.setdefault("SystemRoot", r"C:\Windows")
    env.setdefault("ComSpec", str(Path(env["SystemRoot"]) / "System32/cmd.exe"))
    env.setdefault("PATHEXT", ".COM;.EXE;.BAT;.CMD")
    env.setdefault("SystemDrive", Path(env["SystemRoot"]).drive)
    shell = shutil.which("powershell") or str(
        Path(env["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    )
    return subprocess.run(
        [shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
         "-File", str(script), *map(str, args)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=180,
        check=False,
    )


def _github_environment(path):
    lines = iter(path.read_text(encoding="utf-8").splitlines())
    values = {}
    for line in lines:
        name, delimiter = line.split("<<", 1)
        value = []
        for line in lines:
            if line == delimiter:
                break
            value.append(line)
        else:
            raise AssertionError(f"unterminated GitHub environment value: {name}")
        values[name.upper()] = "\n".join(value)
    return values

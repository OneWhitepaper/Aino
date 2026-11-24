"""A reviewed import accepts only the frozen snapshot's inherited health findings."""
import os
from pathlib import Path
import subprocess

import hermes_yaml
import pytest

ROOT = Path(__file__).resolve().parents[2]
FROZEN_UPSTREAM = "352b249f67fb6a4a7d7904acaca9dd410db229e0"


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("importing", [True, False])
def test_health_import_receipt_names_the_snapshot_only_during_its_first_import(tmp_path, importing):
    workflow = hermes_yaml.safe_load((ROOT / ".github/workflows/lint.yml").read_text())
    (step,) = [step for job in workflow["jobs"].values() for step in job.get("steps", [])
               if "--accepted-upstream" in step.get("run", "")]
    tools = tmp_path / "bin"
    tools.mkdir()
    git = tools / "git"
    git.write_text('#!/bin/sh\n[ "$3" = "$FROZEN_UPSTREAM" ] || exit 1\n'
                   '[ "$4" = HEAD ] && exit 0\n[ "$IMPORTING" = false ]\n')
    git.chmod(0o755)
    log = tmp_path / "commands"
    for name in ("python", "just"):
        command = tools / name
        command.write_text(f'#!/bin/sh\nprintf "%s\\n" "{name} $*" >> "$COMMANDS"\n')
        command.chmod(0o755)
    result = subprocess.run(["bash", "-e", "-c", step["run"]], capture_output=True, text=True,
                            env={**os.environ, "PATH": str(tools) + os.pathsep + os.environ["PATH"],
                                 "FROZEN_UPSTREAM": FROZEN_UPSTREAM, "COMMANDS": str(log),
                                 "IMPORTING": str(importing).lower()}, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    expected = (f"python -m scripts.code_health --base HEAD^1 --accepted-upstream {FROZEN_UPSTREAM}"
                if importing else "just check --only health --base HEAD^1")
    assert log.read_text().splitlines() == [expected]

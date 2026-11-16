"""Select the existing PM test interpreter before installer acceptance changes homes."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

PROJECT = Path(__file__).resolve().parents[3]
# This selector also runs under the stdlib-only PM bootstrap interpreter.
sys.path.insert(0, str(PROJECT))


def selected_fixture_python(project: Path) -> Path:
    from pm.testenv import testenv_python

    python = testenv_python(project)
    if python is None:
        raise RuntimeError("Installer fixtures require the existing PM test-environment; "
                           "run setup-pm with test-environment: true and extras: '[]' before acceptance")
    return python.absolute()


PROBE = """
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from hermes_state import SessionDB

database = Path(sys.argv[2])
with SessionDB(db_path=database) as db:
    db.create_session('fixture-python-preflight', source='desktop', model='fixture-preflight')
    db.append_message('fixture-python-preflight', role='user', content='fixture dependency probe')
    db.append_message('fixture-python-preflight', role='assistant', content='fixture dependency ready')
with SessionDB(db_path=database) as db:
    rows = db.get_messages('fixture-python-preflight')
    assert [(row['role'], row['content']) for row in rows] == [
        ('user', 'fixture dependency probe'), ('assistant', 'fixture dependency ready')]
print(json.dumps({'python': str(Path(sys.executable).absolute()), 'version': sys.version,
                  'sessionDb': {'created': database.is_file(), 'messagesRead': len(rows)}}))
"""


def probe_fixture_python(python: Path, project: Path, work: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="fixture-python-", dir=work) as temporary:
        isolated = Path(temporary)
        home = isolated / "home"
        os_home = isolated / "os-home"
        home.mkdir()
        os_home.mkdir()
        env = {key: value for key, value in os.environ.items()
               if not key.upper().startswith(("HERMES_", "PYTHON", "VIRTUAL_ENV"))}
        env.update(HERMES_HOME=str(home), HERMES_RUNTIME_DIR=str(isolated / "runtime"),
                   HOME=str(os_home), USERPROFILE=str(os_home),
                   APPDATA=str(os_home / "AppData" / "Roaming"), LOCALAPPDATA=str(os_home / "AppData" / "Local"),
                   PYTHONPATH=str(project), PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
        result = subprocess.run([str(python), "-B", "-c", PROBE, str(project), str(home / "state.db")],
                                cwd=project, env=env, capture_output=True, text=True, encoding="utf-8",
                                timeout=60, check=False)
        if result.returncode:
            raise RuntimeError(f"SessionDB preflight failed for PM test interpreter {python}:\n{result.stderr.strip()}")
        receipt = json.loads(result.stdout)
        if receipt["sessionDb"] != {"created": True, "messagesRead": 2}:
            raise RuntimeError("SessionDB preflight failed to persist and reread the fixture messages")
        return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    try:
        python = selected_fixture_python(args.project.resolve())
        receipt = {"status": "passed", "selection": "pm-test-environment",
                   **probe_fixture_python(python, args.project.resolve(), args.work.resolve())}
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        args.report.write_text(json.dumps({"status": "failed", "error": str(error)}, indent=2) + "\n", encoding="utf-8")
        print(str(error), file=sys.stderr)
        return 1
    args.report.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(python)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

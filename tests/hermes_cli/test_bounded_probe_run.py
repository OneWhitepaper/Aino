"""``bounded_probe_run`` — deadlock-safe capture for fail-open probes (#87134).

On Windows, ``subprocess.run(..., capture_output=True, timeout=N)`` can hang
FOREVER after its timeout fires: run()'s cleanup kills the direct child and
then joins the pipe reader threads with an unbounded ``communicate()``.  A
descendant (``conhost.exe`` under wmic/powershell, ``git.exe`` under a
launcher shim) holding duplicated pipe handles keeps the pipes from EOF and
the join never returns.  ``hermes update`` wedged exactly there inside
``_scan_gateway_pids`` on machines where the full ``Win32_Process`` scan
exceeds its budget.

``bounded_probe_run`` is the shared, generalized form of the fix that
``bounded_git_probe`` already proved for git probes (#68609 / #66037):
explicit ``communicate(timeout)``, tree-kill on failure, bounded 1s drain,
then abandon.

These tests use REAL subprocesses (no mocks) for the semantics: a mock cannot
reproduce pipe-handle inheritance or timeout behavior.  The POSIX-only
descendant-survival cases live in ``test_git_probe_tree_kill.py`` and now
exercise the same code path through the ``bounded_git_probe`` delegation.
"""

import json
import os
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

from hermes_cli._subprocess_compat import bounded_git_probe, bounded_probe_run

_PY = sys.executable


@pytest.mark.parametrize("owned", [False, True])
def test_success_returns_completed_process(owned):
    result = bounded_probe_run([_PY, "-c", "print('ok'); import sys; sys.exit(0)"], timeout=30, owned=owned)
    assert result is not None
    assert result.returncode == 0
    assert result.stdout.strip() == "ok"


@pytest.mark.parametrize("owned", [False, True])
def test_nonzero_exit_is_returned_not_swallowed(owned):
    """Unlike bounded_git_probe, callers see the real returncode — the gateway
    scan branches on ``returncode != 0`` to trip the wmic→powershell fallback."""
    result = bounded_probe_run([_PY, "-c", "print('partial'); import sys; sys.exit(3)"], timeout=30, owned=owned)
    assert result is not None
    assert result.returncode == 3
    assert result.stdout.strip() == "partial"


@pytest.mark.parametrize("owned", [False, True])
@pytest.mark.parametrize("raise_on_spawn_failure", [False, True])
@pytest.mark.parametrize("argv, error", [
    (["definitely-not-a-real-binary-87134"], FileNotFoundError),
    pytest.param([], IndexError, marks=pytest.mark.platforms("posix")),
])
def test_spawn_failure_can_fail_open_or_raise(owned, raise_on_spawn_failure, argv, error):
    if raise_on_spawn_failure:
        with pytest.raises(error):
            bounded_probe_run(argv, timeout=5, owned=owned, raise_on_spawn_failure=True)
    else:
        assert bounded_probe_run(argv, timeout=5, owned=owned) is None


@pytest.mark.parametrize("owned", [False, True])
def test_timeout_returns_none_within_bounded_time(owned):
    """A child that sleeps past the timeout must produce ``None`` promptly —
    timeout + tree-kill + 1s bounded drain, not an unbounded join."""
    start = time.monotonic()
    result = bounded_probe_run(
        [_PY, "-c", "import time; time.sleep(300)"],
        timeout=1.0, owned=owned,
    )
    elapsed = time.monotonic() - start
    assert result is None
    # 1s timeout + tree-kill + 1s drain + slack.  The pre-fix failure mode is
    # an indefinite hang, so any bound proves the property; keep it loose for
    # slow CI runners.
    assert elapsed < 30


@pytest.mark.parametrize("owned", [False, True])
def test_decode_errors_configurable(owned):
    """The process scans pass errors='ignore' (wmic emits system code page);
    undecodable bytes must not raise or None out stdout (#17049 class)."""
    result = bounded_probe_run(
        [_PY, "-c", "import sys; sys.stdout.buffer.write(b'ok\\xff\\xfe')"],
        timeout=30,
        errors="ignore", owned=owned,
    )
    assert result is not None
    assert result.returncode == 0
    assert "ok" in result.stdout


@pytest.mark.parametrize("owned", [False, True])
def test_stdin_is_devnull_not_inherited(owned):
    """A probe must never block reading the caller's stdin."""
    result = bounded_probe_run(
        [_PY, "-c", "import sys; print(repr(sys.stdin.read()))"],
        timeout=30, owned=owned,
    )
    assert result is not None
    assert result.returncode == 0
    assert result.stdout.strip() == "''"


def test_bounded_git_probe_delegates_same_contract():
    """The historical git-probe wrapper keeps its exact contract on top of
    bounded_probe_run: stripped stdout on rc==0, '' on any failure."""
    assert bounded_git_probe([_PY, "-c", "print('  x  ')"], timeout=30) == "x"
    assert bounded_git_probe([_PY, "-c", "import sys; sys.exit(1)"], timeout=30) == ""
    assert bounded_git_probe(["definitely-not-a-real-binary-87134"], timeout=5) == ""


@pytest.mark.platforms("posix")  # POSIX process-group check
@pytest.mark.parametrize("owned", [False, True])
def test_posix_child_gets_own_process_group(owned):
    """POSIX spawns use process_group=0 so timeout cleanup can killpg the
    whole tree (same contract bounded_git_probe had)."""
    result = bounded_probe_run(
        [_PY, "-c", "import os; print(os.getpgid(0) == os.getpid())"],
        timeout=30, owned=owned,
    )
    assert result is not None
    assert result.stdout.strip() == "True"


@pytest.mark.parametrize("input", [None, "snowman: ☃\n"])
def test_owned_probe_preserves_io_arguments_environment_and_cwd(tmp_path, input):
    cwd = tmp_path / "working directory"
    cwd.mkdir()
    script = (
        "import json, os, sys; "
        "print(json.dumps([sys.stdin.read(), sys.argv[1], os.getcwd(), os.environ['PROBE_FIXTURE']]))"
    )
    argv = [_PY, "-c", script, "literal ; $() ' argument"]
    result = bounded_probe_run(argv, timeout=30, owned=True, input=input, cwd=cwd,
                               env={**os.environ, "PROBE_FIXTURE": "fixture-value"})
    assert result is not None
    assert result.returncode == 0
    assert result.args == argv
    assert json.loads(result.stdout) == [input or "", argv[-1], str(cwd.resolve()), "fixture-value"]


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("closed", [(0,), (1,), (2,), (0, 1, 2)],
                         ids=["stdin", "stdout", "stderr", "all-stdio"])
@pytest.mark.parametrize("input", [None, "snowman: ☃\n"])
@pytest.mark.parametrize("owned", [False, True])
def test_probe_with_closed_standard_descriptors(closed, input, owned):
    """Control pipes must not occupy a stdio descriptor Popen will replace in its child."""
    script = textwrap.dedent('''
        import json, os, sys
        from hermes_cli._subprocess_compat import bounded_probe_run
        from hermes_cli import process_identity
        from hermes_cli.local_runtime import processes

        closed, payload, owned = map(json.loads, sys.argv[1:4])
        command = [sys.executable, "-c",
                   "import sys; print(repr(sys.stdin.read())); sys.stderr.write('probe-stderr')"]
        for fd in closed:
            os.close(fd)
        result = bounded_probe_run(command, timeout=30, owned=owned, input=payload,
                                   raise_on_spawn_failure=True)
        assert result is not None
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == repr(payload or ""), result.stdout
        assert result.stderr == "probe-stderr", result.stderr
    ''')
    root = Path(__file__).resolve().parents[2]
    child = subprocess.run(
        [_PY, "-c", script, json.dumps(closed), json.dumps(input), json.dumps(owned)],
        cwd=root, env={**os.environ, "PYTHONPATH": str(root)}, capture_output=True, text=True,
        timeout=60, check=False,
    )
    assert child.returncode == 0, child.stdout + child.stderr

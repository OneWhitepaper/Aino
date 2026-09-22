"""Process-group cleanup preserves drained output and cleans up known descendants."""

import errno
import os
import shlex
import signal
import sys
import time
from types import SimpleNamespace

import psutil
import pytest

from tools.environments import local
from tools.environments.local import LocalEnvironment, _kill_process_group_posix
from tools.file_operations import ShellFileOperations


@pytest.mark.macos_only
@pytest.mark.parametrize("reap_before_cleanup", [False, True])
def test_native_search_cleans_up_exited_group(tmp_path, monkeypatch, reap_before_cleanup):
    """The search child can exit between its poll and process-group cleanup."""
    release = tmp_path / "release"
    script = (
        "import pathlib, sys, time\n"
        "print('match\\n' * 100, end='', flush=True)\n"
        "while not pathlib.Path(sys.argv[1]).exists():\n"
        "    time.sleep(0.01)\n"
    )
    env = LocalEnvironment(cwd=str(tmp_path))
    ops = ShellFileOperations(env, cwd=str(tmp_path))

    def cleanup_after_child_exit(proc):
        release.touch()
        try:
            child = psutil.Process(proc.pid)
            deadline = time.monotonic() + 5
            while child.status() != psutil.STATUS_ZOMBIE and time.monotonic() < deadline:
                time.sleep(0.01)
            assert child.status() == psutil.STATUS_ZOMBIE
            if reap_before_cleanup:
                proc.wait(timeout=5)

            _kill_process_group_posix(proc)

            assert proc.returncode == 0
            with pytest.raises(ProcessLookupError):
                os.killpg(proc.pid, 0)
        finally:
            proc.wait(timeout=5)

    monkeypatch.setattr(local, "_kill_process_group_posix", cleanup_after_child_exit)
    try:
        result = ops._run_rg_native(
            [shlex.quote(arg) for arg in (sys.executable, "-c", script, str(release))],
            fetch_limit=50, timeout=5,
        )

        assert result.exit_code == 0
        assert result.stdout.splitlines() == ["match"] * 50
    finally:
        release.touch()
        env.cleanup()


@pytest.mark.parametrize("shares_caller_group", [False, True])
def test_kill_process_group_falls_back_to_known_pids(monkeypatch, shares_caller_group):
    """Denied group signals and the caller's own group require PID-only cleanup."""
    killed = []
    proc = SimpleNamespace(pid=12345, poll=lambda: 0, kill=lambda: killed.append(12345))
    child = SimpleNamespace(pid=12346, is_running=lambda: True, kill=lambda: killed.append(12346))
    denied = PermissionError(errno.EPERM, "signal denied")
    group_signals = []

    def killpg(pgid, sig):
        assert pgid == proc.pid
        group_signals.append(sig)
        raise denied

    monkeypatch.setattr(os, "getpgid", lambda pid: proc.pid, raising=False)
    monkeypatch.setattr(os, "getpgrp", lambda: proc.pid if shares_caller_group else 67890, raising=False)
    monkeypatch.setattr(os, "killpg", killpg, raising=False)
    monkeypatch.setattr(psutil, "Process", lambda pid: SimpleNamespace(children=lambda recursive: [child]))

    _kill_process_group_posix(proc)

    assert killed == [proc.pid, child.pid]
    assert group_signals == ([] if shares_caller_group else [signal.SIGTERM])

"""The session teardown stops processes left running against this run's Hermes homes.

A test that runs a real ``hermes chat -q`` child gets a grandchild ``gateway run`` in its own
session; no per-test subprocess patch sees it, and pytest's tmp cleanup removes only directories.
"""
from __future__ import annotations

import os
import subprocess
import sys
from types import SimpleNamespace

import pytest

from tests import conftest as suite_conftest
from tests.waiting import wait_until


@pytest.mark.platforms("linux", "macos")
def test_unreadable_macos_process_does_not_abort_session_daemon_discovery(tmp_path, monkeypatch):
    import psutil

    def denied_environment():
        try:
            raise PermissionError("sysctl(KERN_PROCARGS2) denied")
        except PermissionError as exc:
            # psutil's macOS C extension can wrap a permission failure this way.
            raise SystemError("proc_environ returned a result with an exception set") from exc

    root = tmp_path / "session"
    processes = [
        SimpleNamespace(pid=-1, environ=denied_environment),
        SimpleNamespace(pid=-2, environ=lambda: {"HERMES_HOME": str(root / "test-home")}),
        SimpleNamespace(pid=-3, environ=lambda: {"HERMES_HOME": str(tmp_path / "outside")}),
    ]
    monkeypatch.setattr(psutil, "process_iter", lambda: iter(processes))

    assert suite_conftest._processes_with_hermes_home_under([root]) == [-2]


@pytest.mark.platforms("linux", "macos")
def test_unexpected_process_reader_system_error_remains_visible(tmp_path, monkeypatch):
    import psutil

    def broken_environment():
        raise SystemError("unexpected reader defect")

    monkeypatch.setattr(psutil, "process_iter", lambda: iter([
        SimpleNamespace(pid=-1, environ=broken_environment),
    ]))

    with pytest.raises(SystemError, match="unexpected reader defect"):
        suite_conftest._processes_with_hermes_home_under([tmp_path])


def _detached(env_home, marker):
    code = "import time\nwhile True: time.sleep(0.2)\n"
    env = {**os.environ, "HERMES_HOME": str(env_home), "LIVE_REAP_MARKER": marker}
    return subprocess.Popen([sys.executable, "-c", code], env=env, start_new_session=True,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


@pytest.mark.platforms("linux", "macos")
@pytest.mark.live_system_guard_bypass  # signals only the two children this test spawned
def test_session_teardown_terminates_daemons_under_the_session_basetemp_only(tmp_path):
    basetemp, elsewhere = tmp_path / "basetemp", tmp_path / "elsewhere"
    (basetemp / "t0" / "hermes").mkdir(parents=True)
    elsewhere.mkdir()
    inside = _detached(basetemp / "t0" / "hermes", "inside")
    outside = _detached(elsewhere, "outside")
    try:
        # Both children have exec'd with their HERMES_HOME (what the reaper reads via psutil environ()).
        wait_until(lambda: {inside.pid, outside.pid} <= set(suite_conftest._processes_with_hermes_home_under(
            [basetemp, elsewhere])), timeout=10, what='both detached children started')
        config = SimpleNamespace(_tmp_path_factory=SimpleNamespace(_basetemp=basetemp))
        reaped = suite_conftest._reap_session_hermes_processes(config)
        assert inside.pid in reaped and outside.pid not in reaped
        assert inside.wait(timeout=5) is not None
        assert outside.poll() is None, "a process outside this session's homes was signalled"
    finally:
        for proc in (inside, outside):
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=5)

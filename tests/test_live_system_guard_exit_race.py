"""The macOS signal guard preserves ESRCH without signaling foreign processes."""

import errno
import os
import signal
import subprocess
import sys
from types import SimpleNamespace

import psutil
import pytest

from tests.conftest import _live_system_guard


@pytest.fixture
def observed_guard(request):
    """Install the real guard over a primitive that forbids destructive signals."""
    calls = []
    probe = {"permission_denied": False}
    previous_kill = os.kill

    def probe_only(pid, sig, *args, **kwargs):
        calls.append((pid, sig))
        assert int(sig) == 0, "the guard forwarded a destructive signal"
        if probe["permission_denied"]:
            raise PermissionError(errno.EPERM, os.strerror(errno.EPERM))
        return previous_kill(pid, sig, *args, **kwargs)

    with pytest.MonkeyPatch.context() as patcher:
        patcher.setattr(os, "kill", probe_only)
        guard = _live_system_guard.__wrapped__(request, patcher)
        next(guard)
        try:
            yield calls, probe
        finally:
            next(guard, None)


@pytest.mark.platforms("macos")
def test_reaped_child_during_parent_walk_preserves_process_lookup_error(observed_guard, monkeypatch):
    calls, _ = observed_guard
    child = subprocess.Popen([sys.executable, "-c", "pass"])
    assert child.wait(timeout=5) == 0
    real_process = psutil.Process

    def disappeared_parents():
        raise psutil.NoSuchProcess(child.pid)

    def process_snapshot(pid):
        if pid == child.pid:
            # The initial Process lookup succeeded before the child was
            # reaped; only the following ancestry lookup sees it disappear.
            return SimpleNamespace(parents=disappeared_parents)
        return real_process(pid)

    monkeypatch.setattr(psutil, "Process", process_snapshot)
    with pytest.raises(ProcessLookupError) as error:
        os.kill(child.pid, signal.SIGTERM)
    assert error.value.errno == errno.ESRCH
    assert calls == [(child.pid, 0)]


@pytest.mark.platforms("macos")
@pytest.mark.parametrize("permission_denied", [False, True])
def test_live_foreign_pid_never_receives_a_destructive_signal(observed_guard, permission_denied):
    calls, probe = observed_guard
    foreign_pid = os.getppid()
    assert foreign_pid > 0 and foreign_pid != os.getpid()
    probe["permission_denied"] = permission_denied

    with pytest.raises(RuntimeError, match="outside the test process subtree"):
        os.kill(foreign_pid, signal.SIGTERM)
    assert calls == [(foreign_pid, 0)]

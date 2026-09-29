"""POSIX process-tree cleanup for ``bounded_git_probe`` (port of openai/codex#36793).

Timing out a git probe must not leave helper descendants (credential helpers,
``git-remote-https``, hook children) running after the probe returns. The
probe spawns the child in its own process group (``process_group=0``) and
``kill_process_tree`` signals the whole group with ``os.killpg`` — but
only when the child actually leads its own group, so a shared-group spawn can
never take down unrelated processes.

These tests use real subprocesses: group membership and survival must come
from the host OS. The timeout test waits for its descendant to be ready
before starting the probe timer.
"""

import os
import subprocess
import sys
import textwrap
import time

import pytest

from hermes_cli._subprocess_compat import bounded_git_probe, kill_process_tree
from hermes_cli.local_runtime import processes

pytestmark = pytest.mark.skipif(
    sys.platform == "win32", reason="POSIX process-group semantics"
)


def _write_forking_script(tmp_path, marker_name="child.pid"):
    """A fake ``git`` that forks a long-lived descendant, then stalls."""
    marker = tmp_path / marker_name
    script = tmp_path / "fakegit.sh"
    script.write_text(
        textwrap.dedent(
            f"""\
            #!/bin/bash
            sleep 300 &
            echo $! > {marker}
            sleep 300
            """
        )
    )
    script.chmod(0o755)
    return script, marker


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def _wait_marker(marker, timeout=5.0) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if marker.exists() and marker.read_text().strip():
            return int(marker.read_text().strip())
        time.sleep(0.05)
    raise AssertionError("forking script never wrote its descendant pid")


def test_timeout_kills_descendants(tmp_path, monkeypatch):
    """A probe timeout must take the descendant down with the launcher."""
    script, marker = _write_forking_script(tmp_path)
    real_spawn = processes.spawn_server
    spawned = []

    def spawn_when_ready(*args, **kwargs):
        proc, job = real_spawn(*args, **kwargs)
        spawned.append(proc)
        # The assertion is about killing an existing descendant, not whether
        # a loaded runner can schedule the shell before the probe times out.
        _wait_marker(marker)
        return proc, job

    monkeypatch.setattr(processes, "spawn_server", spawn_when_ready)
    try:
        out = bounded_git_probe([str(script)], timeout=2.0)
        assert out == ""

        child_pid = _wait_marker(marker)
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline and _pid_alive(child_pid):
            time.sleep(0.05)
        alive = _pid_alive(child_pid)
        if alive:  # cleanup so a failure doesn't leak a 300s sleeper
            os.kill(child_pid, 9)
        assert not alive, f"descendant {child_pid} survived probe timeout"
    finally:
        for proc in spawned:
            kill_process_tree(proc)
            proc.wait(timeout=5)


def test_posix_spawn_uses_own_process_group(tmp_path):
    """The probe child must lead its own process group (killpg precondition)."""
    script = tmp_path / "pgid.sh"
    script.write_text("#!/bin/bash\necho \"$$ $(ps -o pgid= -p $$ | tr -d ' ')\"\n")
    script.chmod(0o755)

    out = bounded_git_probe([str(script)], timeout=5.0)
    pid, pgid = out.split()
    assert pid == pgid, f"probe child pid={pid} does not lead its group pgid={pgid}"
    assert int(pgid) != os.getpgid(0), "probe child must not share our group"


def test_group_kill_skipped_when_child_shares_our_group():
    """kill_process_tree must never killpg a group the child doesn't lead.

    Spawn WITHOUT process_group=0 (child inherits OUR group): the ownership
    check (pgid == pid) must skip the group signal, or the test process itself
    would die here.
    """
    proc = subprocess.Popen(
        ["sleep", "60"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )
    assert os.getpgid(proc.pid) == os.getpgid(0)  # shared group precondition
    kill_process_tree(proc)
    proc.wait(timeout=5)
    # We are alive to make this assertion — killpg on our own group would have
    # taken the test runner down. The direct child is still killed.
    assert proc.returncode is not None


def test_fast_path_unaffected(tmp_path):
    """Successful probes behave exactly as before the group-kill port."""
    subprocess.run(["git", "init", "-q", str(tmp_path / "repo")], check=True)
    out = bounded_git_probe(
        ["git", "-C", str(tmp_path / "repo"), "rev-parse", "--is-inside-work-tree"],
        timeout=10,
    )
    assert out == "true"


def test_kill_helper_swallow_all_failures():
    """Cleanup on the fail-open path must never raise, even for a reaped pid."""

    class _Dead:
        pid = 2**22  # extremely unlikely to exist
        def kill(self):
            raise OSError("already reaped")

    kill_process_tree(_Dead())  # must not raise

"""The passive update check's remote git dies with the CLI that started it.

``hermes chat`` starts ``check_for_updates`` in a daemon thread at startup; on an official
checkout it resolves the stable release and verifies the tag with ``git ls-remote --tags origin``,
which forks ``git remote-https``. A ``/exit`` while that lookup waits on GitHub abandoned the
thread, and the git process and its helper reparented to init and kept running (the 0.23.2
release E2E caught them in ``test_terminal_transcript_pty.py[cli-turns]``).

Real processes, no mocks of process semantics: a child interpreter runs the real
``resolve_source_release`` from a daemon thread against a fake ``git`` that forks a helper and
hangs, then exits the way the CLI does. Both the git and its helper must be gone afterwards.
"""

import os
import signal
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from hermes_cli._subprocess_compat import pid_exists_stdlib
from tests.waiting import wait_until

pytestmark = [
    pytest.mark.platforms("posix"),  # the owner-death supervisor is POSIX
    # Cleanup SIGKILLs the fake git's pids if they outlived the child: reparented to init, they are
    # outside this test's process subtree but still ours.
    pytest.mark.live_system_guard_bypass,
]

REPO = Path(__file__).resolve().parents[2]
SHA = "a" * 40

_CHILD = textwrap.dedent('''
    import sys, threading
    from hermes_cli import source_releases

    fake_git, cwd, marker = sys.argv[1:4]
    answers = {
        "https://api.github.com/repos/o/r/releases/latest":
            {"draft": False, "prerelease": False, "tag_name": "v1.2.3"},
        "https://api.github.com/repos/o/r/commits/v1.2.3": {"sha": "@SHA@"},
    }
    source_releases._json = answers.__getitem__  # GitHub's answers; only git is left to wait on

    threading.Thread(target=source_releases.resolve_source_release, daemon=True,
                     args=("stable", [fake_git], cwd), kwargs={"repository": "o/r", "pointer": False}).start()
    # Exit as /exit does, once the lookup's git and its helper are both running.
    import pathlib, time
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and len(pathlib.Path(marker).read_text().split()) < 2:
        time.sleep(0.05)
''').replace("@SHA@", SHA)

_HANDOFF_CHILD = textwrap.dedent('''
    import os, pathlib, signal, sys, threading
    from hermes_cli import process_identity, source_check

    fake_git, cwd, handoff, death = sys.argv[1:5]
    parked = threading.Event()
    resume = threading.Event()
    own_groups = process_identity.own_process_groups

    def delayed_handoff(pgids):
        pathlib.Path(handoff).write_text(" ".join(map(str, pgids)))
        parked.set()
        resume.wait()
        own_groups(pgids)

    process_identity.own_process_groups = delayed_handoff
    threading.Thread(target=source_check.remote_git_run, daemon=True,
                     args=([fake_git, "ls-remote"],), kwargs={"cwd": cwd, "timeout": 60}).start()
    assert parked.wait(30), "the remote probe never reached its ownership handoff"
    if death == "sigkill":
        os.kill(os.getpid(), signal.SIGKILL)
''')

_FAILED_HANDOFF_CHILD = textwrap.dedent('''
    import errno, os, signal, sys
    from hermes_cli import process_identity
    from hermes_cli._subprocess_compat import bounded_probe_run, pid_exists_stdlib
    from tests.waiting import wait_until

    mode = sys.argv[1]
    assert not process_identity._supervised_pgids
    own_groups = process_identity.own_process_groups
    groups = []

    class HandoffAbort(BaseException):
        pass

    abort = HandoffAbort("interrupted ownership handoff")

    def own_then_lose_launcher(pgids):
        own_groups(pgids)
        groups.extend(pgids)
        assert set(pgids) <= process_identity._supervised_pgids
        for pid in pgids:
            os.kill(pid, signal.SIGKILL)
        wait_until(lambda: not any(map(pid_exists_stdlib, pgids)), timeout=15,
                   what="the registered launcher's death before gate write")
        if mode == "abort":
            raise abort

    process_identity.own_process_groups = own_then_lose_launcher
    command = [sys.executable, "-c", "print('probe')"]
    try:
        try:
            result = bounded_probe_run(command, timeout=30, owned=True,
                                       raise_on_spawn_failure=(mode == "raise"))
        except BrokenPipeError as exc:
            assert mode == "raise", repr(exc)
            assert exc.errno == errno.EPIPE
        except HandoffAbort as exc:
            assert mode == "abort" and exc is abort
        else:
            assert mode == "return-none" and result is None
        assert groups
        remaining = set(process_identity._supervised_pgids)
        assert not remaining, remaining
    finally:
        for pgid in groups:
            process_identity.release_process_group_once_empty(pgid, timeout=0)
''')



def test_exit_during_the_stable_tag_lookup_leaves_no_git_behind(tmp_path):
    marker = tmp_path / "pids"
    marker.write_text("")
    fake_git = tmp_path / "git"
    # ls-remote's shape: the git process plus a forked transport helper, both waiting on the network.
    fake_git.write_text(textwrap.dedent(f"""\
        #!/bin/sh
        sleep 300 &
        echo $$ $! >> {marker}
        wait
    """))
    fake_git.chmod(0o755)
    home = tmp_path / "hermes-home"
    home.mkdir()
    env = {**os.environ, "HERMES_HOME": str(home), "PYTHONPATH": str(REPO)}
    pids: list[int] = []
    try:
        child = subprocess.run([sys.executable, "-c", _CHILD, str(fake_git), str(tmp_path), str(marker)],
                               cwd=REPO, env=env, capture_output=True, text=True, timeout=60, check=False)
        pids = [int(p) for p in marker.read_text().split()]
        assert child.returncode == 0, child.stderr
        assert len(pids) == 2, f"the fake git never ran: {child.stderr}"
        wait_until(lambda: not any(map(pid_exists_stdlib, pids)), timeout=15,
                   what="the update check's git and its helper to die with the CLI")
    finally:
        for pid in pids:
            try:
                os.kill(pid, 9)
            except ProcessLookupError:
                pass


@pytest.mark.parametrize("death", ["exit", "sigkill"])
def test_exit_during_probe_ownership_handoff_leaves_no_child(tmp_path, death):
    """A descheduled daemon must not leave an already-spawned probe outside containment."""
    handoff = tmp_path / "handoff"
    marker = tmp_path / "pids"
    marker.write_text("")
    fake_git = tmp_path / "git"
    fake_git.write_text(textwrap.dedent(f"""\
        #!/bin/sh
        sleep 300 &
        echo $$ $! >> {marker}
        wait
    """))
    fake_git.chmod(0o755)
    home = tmp_path / "hermes-home"
    home.mkdir()
    env = {**os.environ, "HERMES_HOME": str(home), "PYTHONPATH": str(REPO)}
    pids: list[int] = []
    try:
        child = subprocess.run(
            [sys.executable, "-c", _HANDOFF_CHILD, str(fake_git), str(tmp_path), str(handoff), death],
            cwd=REPO, env=env, capture_output=True, text=True, timeout=60, check=False,
        )
        pids = [int(pid) for pid in handoff.read_text().split()]
        pids.extend(int(pid) for pid in marker.read_text().split())
        assert child.returncode == (0 if death == "exit" else -signal.SIGKILL), child.stderr
        assert pids, "the remote probe never spawned"
        wait_until(lambda: not any(map(pid_exists_stdlib, pids)), timeout=15,
                   what="the unacknowledged probe to die with its owner")
    finally:
        pids.extend(int(pid) for pid in marker.read_text().split())
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


@pytest.mark.parametrize("mode", ["return-none", "raise", "abort"])
def test_failed_handoff_releases_the_actual_owned_group(mode):
    """A dead launcher must be unregistered even when handing it ownership raises."""
    child = subprocess.run(
        [sys.executable, "-c", _FAILED_HANDOFF_CHILD, mode], cwd=REPO,
        env={**os.environ, "PYTHONPATH": str(REPO)}, capture_output=True, text=True,
        timeout=60, check=False,
    )
    assert child.returncode == 0, child.stdout + child.stderr

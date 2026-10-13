"""Shared helpers for the real-process Windows hand-off protocol tests (not collected)."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

import pytest

from tests.installation_launcher_fixture import publish_fixture_launcher


ROOT = Path(__file__).resolve().parent.parent.parent.parent
SCRIPT = ROOT / 'scripts/desktop-update/windows.ps1'
MARKER_PS1 = ROOT / 'scripts/desktop-update/marker.ps1'
MARKER = '.hermes-update-in-progress'
POWERSHELL = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'),
                          'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
HOLD_CLI = """
import os, sys, time
from pathlib import Path
def main():
    if '--version' in sys.argv:
        print('Install directory: ' + str(Path(__file__).resolve().parents[1])); return 0
    if '--help' in sys.argv:
        if help_hold := os.environ.get('HANDOFF_HELP_HOLD'):
            Path(help_hold + '.ready').touch()
            while not Path(help_hold).exists():
                time.sleep(0.05)
        print('--keep-stash'); return 0
    if sys.argv[1:2] == ['update']:   # the update's first act: say so, then wait to be released
        hold = Path(os.environ['HANDOFF_HOLD'])
        Path(str(hold) + '.pid').write_text(str(os.getpid()), encoding='utf-8')
        while not hold.exists():
            time.sleep(0.05)
    return 0
if __name__ == '__main__':
    sys.exit(main())
"""


def _ps(command: str, timeout: int = 60) -> str:
    return subprocess.run([POWERSHELL, '-NoProfile', '-Command', command],
                          capture_output=True, text=True, timeout=timeout, check=True).stdout.strip()


def _creation_time(pid: int) -> str:
    out = _ps(f"$c = (Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CreationDate; "
              "[DateTimeOffset]::new($c.ToUniversalTime()).ToUnixTimeMilliseconds().ToString()")
    return f'{int(out) / 1000:.3f}'


def _alive(pid: int) -> bool:
    return str(pid) in subprocess.run(['tasklist', '/FI', f'PID eq {pid}', '/NH'],
                                      capture_output=True, text=True, check=False).stdout


def _dead_pid() -> int:
    proc = subprocess.Popen([sys.executable, '-c', 'pass'])
    proc.wait()
    return proc.pid


def _env(home: Path, **extra: str) -> dict[str, str]:
    return {**os.environ, 'HERMES_HOME': str(home), 'HERMES_RUNTIME_DIR': str(home / 'empty-store'), **extra}


def _script(home: Path, *args: str, install: Path | None = None, **env: str) -> subprocess.Popen:
    return subprocess.Popen(
        [POWERSHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(SCRIPT),
         '-InstallRoot', str(install or home / 'hermes-agent'), '-NoUi', *args],
        cwd=home, env=_env(home, **env), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def _finish(proc: subprocess.Popen, timeout: int = 120) -> tuple[int, str]:
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True, check=False)
        out, _ = proc.communicate()
        pytest.fail(f'hand-off did not finish within {timeout}s: {out}')
    return proc.returncode, out


def _op(home: Path, *args: str) -> tuple[int, str, str]:
    proc = subprocess.run(
        [POWERSHELL, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(SCRIPT),
         '-InstallRoot', str(home / 'hermes-agent'), *args],
        cwd=home, env=_env(home), capture_output=True, text=True, timeout=120, check=False)
    return proc.returncode, proc.stdout, proc.stderr


def _log(home: Path) -> str:
    """The hand-off log so far. windows.ps1 appends with Add-Content, which holds the file without
    read sharing for the length of each write: a read landing in that window is a sharing
    violation (PermissionError), not a missing line, so it is retried."""
    path = home / 'logs/desktop-update-handoff.log'
    for _ in range(50):
        try:
            return path.read_text(encoding='utf-8-sig') if path.exists() else ''
        except PermissionError:
            time.sleep(0.1)
    return path.read_text(encoding='utf-8-sig')


def _custodian(home: Path, handoff: int) -> str:
    """The pid windows.ps1 names on line 1 before any update work starts: its custodian, which
    outlives the hand-off so an old Desktop never reads a dead owner ('' until it is named)."""
    found = re.search(rf'names its custodian pid (\d+) \(hand-off pid {handoff}\)', _log(home))
    return found.group(1) if found else ''


class _HeldLock:
    """Hold the A7 sidecar lock from another process (this one): an open handle
    conflicts with the script's FileShare.None open."""

    def __init__(self, home: Path) -> None:
        deadline = time.monotonic() + 30
        while True:
            try:
                self._f = open(home / (MARKER + '.lock'), 'a+b')   # windows-footgun: ok — binary mode
                return
            except PermissionError:   # the script holds it right now
                assert time.monotonic() < deadline, 'never got the marker lock'
                time.sleep(0.02)

    def release(self) -> None:
        self._f.close()


def _wait_for_log(home: Path, needle: str, timeout: int = 90) -> str:
    deadline = time.monotonic() + timeout
    while needle not in _log(home):
        assert time.monotonic() < deadline, f'{needle!r} never logged: {_log(home)}'
        time.sleep(0.1)
    return _log(home)


OUTCOME_CLI = """
import ctypes, json, os, subprocess, sys, time
from pathlib import Path
def main():
    if '--version' in sys.argv:
        print('Install directory: ' + str(Path(__file__).resolve().parents[1])); return 0
    if '--help' in sys.argv:
        if os.environ.get('HANDOFF_HELP_HANG'):
            time.sleep(600)
        print('--keep-stash'); return 0
    with Path(os.environ['HANDOFF_CALLS']).open('a') as stream:
        stream.write(json.dumps(sys.argv[1:]) + '\\n')
    if sys.argv[1:2] != ['update']:
        return 0
    busy = float(os.environ.get('HANDOFF_BUSY_SECONDS', '0'))
    end = time.monotonic() + busy
    while time.monotonic() < end:   # pipe-silent, CPU-busy (download/extract shape)
        pass
    if os.environ.get('HANDOFF_DELEGATE'):
        # Leave a live process running under the claim, named on line 4.
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)'],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        Path(os.environ['HANDOFF_DELEGATE']).write_text(str(child.pid))
        # update_lock's delegate line: pid + creation time (GetProcessTimes, limited rights).
        k32 = ctypes.windll.kernel32
        k32.OpenProcess.restype = ctypes.c_void_p
        handle = ctypes.c_void_p(k32.OpenProcess(0x1000, False, child.pid))
        times = [ctypes.c_ulonglong() for _ in range(4)]
        k32.GetProcessTimes(handle, *[ctypes.byref(t) for t in times])
        k32.CloseHandle(handle)
        ct = times[0].value / 1e7 - 11644473600
        marker = Path(os.environ['HERMES_HOME']) / '.hermes-update-in-progress'
        head = marker.read_bytes().decode().split('\\n')[:3]
        marker.write_bytes(('\\n'.join(head) + '\\ndelegate:%d ct:%.3f\\n' % (child.pid, ct)).encode())
    if os.environ.get('HANDOFF_HANG'):
        print(os.environ['HANDOFF_HANG'], flush=True)
        time.sleep(300)
    receipt = os.environ.get('HANDOFF_RECEIPT')   # this run's finalized receipt: outcome[,correlation]
    if receipt:
        outcome, correlation = (receipt.split(',') + [''])[:2]
        path = Path(os.environ['HERMES_HOME']) / 'logs' / 'update_receipts' / 'latest.json'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'correlation_id': correlation or os.environ.get('HERMES_UPDATE_CORRELATION_ID'),
                                    'outcome': outcome, 'finished_at': '2026-10-05T12:00:00+00:00'}, indent=2),
                        encoding='utf-8')
        return int(os.environ.get('HANDOFF_EXIT', '0'))
    print('Update complete!', flush=True)
    return 0
if __name__ == '__main__':
    sys.exit(main())
"""


def outcome_handoff(tmp_path: Path, *args: str, verify: str = 'pass\n', timeout: int = 150, prepare=None, on_started=None, **env: str):
    install = tmp_path / 'checkout'
    publish_fixture_launcher(install, OUTCOME_CLI)
    (install / 'hermes_cli/desktop_update_verify.py').write_text(verify, encoding='utf-8')
    home = tmp_path / 'home'; home.mkdir()
    if prepare is not None:
        prepare(home, install)
    calls = tmp_path / 'calls.jsonl'
    proc = subprocess.Popen(
        ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(SCRIPT),
         '-InstallRoot', str(install), '-NoUi', *args],
        cwd=tmp_path, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        env={**os.environ, 'HERMES_HOME': str(home), 'HERMES_RUNTIME_DIR': str(tmp_path / 'empty-store'),
             'HANDOFF_CALLS': str(calls), 'PYTHONIOENCODING': 'utf-8', **env},
    )
    try:
        if on_started is not None:
            on_started(home)
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True, check=False)
        out, _ = proc.communicate()
        pytest.fail(f'hand-off did not finish within {timeout}s: {out}')
    finally:
        if proc.poll() is None:
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True, check=False)
            proc.communicate()
    argv = [json.loads(line) for line in calls.read_text(encoding='utf-8-sig').splitlines()] if calls.exists() else []
    result_path = home / '.hermes-update-result.json'
    result = json.loads(result_path.read_text(encoding='utf-8-sig')) if result_path.is_file() else None
    return proc.returncode, out, argv, result, home


def assert_post_commit_followup(tmp_path: Path, receipt: str, ok: bool) -> None:
    # Contract C3: `hermes update` exits 130 / 1 AFTER its commit point (Ctrl-C after the code
    # moved, a parked autostash). Its own receipt (matched by the correlation id) says so: the
    # result must report the update installed with an owed follow-up, never "update failed".
    code, out, argv, result, _ = outcome_handoff(tmp_path, HANDOFF_RECEIPT=receipt, HANDOFF_EXIT='130')
    if ok:
        assert code == 0, out
        assert (result['ok'], result['exit_code'], result['manual']) == (True, 0, True), result
        assert result['message'].startswith('Hermes was updated, but'), result
        assert [w.split(':')[0] for w in result['warnings']] == ['update'], result
        assert argv[-1] == ['gateway', 'start', '--all'], argv   # the post-commit steps still run
    else:
        assert code == 130, out
        assert (result['ok'], result['exit_code']) == (False, 130), result

"""The Windows handoff writes numeric Unix seconds under comma-decimal locales."""

import json
import re
import os
from pathlib import Path
import shutil
import subprocess
import time

import pytest

from tests.scripts.desktop_update.windows_handoff_support import outcome_handoff
from tests.scripts.desktop_update.windows_handoff_support import _wait_for_log
from tests.waiting import wait_until


@pytest.mark.platforms("windows")
def test_windows_update_writes_locale_independent_marker_and_result(tmp_path, monkeypatch):
    shell = shutil.which("powershell.exe")
    assert shell, "native Windows acceptance requires PowerShell"
    script = Path(__file__).resolve().parent.parent.parent.parent / "scripts/desktop-update/windows.ps1"
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.delenv("HERMES_UPDATE_STARTED_AT", raising=False)
    # -SelfTestMarker runs the actual claim and finally/result publication,
    # but never updates a checkout, waits on Desktop, or launches processes.
    command = (
        "[Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo('es-ES'); "
        "& $env:HERMES_TIMESTAMP_TEST_SCRIPT -InstallRoot $env:HERMES_HOME -NoUi -NoMarkerCleanup -SelfTestMarker"
    )
    started = int(time.time())
    result = subprocess.run([shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
                            env={**os.environ, "HERMES_TIMESTAMP_TEST_SCRIPT": str(script)},
                            capture_output=True, text=True, timeout=60, check=False)
    finished = int(time.time())
    assert result.returncode == 0, result.stdout + result.stderr
    marker = (tmp_path / ".hermes-update-in-progress").read_text(encoding="utf-8-sig").splitlines()
    receipt = json.loads((tmp_path / ".hermes-update-result.json").read_text(encoding="utf-8-sig"))
    # v2 body (contract C1): the creation-time line is culture-invariant too,
    # and the claim names its stable run identity (receipt correlation).
    assert len(marker) == 4 and int(marker[0]) > 0
    assert re.fullmatch(r"ct:\d+\.\d{3}", marker[2]), marker
    assert re.fullmatch(r"run:[A-Za-z0-9._-]{1,128}", marker[3]), marker
    assert started <= int(marker[1]) <= finished
    assert type(receipt["finished_at"]) is int
    assert started <= receipt["finished_at"] <= finished
    assert receipt["exit_code"] == 0


@pytest.mark.platforms('windows')
def test_result_is_atomic_json_carrying_started_at_and_warnings(tmp_path: Path) -> None:
    started = int(time.time()) - 5
    code, out, _, result, home = outcome_handoff(tmp_path, HERMES_UPDATE_STARTED_AT=str(started))
    assert code == 0, out
    assert (result['ok'], result['started_at'], result['warnings']) == (True, started, []), result
    assert not list(home.glob('.hermes-update-result.json.*.tmp'))


@pytest.mark.platforms('windows')
def test_result_finished_at_is_stamped_after_the_r6_release_wait(tmp_path: Path) -> None:
    # Keep the real byte-range lock until the hand-off reaches R6. A fixed
    # 25s holder can exit before startup finishes on a busy Windows runner.
    import msvcrt

    checkout_lock = None
    released_at = None
    initial_finished_at = None

    def hold_checkout(_home: Path, install: Path) -> None:
        nonlocal checkout_lock
        checkout_lock = (install / '.hermes-update.lock').open('w+b')
        checkout_lock.seek(1 << 20)
        msvcrt.locking(checkout_lock.fileno(), msvcrt.LK_NBLCK, 1)

    def release_checkout(home: Path) -> None:
        nonlocal released_at, initial_finished_at
        _wait_for_log(home, 'keeping the update marker')
        result_path = home / '.hermes-update-result.json'
        initial_finished_at = json.loads(result_path.read_text(encoding='utf-8-sig'))['finished_at']
        # finished_at has whole-second resolution; cross it while R6 is blocked
        # so the original pre-release stamp cannot satisfy the assertion.
        wait_until(lambda: time.time() >= initial_finished_at + 2, timeout=5,
                   what='the result timestamp predates checkout release')
        released_at = int(time.time())
        checkout_lock.close()

    try:
        code, out, _, result, _ = outcome_handoff(
            tmp_path, '-NoGateway', prepare=hold_checkout, on_started=release_checkout)
    finally:
        if checkout_lock is not None:
            checkout_lock.close()
    assert code == 0, out
    assert result['ok'] is True
    assert result['finished_at'] >= released_at > initial_finished_at, result

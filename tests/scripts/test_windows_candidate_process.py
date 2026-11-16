"""Candidate native tools must not hide a stalled signer behind the full build budget."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

import psutil
import pytest

from scripts.ci import windows_installer_candidate as candidate


def test_silent_owned_tool_times_out_with_activity_evidence_and_is_reaped(tmp_path):
    pid_file = tmp_path / "owned.pid"
    log = tmp_path / "bundle-sign.log"
    script = (
        "import os,sys,threading; from pathlib import Path; "
        "Path(sys.argv[1]).write_text(str(os.getpid())); threading.Event().wait(30)"
    )
    started = time.monotonic()
    with pytest.raises(subprocess.TimeoutExpired):
        candidate.run([sys.executable, "-c", script, str(pid_file)], os.environ, log=log, timeout=2)
    assert time.monotonic() - started < 8
    assert not psutil.pid_exists(int(pid_file.read_text()))
    proof = json.loads(log.with_suffix(".progress.json").read_text())
    assert proof["status"] == "timed-out"
    assert proof["operation"] == "bundle-sign"
    assert proof["elapsedSeconds"] >= 2
    assert proof["pid"] == int(pid_file.read_text())
    assert proof["outputBytes"] == 0


def test_running_tool_heartbeat_exposes_activity_before_completion_without_private_arguments(tmp_path, monkeypatch):
    signal = tmp_path / "private-signal-path"
    log = tmp_path / "bundle-sign.log"
    activity = []

    def console(message, **_options):
        if not str(message).startswith("[candidate-progress] "):
            return
        value = json.loads(message.removeprefix("[candidate-progress] "))
        if value["status"] != "running" or activity:
            return
        assert not signal.exists()
        assert value["operation"] == "bundle-sign"
        assert value["queryStatus"] == "ok"
        assert value["cpuSeconds"] >= 0
        assert value["rssBytes"] > 0
        assert "private-signal-path" not in message
        assert "private-environment-sentinel" not in message
        activity.append(value)
        signal.touch()

    monkeypatch.setattr(candidate, "print", console, raising=False)
    monkeypatch.setattr(candidate, "CHILD_HEARTBEAT_SECONDS", 0.2, raising=False)
    script = (
        "import sys; from pathlib import Path; from tests.waiting import wait_until; "
        "wait_until(Path(sys.argv[1]).exists, timeout=6, what='parent activity heartbeat')"
    )
    env = {**os.environ, "AINO_CANDIDATE_PRIVATE_SENTINEL": "private-environment-sentinel"}
    assert candidate.run([sys.executable, "-c", script, str(signal)], env, log=log, timeout=8) == ""
    assert activity
    proof = json.loads(log.with_suffix(".progress.json").read_text())
    assert proof["status"] == "completed"
    assert proof["returncode"] == 0

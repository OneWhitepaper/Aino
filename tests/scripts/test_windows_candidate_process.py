"""Candidate native tools must not hide a stalled signer behind the full build budget."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time

import pytest

from hermes_cli._subprocess_compat import kill_process_tree, pid_exists_stdlib
from scripts.ci import windows_installer_candidate as candidate
from tests.waiting import wait_until


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
    # Termination is asynchronous on Windows; a retained process object can
    # still appear in PID enumeration after its execution has ended.
    worker_pid = int(pid_file.read_text())
    wait_until(lambda: not pid_exists_stdlib(worker_pid), timeout=3, what="timed-out native worker exit")
    proof = json.loads(log.with_suffix(".progress.json").read_text())
    assert proof["status"] == "timed-out"
    assert proof["operation"] == "bundle-sign"
    assert proof["elapsedSeconds"] >= 2
    # Windows venv python.exe is a launcher; its actual worker has another PID.
    assert not pid_exists_stdlib(proof["pid"])
    assert proof["outputBytes"] == 0


@pytest.mark.parametrize("logged", [True, False])
def test_timeout_removes_a_real_owned_grandchild_and_preserves_an_unrelated_sibling(tmp_path, logged):
    pid_file = tmp_path / "grandchild.pid"
    worker = (
        "import os,sys; from pathlib import Path; from tests.waiting import wait_until; "
        "file=Path(sys.argv[1]); file.write_text(str(os.getpid())); "
        "wait_until(file.with_suffix('.stop').exists, timeout=30, what='fixture release')"
    )
    launcher = "import subprocess,sys,threading; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]); threading.Event().wait(30)"
    sibling = subprocess.Popen([sys.executable, "-c", "import threading; threading.Event().wait(30)"])
    try:
        started = time.monotonic()
        with pytest.raises(subprocess.TimeoutExpired):
            candidate.run([sys.executable, "-c", launcher, worker, str(pid_file)], os.environ,
                          log=tmp_path / "timeout.log" if logged else None, timeout=4)
        assert time.monotonic() - started < 12
        assert not pid_exists_stdlib(int(pid_file.read_text())), "the actual owned worker survived its launcher"
        assert sibling.poll() is None, "an independent sibling must not be included in timeout cleanup"
    finally:
        kill_process_tree(sibling)
        sibling.wait(timeout=5)
        if pid_file.exists() and pid_exists_stdlib(int(pid_file.read_text())):
            pid_file.with_suffix(".stop").touch()
            wait_until(lambda: not pid_exists_stdlib(int(pid_file.read_text())), timeout=5, what="fixture worker exit")


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


def test_progress_includes_worker_activity_while_its_launcher_waits(tmp_path, monkeypatch):
    ready = tmp_path / "worker-ready"
    release = tmp_path / "private-worker-release"
    activity = []

    def console(message, **_options):
        if not str(message).startswith("[candidate-progress] ") or not ready.exists() or activity:
            return
        value = json.loads(message.removeprefix("[candidate-progress] "))
        assert value.get("treeProcessCount", 0) >= 2, "idle launcher must not hide its actual worker"
        assert value["treeRssBytes"] > value["rssBytes"]
        assert value["treeCpuSeconds"] >= value["cpuSeconds"]
        assert value["treeQueryStatus"] == "ok"
        assert "private-worker-release" not in message
        activity.append(value)
        release.touch()

    worker = (
        "import sys; from pathlib import Path; from tests.waiting import wait_until; "
        "memory=bytearray(8*1024*1024); Path(sys.argv[1]).touch(); "
        "wait_until(Path(sys.argv[2]).exists, timeout=8, what='tree activity observation')"
    )
    launcher = (
        "import subprocess,sys; "
        "subprocess.run([sys.executable,'-c',sys.argv[1],sys.argv[2],sys.argv[3]],check=True,timeout=10)"
    )
    monkeypatch.setattr(candidate, "print", console, raising=False)
    monkeypatch.setattr(candidate, "CHILD_HEARTBEAT_SECONDS", 0.2)
    candidate.run([sys.executable, "-c", launcher, worker, str(ready), str(release)], os.environ,
                  log=tmp_path / "nested-build.log", timeout=12)
    assert activity

"""Run the actual offline harness in an isolated subprocess for contract tests."""
import json
from pathlib import Path
import queue
import signal
import subprocess
import sys
import threading


def _run_offline_harness(tmp_path, options, *, signal_on_ready=False, scenario="large"):
    repo = Path(__file__).resolve().parents[2]
    process = subprocess.Popen(
        [sys.executable, str(repo / "evals/ultra_delegation/harness.py"), scenario,
         "--review-skill=none", *options, f"--output-root={tmp_path}", "--name=offline"],
        cwd=repo, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True,
    )
    lines = []
    stages = queue.Queue()

    def collect_output():
        for line in process.stdout:
            lines.append(line)
            try:
                stages.put(json.loads(line).get("stage"))
            except (ValueError, AttributeError):
                continue
        stages.put("process_exited")

    reader = threading.Thread(target=collect_output, daemon=True)
    reader.start()
    try:
        if signal_on_ready:
            while True:
                stage = stages.get(timeout=60)
                assert stage != "process_exited", "".join(lines)
                if stage == "session_ready":
                    process.send_signal(signal.SIGTERM)
                    break
        returncode = process.wait(timeout=60)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        reader.join(timeout=5)
        process.stdout.close()
    assert returncode in (0, 2), "".join(lines)
    report = json.loads((tmp_path / "offline/report.json").read_text())
    assert report["live"] is False
    assert returncode == (0 if report["stop_reason"] == "normal_final" else 2)
    return report


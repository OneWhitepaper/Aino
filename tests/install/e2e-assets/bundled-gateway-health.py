"""Observe the native updater's gateway without starting or restarting it."""
from __future__ import annotations

import json
from pathlib import Path
import sys
import time
import urllib.request


def wait_for_new_gateway(home: Path, commit: str, timeout: float = 90):
    from hermes_cli.gateway_runtime import discover_gateway_endpoint

    deadline = time.monotonic() + timeout
    previous = None
    while True:
        discovery = discover_gateway_endpoint(home, timeout=2)
        code = discovery.endpoint.code_sha if discovery.endpoint is not None else None
        observation = (discovery.state, code)
        if observation != previous:
            print(json.dumps({"state": discovery.state, "codeSha": code, "expected": commit}), file=sys.stderr)
            previous = observation
        if discovery.state == "ready" and code == commit or time.monotonic() >= deadline:
            break
        time.sleep(0.5)
    assert discovery.state == "ready" and discovery.endpoint is not None, discovery.state
    assert discovery.endpoint.code_sha == commit, "Gateway did not restart on NEW code"
    return discovery


def main() -> None:
    import psutil
    from gateway.status import get_process_start_time, get_running_pid_identity_strict, read_runtime_status

    home = Path(sys.argv[1]).resolve()
    commit = sys.argv[2]
    discovery = wait_for_new_gateway(home, commit)
    identity = get_running_pid_identity_strict(home / "gateway.pid")
    assert identity is not None
    pid, _ = identity
    state = read_runtime_status(home / "gateway_state.json")
    assert state["pid"] == pid and state["start_time"] == get_process_start_time(pid)
    assert Path(state["hermes_home"]).resolve() == home
    assert Path(psutil.Process(pid).exe()).resolve() == Path(sys.executable).resolve()
    with urllib.request.urlopen(discovery.endpoint.api_origin + "/api/health", timeout=10) as response:
        assert response.status == 200
        health = json.load(response)
    assert health.get("ok") is True and health.get("commit") == commit, "Health identity differs from NEW code"
    print(json.dumps({"pid": pid, "startTime": state["start_time"], "home": str(home),
                      "commit": discovery.endpoint.code_sha, "health": health}))


if __name__ == "__main__":
    main()

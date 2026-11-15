"""A healthy OLD gateway is not proof that an automatic upgrade has settled."""
from importlib.util import module_from_spec, spec_from_file_location
import io
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

import psutil
import pytest

from gateway import status
import hermes_cli.gateway_runtime as runtime


@pytest.fixture
def probe(monkeypatch):
    path = Path(__file__).resolve().parents[2] / "install/e2e-assets/bundled-gateway-health.py"
    spec = spec_from_file_location("bundled_gateway_health", path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    now = [0.0]
    monkeypatch.setattr(module.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(module.time, "sleep", lambda delay: now.__setitem__(0, now[0] + delay))
    return module


def test_upgrade_observation_waits_for_new_code_after_old_is_ready(tmp_path, monkeypatch, probe):
    old = SimpleNamespace(state="ready", endpoint=SimpleNamespace(code_sha="old"))
    new = SimpleNamespace(state="ready", endpoint=SimpleNamespace(code_sha="new"))
    observations = iter([old, SimpleNamespace(state="starting", endpoint=None), new])
    monkeypatch.setattr(runtime, "discover_gateway_endpoint", lambda *args, **kwargs: next(observations))

    assert probe.wait_for_new_gateway(tmp_path, "new", timeout=2) is new


def test_old_gateway_that_never_changes_does_not_pass_upgrade(tmp_path, monkeypatch, probe):
    old = SimpleNamespace(state="ready", endpoint=SimpleNamespace(code_sha="old"))
    monkeypatch.setattr(runtime, "discover_gateway_endpoint", lambda *args, **kwargs: old)

    with pytest.raises(AssertionError, match="Gateway did not restart on NEW code"):
        probe.wait_for_new_gateway(tmp_path, "new", timeout=2)


def test_new_gateway_must_match_the_authenticated_ui_connection(probe):
    endpoint = SimpleNamespace(api_origin="http://127.0.0.1:12345")
    probe.assert_selected_gateway(endpoint, "http://localhost:12345")
    with pytest.raises(AssertionError, match="authenticated UI connection"):
        probe.assert_selected_gateway(endpoint, "http://127.0.0.1:54321")
    with pytest.raises(AssertionError):
        probe.assert_selected_gateway(endpoint, "https://example.com:12345")


def test_health_probe_checks_the_real_owner_against_the_expected_installed_interpreter(tmp_path, monkeypatch, capsys, probe):
    pid = os.getpid()
    executable = Path(psutil.Process(pid).exe()).resolve()
    started = status.get_process_start_time(pid)
    assert started is not None
    home = tmp_path.resolve()
    endpoint = SimpleNamespace(api_origin="http://127.0.0.1:12345", code_sha="new", instance_id="current-owner")
    discovery = SimpleNamespace(state="ready", endpoint=endpoint)
    monkeypatch.setattr(runtime, "discover_gateway_endpoint", lambda *args, **kwargs: discovery)
    monkeypatch.setattr(status, "get_running_pid_identity_strict", lambda path: (pid, started))
    monkeypatch.setattr(status, "read_runtime_status", lambda path: {
        "pid": pid, "start_time": started, "hermes_home": str(home),
    })

    def health_response(url, *, timeout):
        assert url == endpoint.api_origin + "/api/health" and timeout == 10
        response = io.BytesIO(json.dumps({"ok": True, "commit": "new"}).encode())
        response.status = 200
        return response

    monkeypatch.setattr(probe.urllib.request, "urlopen", health_response)
    monkeypatch.setattr(sys, "argv", ["probe", str(home), "new", endpoint.api_origin, str(executable)])
    probe.main()
    receipt = json.loads(capsys.readouterr().out)
    assert receipt["pid"] == pid and receipt["startTime"] == started
    assert receipt["executable"] == str(executable) and receipt["instanceId"] == "current-owner"

    other = tmp_path / "another-installed-interpreter"
    other.write_bytes(b"A different existing file is not the running gateway executable")
    monkeypatch.setattr(sys, "argv", ["probe", str(home), "new", endpoint.api_origin, str(other)])
    with pytest.raises(AssertionError, match="Gateway interpreter differs from the verified installation"):
        probe.main()

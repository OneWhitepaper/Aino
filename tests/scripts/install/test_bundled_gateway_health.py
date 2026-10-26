"""A healthy OLD gateway is not proof that an automatic upgrade has settled."""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace

import pytest

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

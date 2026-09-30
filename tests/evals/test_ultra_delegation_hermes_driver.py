"""Native Hermes evaluation configuration must resolve without managed credentials."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


def test_native_profile_resolves_its_loopback_endpoint_without_managed_auth(tmp_path):
    """Wrong provider identity or transport would send this run to a different API."""
    from evals.ultra_delegation.hermes_driver import configure_profile, native_session_params

    import yaml

    source = {"model": {"default": "unused", "provider": "aino"},
              "agent": {"max_turns": 36}, "delegation": {"max_iterations": 16}}
    config = configure_profile(source, base_url="http://127.0.0.1:8123/v1",
                               model="native-fixture-model", api_key="local-fixture-no-secret")
    home = tmp_path / "home"
    profile = home / "profile"
    profile.mkdir(parents=True)
    (profile / "config.yaml").write_text(yaml.safe_dump(config))
    repo = Path(__file__).resolve().parents[2]
    params = native_session_params(tmp_path, model="native-fixture-model", reasoning_effort="high")
    script = '''
import json, socket
def deny(*args, **kwargs):
    raise AssertionError("Provider resolution must not access the network")
socket.create_connection = socket.getaddrinfo = socket.socket.connect = deny
from hermes_cli.runtime_provider import resolve_runtime_provider
result = resolve_runtime_provider(requested=%r, target_model=%r)
print("NATIVE_RUNTIME:" + json.dumps({key:result.get(key) for key in ("provider","api_mode","base_url","api_key")}))
''' % (params["provider"], params["model"])
    kept = {key: value for key, value in os.environ.items()
            if key in ("PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT")}
    completed = subprocess.run(
        [sys.executable, "-c", script], cwd=repo, text=True, capture_output=True, timeout=30,
        env={**kept, "HOME": str(home), "USERPROFILE": str(home),
             "HERMES_HOME": str(profile), "PYTHONPATH": str(repo)},
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    runtime = json.loads(next(line.removeprefix("NATIVE_RUNTIME:")
                              for line in completed.stdout.splitlines()
                              if line.startswith("NATIVE_RUNTIME:")))
    assert runtime == {"provider": "custom", "api_mode": "codex_responses",
                       "base_url": "http://127.0.0.1:8123/v1",
                       "api_key": "local-fixture-no-secret"}
    assert source["model"]["provider"] == "aino"
    assert config["agent"]["max_turns"] == 36
    assert "max_concurrent_children" not in config["delegation"]
    assert params["source"] == "desktop"
    assert params["reasoning_effort"] == "high"
    assert not ({"model_source", "model_id"} & params.keys())


def test_native_offline_profile_rejects_remote_or_ambiguous_endpoints():
    """An accidental remote endpoint must fail before any native source imports."""
    from evals.ultra_delegation.hermes_driver import configure_profile

    for base_url in ("https://api.openai.com/v1", "http://127.0.0.1.example.com/v1",
                     "http://user:password@127.0.0.1/v1", "http://127.0.0.1/v1?route=remote"):
        with pytest.raises(ValueError, match="loopback"):
            configure_profile({}, base_url=base_url, model="fixture", api_key="local-fixture-no-secret")


@pytest.mark.parametrize("option", ["--live", "--matched-comparison", "--independent-completions",
                                   "--codex-native-comparison"])
def test_native_harness_rejects_unsupported_routes_before_creating_a_run(tmp_path, option):
    """Native comparison must never acquire a lease or create a misleading run."""
    repo = Path(__file__).resolve().parents[2]
    output = tmp_path / "runs"
    completed = subprocess.run(
        [sys.executable, str(repo / "evals/ultra_delegation/harness.py"),
         "large", "--driver=hermes", "--review-skill=none", option,
         f"--output-root={output}"], stdin=subprocess.DEVNULL,
        text=True, capture_output=True, cwd=repo, timeout=30,
    )
    assert completed.returncode == 2
    assert "Hermes native evaluation supports offline" in completed.stderr
    assert not output.exists()


def test_native_harness_rejects_a_non_upstream_checkout_before_creating_a_run(tmp_path):
    """Selecting the native label must not relabel Aino production as upstream."""
    repo = Path(__file__).resolve().parents[2]
    output = tmp_path / "runs"
    completed = subprocess.run(
        [sys.executable, str(repo / "evals/ultra_delegation/harness.py"),
         "large", "--driver=hermes", "--review-skill=none", f"--repo={repo}",
         f"--output-root={output}"], stdin=subprocess.DEVNULL,
        text=True, capture_output=True, cwd=repo, timeout=30,
    )
    assert completed.returncode == 2
    assert "fixed upstream Hermes source" in completed.stderr
    assert not output.exists()

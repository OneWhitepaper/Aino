"""The real canary preflight refuses incomplete publication environments."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile

import hermes_yaml
import pytest

ROOT = Path(__file__).resolve().parents[2]
CONFIGURATION = {
    "CLOUDFLARE_R2_PUBLIC_URL": "https://downloads.example.test",
    "CLOUDFLARE_R2_ACCOUNT_ID": "fixture-account",
    "CLOUDFLARE_R2_ACCESS_KEY_ID": "fixture-private-access",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY": "fixture-private-secret",
    "CLOUDFLARE_R2_BUCKET": "fixture-bucket",
}


def run_preflight(configuration, *, event="workflow_dispatch"):
    workflow = hermes_yaml.safe_load((ROOT / ".github/workflows/canary-release.yml").read_text())
    steps = workflow["jobs"]["tag"]["steps"]
    step = next(step for step in steps if step.get("name") == "Validate publication configuration")
    environment = {key: value for key, value in os.environ.items()
                   if key not in CONFIGURATION and key != "R2_DISPOSABLE_RUN"}
    environment.update(configuration)
    environment["GITHUB_EVENT_NAME"] = event
    environment["PATH"] = str(Path(sys.executable).parent) + os.pathsep + environment.get("PATH", "")
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "output"
        environment["GITHUB_OUTPUT"] = str(output)
        result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", step["run"]],
                                cwd=ROOT, env=environment, text=True, capture_output=True, timeout=15, check=False)
        return result, output.read_text() if output.exists() else ""


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("missing", CONFIGURATION)
def test_canary_refuses_missing_publication_configuration_without_printing_credentials(missing):
    result, output = run_preflight({key: value for key, value in CONFIGURATION.items() if key != missing})
    assert result.returncode != 0
    assert "configured=true" not in output
    assert missing in result.stderr
    assert CONFIGURATION["CLOUDFLARE_R2_ACCESS_KEY_ID"] not in result.stdout + result.stderr
    assert CONFIGURATION["CLOUDFLARE_R2_SECRET_ACCESS_KEY"] not in result.stdout + result.stderr


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("origin,accepted", [
    ("https://downloads.example.test", True),
    ("https://downloads.example.test?redirect=upstream", False),
])
def test_canary_preflight_accepts_only_a_complete_trusted_archive_configuration(origin, accepted):
    result, output = run_preflight({**CONFIGURATION, "CLOUDFLARE_R2_PUBLIC_URL": origin})
    assert (result.returncode == 0) is accepted, result.stderr
    assert ("configured=true" in output) is accepted
    assert CONFIGURATION["CLOUDFLARE_R2_SECRET_ACCESS_KEY"] not in result.stdout + result.stderr


@pytest.mark.platforms("posix")
def test_unprovisioned_scheduled_canary_is_explicitly_inactive():
    result, output = run_preflight({"CLOUDFLARE_R2_PUBLIC_URL": ""}, event="schedule")
    assert result.returncode == 0, result.stderr
    assert output == "configured=false\n"
    assert "no tag, release, or prune was attempted" in result.stdout

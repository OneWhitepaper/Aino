"""Fork CI admits the reviewed pre-PM upgrade baseline without publishing a tag."""

import os
import subprocess
from pathlib import Path

import hermes_yaml as yaml
import pytest


ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = "https://github.com/NousResearch/hermes-agent.git"


def _git(repo, *args):
    return subprocess.check_output(
        ["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", *args],
        cwd=repo, text=True,
    ).strip()


def _baseline_step():
    workflow = yaml.safe_load((ROOT / ".github/workflows/tests.yml").read_text())
    return next(step for step in workflow["jobs"]["e2e-upgrade"]["steps"]
                if step.get("name") == "Admit the reviewed pre-PM upgrade baseline")


@pytest.mark.parametrize("fault", ["none", "wrong-object", "wrong-commit", "conflicting-tag"])
def test_upgrade_baseline_admission_verifies_both_identities_before_local_publication(tmp_path, fault):
    upstream = tmp_path / "upstream"
    upstream.mkdir()
    _git(upstream, "init", "-q", "-b", "main")
    _git(upstream, "commit", "-q", "--allow-empty", "-m", "reviewed handoff release")
    commit = _git(upstream, "rev-parse", "HEAD")
    _git(upstream, "tag", "-a", "-m", "reviewed", "v1.0.0")
    tag_object = _git(upstream, "rev-parse", "refs/tags/v1.0.0")
    _git(upstream, "commit", "-q", "--allow-empty", "-m", "current application")
    checkout = tmp_path / "checkout"
    subprocess.run(["git", "clone", "-q", "--no-tags", str(upstream), str(checkout)], check=True)
    original = None
    if fault == "conflicting-tag":
        _git(checkout, "tag", "v1.0.0")
        original = _git(checkout, "rev-parse", "refs/tags/v1.0.0")
    config = tmp_path / "gitconfig"
    config.write_text(f'[url "{upstream.as_uri()}"]\n\tinsteadOf = {UPSTREAM}\n')
    step = _baseline_step()
    script = tmp_path / "admit.sh"
    script.write_text(step["run"])
    env = {**os.environ, **step.get("env", {}), "GIT_CONFIG_NOSYSTEM": "1",
           "GIT_CONFIG_GLOBAL": str(config), "GIT_ALLOW_PROTOCOL": "file",
           "HANDOFF_TAG": "v1.0.0", "HANDOFF_TAG_OBJECT": "0" * 40 if fault == "wrong-object" else tag_object,
           "HANDOFF_COMMIT": "0" * 40 if fault == "wrong-commit" else commit}
    result = subprocess.run(["bash", str(script)], cwd=checkout, env=env, text=True,
                            capture_output=True, check=False, timeout=30)
    current = subprocess.run(["git", "rev-parse", "--verify", "--quiet", "refs/tags/v1.0.0"],
                             cwd=checkout, text=True, capture_output=True, check=False).stdout.strip()
    if fault == "none":
        assert result.returncode == 0, result.stderr
        assert current == tag_object
        assert _git(checkout, "rev-parse", "v1.0.0^{commit}") == commit
    else:
        assert result.returncode != 0
        assert current == (original or "")
    assert _git(upstream, "rev-parse", "refs/tags/v1.0.0") == tag_object

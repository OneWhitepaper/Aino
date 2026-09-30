"""Independent-fixture oracle accepts stream isolation and detects its regression."""

from pathlib import Path
import json
import shutil
import subprocess
import sys

from evals.ultra_delegation.independent_contract import evaluate, load_candidate


FIXTURE = Path(__file__).resolve().parents[2] / "evals/ultra_delegation/fixtures/independent"
CONTRACT = FIXTURE.parents[1] / "independent_contract.py"


def test_frozen_candidate_fails_the_external_behavior_contract(tmp_path):
    """A genuinely wrong response boundary must fail the executable oracle."""
    shutil.copyfile(FIXTURE / "think_scrubber.py", tmp_path / "think_scrubber.py")
    completed = subprocess.run(
        [sys.executable, str(CONTRACT), str(tmp_path)],
        cwd=tmp_path, text=True, capture_output=True, timeout=15,
    )
    result = json.loads(completed.stdout)
    assert completed.returncode == 1
    assert result["tests_run"] > 0
    assert result["failures"] > 0
    assert result["errors"] == 0
    assert result["successful"] is False


def test_independent_stream_lifecycle_satisfies_the_same_contract():
    """A correct public-interface composition passes without a prescribed patch.

    This implementation is test-only and never copied to the model workspace.
    It creates a new stream worker after flush instead of editing the historical
    implementation's private fields, independently exercising the oracle's
    acceptance of a different valid repair. Within-stream behavior is unchanged.
    """
    historical = load_candidate(FIXTURE)

    class FreshStreamLifecycle:
        def __init__(self):
            self.stream = historical()

        def feed(self, delta):
            return self.stream.feed(delta)

        def flush(self):
            tail = self.stream.flush()
            self.stream = historical()
            return tail

        def reset(self):
            self.stream = historical()

    result = evaluate(FreshStreamLifecycle)
    assert result["successful"], result["output"]

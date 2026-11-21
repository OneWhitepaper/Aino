"""Portable contracts for Windows install prerequisites and child diagnostics.

Only native entry points are doubled; the journey and child environment are real.
"""

from contextlib import nullcontext
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

import tests.e2e.core.windows_update.test_fresh_install_update as fresh
from tests.e2e.core.windows_update._machine import Machine, Run, Turn


class _Machine:
    """Installation outcomes without launching PowerShell or a gateway."""

    def __init__(self, root: Path, install_result) -> None:
        self.install_result = install_result
        self.events = []
        self.head, self.next = "a" * 40, "b" * 40
        self.checkout = self.head
        self.logs = root / "transcripts"
        self.install_dir = root / "checkout"
        self.hermes_home = root / "home"
        self.logs.mkdir()
        self.install_dir.mkdir()
        (self.install_dir / ".hermes-bootstrap-complete").write_text(
            json.dumps({"pinnedCommit": self.head}), encoding="utf-8")

    def install(self):
        self.events.append("install")
        if isinstance(self.install_result, Exception):
            raise self.install_result
        return self.install_result

    def installed_head(self):
        self.events.append("installed-head")
        return self.checkout

    def hermes(self, *args):
        assert args == ("--version",)
        self.events.append("version")
        return Run(0, "Hermes Agent v0.1.6", "")

    def advance(self):
        self.events.append("advance")

    def update(self):
        self.events.append("update")
        self.checkout = self.next
        (self.install_dir / fresh.NEXT_MARKER).write_text("next", encoding="utf-8")
        receipts = self.hermes_home / "logs" / "update_receipts"
        receipts.mkdir(parents=True)
        (receipts / "latest.json").write_text('{"outcome": "success"}', encoding="utf-8")
        return Run(0, "update complete", "")

    def evidence(self):
        return "isolated installer evidence"

    def teardown(self):
        self.events.append("teardown")


def _journey(monkeypatch, tmp_path_factory, machine):
    server = SimpleNamespace(base_url="http://127.0.0.1:1/v1")
    monkeypatch.setattr(fresh, "FakeLLMServer", lambda: nullcontext(server))
    monkeypatch.setattr(fresh, "new_machine", lambda *_args, **_kwargs: machine)

    def turn(owner, provider, label):
        assert owner is machine and provider is server
        machine.events.append(label)
        return Turn(Run(0, "REPLY-fixture", ""), "REPLY-fixture", True)

    monkeypatch.setattr(fresh, "one_shot_turn", turn)
    return fresh.journey.__wrapped__(tmp_path_factory)


@pytest.mark.parametrize("install_result", [
    Run(23, "NODE-DEPS-FAILURE-PROOF", ""),
    AssertionError("install did not finish within 1500s: NODE-DEPS-TIMEOUT-PROOF"),
])
def test_failed_install_stays_red_without_starting_dependent_commands(
        tmp_path, tmp_path_factory, monkeypatch, install_result):
    machine = _Machine(tmp_path, install_result)
    fixture = _journey(monkeypatch, tmp_path_factory, machine)
    try:
        with pytest.raises(RuntimeError, match="install") as failure:
            next(fixture)
    finally:
        fixture.close()

    assert machine.events == ["install", "teardown"]
    if isinstance(install_result, Exception):
        assert failure.value.__cause__ is install_result
        assert "NODE-DEPS-TIMEOUT-PROOF" in str(failure.value)
    else:
        assert "install.ps1 exited 23" in str(failure.value)
        assert "NODE-DEPS-FAILURE-PROOF" in str(failure.value)


def test_completed_install_runs_all_fresh_acceptance_cells(tmp_path, tmp_path_factory, monkeypatch):
    machine = _Machine(tmp_path, Run(0, "installed", ""))
    fixture = _journey(monkeypatch, tmp_path_factory, machine)
    try:
        journey = next(fixture)
        assert machine.events == [
            "install", "installed-head", "version", "first-turn", "advance", "update", "turn-after-update"]
        fresh.test_install_lands_on_head_and_publishes_hermes(journey)
        fresh.test_first_agent_launch_runs_the_turn(journey)
        fresh.test_update_moves_checkout_to_next(journey)
        fresh.test_turn_after_update(journey)
    finally:
        fixture.close()
    assert machine.events[-1] == "teardown"


@pytest.mark.parametrize("as_user", [False, True])
def test_machine_child_streams_build_diagnostics_without_inheriting_secrets(tmp_path, monkeypatch, as_user):
    monkeypatch.setenv("HERMES_VERBOSE", "0")
    monkeypatch.setenv("WINDOWS_JOURNEY_UNIT_SECRET_TOKEN", "synthetic-secret")
    machine = Machine(root=tmp_path / "machine", profile_name="unit-profile", base_url="http://127.0.0.1:1/v1")
    env = machine.env(as_user=as_user)
    assert "WINDOWS_JOURNEY_UNIT_SECRET_TOKEN" not in env
    child = subprocess.run(
        [sys.executable, "-c",
         "from pm.progress import run_contained; import sys; "
         "run_contained([sys.executable, '-c', \"print('NODE-DEPS-LIVE-PROOF')\"], 'Node dependencies')"],
        cwd=Path(__file__).resolve().parents[2], env=env,
        capture_output=True, text=True, timeout=30, check=False)
    assert child.returncode == 0, child.stdout + child.stderr
    assert "NODE-DEPS-LIVE-PROOF" in child.stdout

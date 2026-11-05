"""Independent Desktop account homes keep the existing runtime readers isolated.

These contracts exercise real state/config/skill/memory/cron readers after cold
process launches. Electron's separate tests own choosing and retiring the home.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


@pytest.fixture
def account_homes(tmp_path):
    user = tmp_path / "os-user"
    user.mkdir()
    data = tmp_path / "app-user-data" / "account-workspaces"
    return user, {name: data / name / "home" for name in ("notebookalpha", "notebookbeta")}


def _probe(user, home, action, marker, foreign):
    root = Path(__file__).resolve().parents[2]
    env = {k: os.environ[k] for k in ("PATH", "LANG", "TZ", "SYSTEMROOT", "COMSPEC") if k in os.environ}
    env.update(HOME=str(user), USERPROFILE=str(user), LOCALAPPDATA=str(user / "AppData" / "Local"),
               HERMES_HOME=str(home), PYTHONPATH=str(root), HERMES_TEST_ISOLATION="1")
    result = subprocess.run(
        [sys.executable, str(root / "tests/gateway/fixtures/account_workspace_probe.py"), action, marker, foreign],
        cwd=user, env=env, capture_output=True, text=True, timeout=90, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(result.stdout.splitlines()[-1])


def test_account_runtime_readers_survive_switch_and_cold_restart_without_root_fallback(account_homes):
    from hermes_constants import _platform_default_hermes_home

    user, homes = account_homes
    legacy = _platform_default_hermes_home({"LOCALAPPDATA": str(user / "AppData" / "Local")}, lambda: user)
    profile = legacy / "profiles" / "legacy"
    profile.mkdir(parents=True)
    (profile / "config.yaml").write_text('{"model":{"default":"legacy"}}', encoding="utf-8")
    for own, home in homes.items():
        _probe(user, home, "seed", own, "unused")
    for own, foreign in (("notebookalpha", "notebookbeta"), ("notebookbeta", "notebookalpha"),
                         ("notebookalpha", "notebookbeta")):
        home = homes[own]
        snapshot = _probe(user, home, "inspect", own, foreign)
        assert Path(snapshot["home"]) == home and Path(snapshot["root"]) == home
        assert snapshot["profiles"] == {"default": str(home), own: str(home / "profiles" / own)}
        assert snapshot["model"] == own
        assert snapshot["memory"] == [f"Preferred notebook is {own}."]
        assert own in snapshot["skills"] and foreign not in snapshot["skills"] and "legacy" not in snapshot["skills"]
        assert snapshot["jobs"] == [own] and snapshot["sessions"] == [own]
        assert snapshot["own_search"] and set(snapshot["own_search"]) == {own}
        assert snapshot["foreign_search"] == [] and snapshot["foreign_session"] is None
        assert snapshot["foreign_messages"] == []


def test_native_reads_and_event_replay_cannot_reopen_another_account_session_id(account_homes):
    user, homes = account_homes
    for own in ("notebookalpha", "notebookbeta"):
        _probe(user, homes[own], "seed", own, "unused")
    for own, foreign in (("notebookbeta", "notebookalpha"), ("notebookalpha", "notebookbeta")):
        result = _probe(user, homes[own], "gateway", own, foreign)
        assert result["refusals"] == {"resume": "not_found", "events_since": "not_found", "info": "not_found"}
        assert result["messages"] == [f"Notebook {own}", f"Saved {own}"]

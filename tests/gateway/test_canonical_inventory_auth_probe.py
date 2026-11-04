"""Canonical GUI snapshots probe auxiliary tools without waiting for interactive auth."""
from types import SimpleNamespace

import pytest

from tests.hermes_cli.anon_portal import claimed_trial, install_portal


@pytest.mark.asyncio
@pytest.mark.parametrize("challenged", [False, True], ids=["no-nous-auth", "pending-nous-challenge"])
async def test_gui_create_inventory_does_not_wait_for_auxiliary_auth(tmp_path, monkeypatch, challenged):
    from gateway import run
    from gateway.config import GatewayConfig
    from gateway.session import SessionStore
    from gateway.session_authority import initialize_session_authority
    from gateway.session_controls import AuthorityConnection
    from hermes_cli import anon_challenge
    from hermes_cli.auth_nous import resolve_nous_runtime_credentials

    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(run, "_hermes_home", home)
    portal = install_portal(monkeypatch, tmp_path)
    presented = []
    monkeypatch.setattr(anon_challenge, "present", presented.append)
    if challenged:
        claimed_trial(monkeypatch)
        portal.challenge_required = True
        portal.challenge_never_clears = True
    (home / "config.yaml").write_text(
        'model: {default: fixture-model, provider: custom, base_url: "http://127.0.0.1:9/v1"}\n'
        'auxiliary: {vision: {provider: nous}}\n')

    def reject_interactive_wait(_challenge):
        pytest.fail("a session inventory must not wait for an auxiliary authentication challenge")

    foreground_wait = anon_challenge.wait_for_challenge
    monkeypatch.setattr(anon_challenge, "wait_for_challenge", reject_interactive_wait)
    store = SessionStore(tmp_path / "sessions", GatewayConfig())
    runner = SimpleNamespace(session_store=store, _session_db=store._db, adapters={}, _draining=False,
                             _cached_agent_for=lambda route: None)
    runner._adapter_for_source = lambda source: runner.adapters.get(source.platform)
    authority = await initialize_session_authority(runner, profile_id=str(home), instance_id="probe")
    connection = AuthorityConnection(authority, SimpleNamespace(desktop_local=True),
                                    {"user_id": "human", "native_bootstrap": True})
    reply = await connection.dispatch({"id": 1, "method": "session.create", "params": {
        "request_id": "inventory-auth", "source": "gui", "model_source": "aino",
        "model_id": "fixture-tool-model", "toolsets": ["file", "vision", "video"]}})
    assert "result" in reply, reply
    assert "read_file" in reply["result"]["info"]["tools"].get("file", [])
    assert "/api/anonymous/challenge/status" not in [path for _, path in portal.calls]

    if challenged:
        assert anon_challenge.pending_challenge()["url"] == portal.challenge_url
        # The inventory's probe scope must end: a later foreground inference still clears the check.
        monkeypatch.setattr(anon_challenge, "wait_for_challenge", foreground_wait)
        portal.challenge_never_clears = False
        portal.challenge_statuses = ["pending"]
        assert resolve_nous_runtime_credentials()["api_key"]
        assert "/api/anonymous/challenge/status" in [path for _, path in portal.calls]
        assert anon_challenge.pending_challenge() is None

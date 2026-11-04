"""Legacy readiness polls announce a free-tier challenge without waiting on its browser."""
import pytest

from tests.hermes_cli.anon_portal import claimed_trial, install_portal


def test_runtime_readiness_worker_does_not_wait_for_a_pending_challenge(tmp_path, monkeypatch):
    from hermes_cli import anon_challenge
    from tui_gateway import server

    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(server, "_hermes_home", home)
    portal = install_portal(monkeypatch, tmp_path)
    claimed_trial(monkeypatch)
    portal.challenge_required = True
    portal.challenge_never_clears = True
    (home / "config.yaml").write_text('model: {default: nous/welcome, provider: nous}\n')
    monkeypatch.setattr(anon_challenge, "present", lambda _challenge: None)

    def reject_interactive_wait(_challenge):
        pytest.fail("the readiness worker must not wait for an authentication challenge")

    monkeypatch.setattr(anon_challenge, "wait_for_challenge", reject_interactive_wait)
    reply = server.handle_request({"id": "readiness", "method": "setup.runtime_check",
                                   "params": {"provider": "nous"}})
    assert reply["result"]["ok"] is False
    assert "/api/anonymous/challenge/status" not in [path for _, path in portal.calls]
    assert anon_challenge.pending_challenge()["url"] == portal.challenge_url

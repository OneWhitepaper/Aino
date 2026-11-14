"""QR credentials stay server-side and a setup grant belongs to exactly one profile."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hermes_constants import get_hermes_home
from hermes_cli.web_routers import messaging_onboarding as api


@pytest.fixture
def setup(tmp_path, monkeypatch):
    from hermes_cli import profiles

    root = get_hermes_home()
    worker = root / "profiles" / "worker"
    worker.mkdir(parents=True)
    (worker / "config.yaml").write_text("{}\n")
    monkeypatch.setattr(profiles, "_get_default_hermes_home", lambda: root)
    monkeypatch.setattr(profiles, "_get_profiles_root", lambda: root / "profiles")
    monkeypatch.setattr(api, "_pairings", {})
    entry = SimpleNamespace(
        onboarding_start=AsyncMock(return_value={"state": {"token": "private-token"}, "qr_payload": "https://qr.example/scan", "expires_in": 300}),
        onboarding_poll=AsyncMock(return_value={"status": "ready", "state": {"token": "private-token"}}),
        onboarding_apply=lambda home, state: {"account_id": "owner", "token": "never-visible"},
    )
    monkeypatch.setattr(api, "_entry", lambda platform: entry)
    app = FastAPI()
    app.include_router(api.router)
    with TestClient(app) as client:
        yield client, entry, root, worker


def _path(pairing_id="", profile="worker"):
    return f"/api/messaging/platforms/test-chat/onboarding/{pairing_id}?profile={profile}"


def _start(client, profile="worker"):
    response = client.post(_path("start", profile))
    assert response.status_code == 200
    assert "token" not in response.text
    return response.json()["pairing_id"]


def test_confirmed_grant_is_scoped_and_apply_is_idempotent(setup):
    client, entry, root, worker = setup
    applied = []

    def save(home, state):
        assert get_hermes_home() == worker
        applied.append((home, state))
        return {"account_id": "owner", "token": "never-visible"}

    entry.onboarding_apply = save
    pairing_id = _start(client)
    assert client.get(_path(pairing_id, "default")).status_code == 404
    assert client.post(_path(f"{pairing_id}/apply", "default")).status_code == 404
    assert client.delete(_path(pairing_id, "default")).status_code == 404
    polled = client.get(_path(pairing_id))
    assert polled.json()["status"] == "ready"
    assert "token" not in polled.text
    assert not applied
    first = client.post(_path(f"{pairing_id}/apply"))
    second = client.post(_path(f"{pairing_id}/apply"))
    assert first.status_code == second.status_code == 200
    assert first.json() == second.json() == {"ok": True, "platform": "test-chat", "needs_activation": True, "account_id": "owner"}
    assert len(applied) == 1
    assert applied[0][0] == str(worker.resolve())
    assert not (root / "weixin").exists()


def test_expired_cancelled_and_replaced_grants_cannot_apply(setup):
    client, _entry, _root, _worker = setup
    old = _start(client)
    fresh = _start(client)
    assert client.post(_path(f"{old}/apply")).status_code == 404
    api._pairings[fresh].expires = 0
    assert client.get(_path(fresh)).json()["status"] == "expired"
    assert client.post(_path(f"{fresh}/apply")).status_code == 409
    fresh = _start(client)
    assert client.delete(_path(fresh)).status_code == 200
    assert client.post(_path(f"{fresh}/apply")).status_code == 404


def test_poll_failure_does_not_leak_provider_credentials(setup):
    client, entry, _root, _worker = setup
    entry.onboarding_poll.side_effect = RuntimeError("secret-bot-token")
    pairing_id = _start(client)
    response = client.get(_path(pairing_id))
    assert response.json()["status"] == "error"
    assert "secret-bot-token" not in response.text
    assert client.post(_path(f"{pairing_id}/apply")).status_code == 409


def test_saved_grant_can_retry_storage_failure(setup):
    client, entry, _root, _worker = setup
    pairing_id = _start(client)
    client.get(_path(pairing_id))
    entry.onboarding_apply = lambda home, state: (_ for _ in ()).throw(OSError("disk full"))
    assert client.post(_path(f"{pairing_id}/apply")).status_code == 500
    entry.onboarding_apply = lambda home, state: {"account_id": "owner"}
    assert client.post(_path(f"{pairing_id}/apply")).status_code == 200


def test_new_setup_cannot_replace_a_grant_while_its_credentials_are_being_saved(setup):
    from concurrent.futures import ThreadPoolExecutor
    import threading

    client, entry, _root, _worker = setup
    started, release = threading.Event(), threading.Event()
    writes = []

    def save(home, state):
        started.set()
        assert release.wait(5)
        writes.append(state["token"])
        return {"account_id": "owner"}

    pairing_id = _start(client)
    client.get(_path(pairing_id))
    entry.onboarding_apply = save
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, _path(f"{pairing_id}/apply"))
        try:
            assert started.wait(5)
            assert client.post(_path("start")).status_code == 409
        finally:
            release.set()
        assert pending.result(timeout=5).status_code == 200
    assert writes == ["private-token"]
    assert client.post(_path(f"{pairing_id}/apply")).status_code == 200


@pytest.mark.asyncio
async def test_telegram_live_apply_keeps_the_shared_owner_running(setup, monkeypatch):
    from unittest.mock import Mock
    from hermes_cli.web_routers import messaging
    from hermes_cli.web_models import TelegramOnboardingApply
    from hermes_cli.config import load_env
    from hermes_cli.web_server_profiles import _config_profile_scope

    _client, _entry, _root, _worker = setup
    record = SimpleNamespace(bot_token="12345:private-token", bot_username="test_bot")
    monkeypatch.setattr(messaging, "_telegram_record_or_404", lambda pairing_id: record)
    restart = Mock()
    monkeypatch.setattr(messaging, "_restart_gateway_after", restart)
    result = await messaging.apply_telegram_onboarding("temporary-grant", TelegramOnboardingApply(
        allowed_user_ids=["12345"], profile="worker", apply_live=True))
    assert result["ok"] and result["needs_activation"] and not result["needs_restart"]
    restart.assert_not_called()
    with _config_profile_scope("worker"):
        assert load_env()["TELEGRAM_BOT_TOKEN"] == "12345:private-token"


@pytest.mark.asyncio
async def test_newer_start_wins_even_when_older_qr_request_finishes_last(setup):
    import asyncio
    from fastapi import HTTPException

    _client, entry, _root, _worker = setup
    entered, release = asyncio.Event(), asyncio.Event()
    calls = 0

    async def load(home):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            await release.wait()
            return {"qr_payload": "old-qr", "state": {}}
        return {"qr_payload": "new-qr", "state": {}}

    entry.onboarding_start = load
    old = asyncio.create_task(api.start_onboarding("test-chat", "worker"))
    await entered.wait()
    newest = await api.start_onboarding("test-chat", "worker")
    release.set()
    with pytest.raises(HTTPException) as exc:
        await old
    assert exc.value.status_code == 409
    polled = await api.poll_onboarding("test-chat", newest["pairing_id"], "worker")
    assert polled["qr_payload"] == "new-qr"


def test_new_setup_is_blocked_during_apply_entry_resolution(setup, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    import threading

    client, entry, _root, _worker = setup
    pairing_id = _start(client)
    client.get(_path(pairing_id))
    entered, release = threading.Event(), threading.Event()
    calls = 0

    def resolve(platform):
        nonlocal calls
        calls += 1
        if calls == 1:
            entered.set()
            assert release.wait(5)
        return entry

    monkeypatch.setattr(api, "_entry", resolve)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, _path(f"{pairing_id}/apply"))
        try:
            assert entered.wait(5)
            assert client.post(_path("start")).status_code == 409
        finally:
            release.set()
        assert pending.result(timeout=5).status_code == 200


def test_live_update_defers_activation_to_the_scoped_connect_endpoint(setup, monkeypatch):
    from hermes_cli.web_routers import messaging

    _client, _entry, _root, _worker = setup
    monkeypatch.setattr(messaging, "_notify_multiplexer_hot_serve", lambda profile: pytest.fail("live client must not rescan unrelated adapters"))
    app = FastAPI()
    app.include_router(messaging.router)
    with TestClient(app) as client:
        response = client.put("/api/messaging/platforms/telegram?profile=worker", json={"enabled": True, "apply_live": True})
    assert response.status_code == 200
    assert response.json()["needs_activation"] and not response.json()["hot_served"]

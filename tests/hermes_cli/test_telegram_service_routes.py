"""Telegram setup keeps its default service and explicit custom routes."""

import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.mark.parametrize("custom_url", [None, "https://setup.example.test"])
def test_dashboard_telegram_setup_preserves_default_and_custom_service(monkeypatch, custom_url):
    from hermes_cli.telegram_managed_bot import DEFAULT_API_URL
    from hermes_cli.web_routers.messaging import router
    from hermes_cli import web_server_messaging

    if custom_url:
        monkeypatch.setenv("TELEGRAM_ONBOARDING_URL", custom_url)
    else:
        monkeypatch.delenv("TELEGRAM_ONBOARDING_URL", raising=False)
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(201, json={
            "pairing_id": "consent-test", "poll_token": "secret",
            "suggested_username": "aino_bot", "deep_link": "https://t.me/aino_bot",
            "expires_at": "2027-05-18T00:00:00.000Z"})

    client_type = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: client_type(transport=httpx.MockTransport(handle), **kwargs))
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post("/api/messaging/telegram/onboarding/start", json={})
    assert response.status_code == 200, response.text
    assert str(requests[0].url) == f"{custom_url or DEFAULT_API_URL}/v1/telegram/pairings"
    assert json.loads(requests[0].content) == {"bot_name": "Aino Agent"}
    with web_server_messaging._telegram_onboarding_lock:
        web_server_messaging._telegram_onboarding_pairings.pop("consent-test", None)

"""Desktop WeChat setup reuses the iLink transport and persists only after explicit apply."""
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest

from plugins.platforms.weixin import adapter as wx
from plugins.platforms.weixin import onboarding


@pytest.fixture
def transport(monkeypatch):
    @asynccontextmanager
    async def session():
        yield object()
    monkeypatch.setattr(wx, "_new_session", session)
    monkeypatch.setattr(wx, "check_weixin_requirements", lambda: True)
    monkeypatch.setattr(wx, "_fetch_qr", AsyncMock(return_value=("qr-code", "https://qr.example/scan")))
    request = AsyncMock()
    monkeypatch.setattr(wx, "_api_get", request)
    return request


@pytest.mark.asyncio
async def test_qr_scan_and_confirm_preserve_credentials_until_apply(transport, tmp_path):
    home = str(tmp_path)
    started = await onboarding.start(home)
    assert started["qr_payload"] == "https://qr.example/scan"
    transport.return_value = {"status": "scaned"}
    assert (await onboarding.poll(home, started["state"]))["status"] == "scanned"
    transport.return_value = {"status": "confirmed", "ilink_bot_id": "bot-id", "bot_token": "secret-token", "ilink_user_id": "owner-id"}
    confirmed = await onboarding.poll(home, started["state"])
    assert confirmed["status"] == "ready"
    assert not (tmp_path / "weixin").exists()
    from hermes_cli.web_server_profiles import _hermes_home_scope
    from hermes_cli.config import load_env, load_config
    with _hermes_home_scope(tmp_path):
        assert onboarding.apply(home, confirmed["state"]) == {"account_id": "bot-id"}
        env = load_env()
        assert env["WEIXIN_TOKEN"] == "secret-token"
        assert env["WEIXIN_ALLOWED_USERS"] == "owner-id"
        assert env["WEIXIN_DM_POLICY"] == "allowlist"
        assert env["WEIXIN_GROUP_POLICY"] == "disabled"
        assert load_config()["platforms"]["weixin"]["enabled"] is True
    assert wx.load_weixin_account(home, "bot-id")["token"] == "secret-token"


@pytest.mark.asyncio
async def test_incomplete_confirmation_and_untrusted_redirect_are_not_saved(transport, tmp_path):
    started = await onboarding.start(str(tmp_path))
    transport.return_value = {"status": "confirmed", "ilink_bot_id": "bot-id"}
    assert (await onboarding.poll(str(tmp_path), started["state"]))["status"] == "error"
    transport.return_value = {"status": "scaned_but_redirect", "redirect_host": "localhost:9999"}
    with pytest.raises(ValueError, match="Unexpected"):
        await onboarding.poll(str(tmp_path), started["state"])
    assert not (tmp_path / "weixin").exists()

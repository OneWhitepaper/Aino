"""Desktop QR setup using the same iLink requests and credential store as the CLI."""
from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlparse


def _login_host(raw: str) -> str:
    """iLink may move a scan to another Tencent iLink host, never an arbitrary URL."""
    host = urlparse(raw if "://" in raw else f"https://{raw}").hostname or ""
    if not host.endswith((".weixin.qq.com", ".wechat.com")):
        raise ValueError("Unexpected iLink login host")
    return f"https://{host}"


async def start(home: str) -> dict[str, Any]:
    from . import adapter as wx

    if not wx.check_weixin_requirements():
        raise RuntimeError("WeChat connection dependencies are unavailable")
    async with wx._new_session() as session:
        code, url = await wx._fetch_qr(session, "3")
    if not code or not url:
        raise RuntimeError("WeChat did not return a QR code")
    return {"state": {"code": code, "base_url": wx.ILINK_BASE_URL},
            "qr_payload": url, "expires_in": 300, "poll_interval": 2}


async def poll(home: str, state: dict) -> dict[str, Any]:
    from . import adapter as wx

    async with wx._new_session() as session:
        try:
            result = await wx._api_get(
                session, base_url=state.get("base_url", wx.ILINK_BASE_URL),
                endpoint=f"{wx.EP_GET_QR_STATUS}?qrcode={quote(state['code'], safe='')}", timeout_ms=5_000)
        except TimeoutError:
            return {"status": "waiting"}
    status = str(result.get("status") or "wait")
    if status == "scaned_but_redirect" and result.get("redirect_host"):
        return {"status": "scanned", "state": {**state, "base_url": _login_host(result["redirect_host"])}}
    if status == "confirmed":
        credentials = {"account_id": str(result.get("ilink_bot_id") or ""),
                       "token": str(result.get("bot_token") or ""),
                       "base_url": _login_host(str(result.get("baseurl") or wx.ILINK_BASE_URL)),
                       "user_id": str(result.get("ilink_user_id") or "")}
        if not credentials["account_id"] or not credentials["token"]:
            return {"status": "error", "message": "WeChat did not complete authorization. Scan again."}
        return {"status": "ready", "state": {"credentials": credentials}}
    return {"status": {"scaned": "scanned", "expired": "expired"}.get(status, "waiting")}


def apply(home: str, state: dict) -> dict[str, str]:
    from hermes_cli.config import load_env, save_env_value, write_platform_config_field
    from .adapter import save_weixin_account

    credentials = state["credentials"]
    saved = load_env()
    save_weixin_account(home, **credentials)
    for key, value in (("WEIXIN_ACCOUNT_ID", credentials["account_id"]),
                       ("WEIXIN_TOKEN", credentials["token"]),
                       ("WEIXIN_BASE_URL", credentials["base_url"])):
        save_env_value(key, value)
    owner = credentials.get("user_id", "")
    allowed = list(dict.fromkeys([*filter(None, (v.strip() for v in saved.get("WEIXIN_ALLOWED_USERS", "").split(","))), owner]))
    if owner:
        save_env_value("WEIXIN_ALLOWED_USERS", ",".join(filter(None, allowed)))
    for key, value in (("WEIXIN_DM_POLICY", "allowlist" if owner else "pairing"),
                       ("WEIXIN_ALLOW_ALL_USERS", "false"), ("WEIXIN_GROUP_POLICY", "disabled")):
        if not saved.get(key):
            save_env_value(key, value)
    write_platform_config_field("weixin", "enabled", True)
    return {"account_id": credentials["account_id"]}

"""Desktop QR onboarding reuses platform registration without exposing credentials."""

import pytest


@pytest.mark.asyncio
async def test_qq_scan_reuses_registration_and_saves_only_to_owner(tmp_path, monkeypatch):
    import hermes_yaml as yaml
    from hermes_cli.config import load_env
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    from plugins.platforms.qqbot import onboard, onboarding

    home = tmp_path / "owner"
    home.mkdir()
    (home / "config.yaml").write_text("model: {default: keep-model}\n", encoding="utf-8")
    monkeypatch.setattr(onboard, "_create_bind_task", lambda: ("bind-task", "private-key"))
    monkeypatch.setattr(onboard, "_poll_bind_result", lambda task: (onboard.BindStatus.COMPLETED, "app", "cipher", "owner-openid"))
    monkeypatch.setattr(onboard, "decrypt_secret", lambda cipher, key: "private-secret")

    started = await onboarding.start(str(home))
    assert "bind-task" in started["qr_payload"]
    assert "private-key" not in started["qr_payload"]
    ready = await onboarding.poll(str(home), started["state"])
    assert ready["status"] == "ready"
    receipt = onboarding.apply(str(home), ready["state"])
    assert receipt == {"account_id": "app"}
    token = set_hermes_home_override(home)
    try:
        saved = load_env()
    finally:
        reset_hermes_home_override(token)
    assert saved["QQ_CLIENT_SECRET"] == "private-secret"
    assert saved["QQ_ALLOWED_USERS"] == "owner-openid"
    assert saved["QQ_ALLOW_ALL_USERS"] == "false"
    config = yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
    assert config["model"]["default"] == "keep-model"
    assert config["platforms"]["qqbot"]["enabled"] is True


@pytest.mark.asyncio
async def test_qq_pending_expired_and_incomplete_credentials(monkeypatch, tmp_path):
    from plugins.platforms.qqbot import onboard, onboarding

    state = {"task_id": "task", "aes_key": "key"}
    monkeypatch.setattr(onboard, "_poll_bind_result", lambda task: (onboard.BindStatus.PENDING, "", "", ""))
    assert (await onboarding.poll(str(tmp_path), state))["status"] == "waiting"
    monkeypatch.setattr(onboard, "_poll_bind_result", lambda task: (onboard.BindStatus.EXPIRED, "", "", ""))
    assert (await onboarding.poll(str(tmp_path), state))["status"] == "expired"
    monkeypatch.setattr(onboard, "_poll_bind_result", lambda task: (onboard.BindStatus.COMPLETED, "", "", ""))
    with pytest.raises(ValueError, match="incomplete"):
        await onboarding.poll(str(tmp_path), state)
    assert not (tmp_path / ".env").exists()


@pytest.mark.asyncio
async def test_feishu_scan_keeps_lark_domain_and_owner(tmp_path, monkeypatch):
    from hermes_cli.config import load_env
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
    from plugins.platforms.feishu import adapter, onboarding

    monkeypatch.setattr(adapter, "_init_registration", lambda domain: None)
    monkeypatch.setattr(adapter, "_begin_registration", lambda domain: {
        "device_code": "private-device", "qr_url": "https://accounts.feishu.cn/scan", "interval": 5, "expire_in": 600,
    })
    monkeypatch.setattr(adapter, "_post_registration", lambda url, body: {
        "client_id": "app", "client_secret": "private-secret", "user_info": {"tenant_brand": "lark", "open_id": "owner"},
    })
    started = await onboarding.start(str(tmp_path))
    assert started["poll_interval"] == 5
    assert "private-device" not in started["qr_payload"]
    ready = await onboarding.poll(str(tmp_path), started["state"])
    assert ready["status"] == "ready"
    assert onboarding.apply(str(tmp_path), ready["state"]) == {"account_id": "app"}
    token = set_hermes_home_override(tmp_path)
    try:
        saved = load_env()
    finally:
        reset_hermes_home_override(token)
    assert saved["FEISHU_DOMAIN"] == "lark"
    assert saved["FEISHU_CONNECTION_MODE"] == "websocket"
    assert saved["FEISHU_ALLOWED_USERS"] == "owner"
    assert saved["FEISHU_APP_SECRET"] == "private-secret"


@pytest.mark.asyncio
async def test_feishu_denial_and_domain_redirect_do_not_write(tmp_path, monkeypatch):
    from plugins.platforms.feishu import adapter, onboarding

    state = {"device_code": "device", "domain": "feishu"}
    monkeypatch.setattr(adapter, "_post_registration", lambda url, body: {"user_info": {"tenant_brand": "lark"}})
    waiting = await onboarding.poll(str(tmp_path), state)
    assert waiting["status"] == "waiting"
    assert waiting["state"]["domain"] == "lark"
    monkeypatch.setattr(adapter, "_post_registration", lambda url, body: {"error": "access_denied"})
    assert (await onboarding.poll(str(tmp_path), waiting["state"]))["status"] == "error"
    monkeypatch.setattr(adapter, "_post_registration", lambda url, body: {"error": "expired_token"})
    assert (await onboarding.poll(str(tmp_path), state))["status"] == "expired"
    assert not (tmp_path / ".env").exists()


@pytest.mark.parametrize("platform", ["qqbot", "feishu"])
def test_onboarding_rejects_unready_apply_without_config_writes(tmp_path, platform):
    from importlib import import_module

    onboarding = import_module(f"plugins.platforms.{platform}.onboarding")
    with pytest.raises(ValueError, match="incomplete"):
        onboarding.apply(str(tmp_path), {})
    assert not (tmp_path / ".env").exists()


@pytest.mark.parametrize("platform", ["qqbot", "feishu"])
def test_qr_callbacks_are_registered_with_platform(platform):
    from importlib import import_module

    package = import_module(f"plugins.platforms.{platform}")
    onboarding = import_module(f"plugins.platforms.{platform}.onboarding")
    captured = {}

    class Context:
        def register_platform(self, **fields):
            captured.update(fields)

    package.register(Context())
    assert captured["onboarding_start"] is onboarding.start
    assert captured["onboarding_poll"] is onboarding.poll
    assert captured["onboarding_apply"] is onboarding.apply


@pytest.mark.parametrize("platform,prefix", [("qqbot", "QQ"), ("feishu", "FEISHU")])
def test_apply_preserves_authorization_and_does_not_borrow_launch_profile(tmp_path, monkeypatch, platform, prefix):
    from importlib import import_module

    from agent.secret_scope import build_profile_secret_scope, reset_secret_scope, set_secret_scope
    from hermes_cli.config import load_env
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override

    onboarding = import_module(f"plugins.platforms.{platform}.onboarding")
    owner = tmp_path / "owner"
    owner.mkdir()
    (owner / ".env").write_text(f"{prefix}_ALLOWED_USERS=existing\n{prefix}_ALLOW_ALL_USERS=false\n", encoding="utf-8")
    launch = tmp_path / "launch"
    launch.mkdir()
    (launch / ".env").write_text("PRIVATE_MARKER=untouched\n", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(launch))
    monkeypatch.setenv(f"{prefix}_ALLOWED_USERS", "other-account")
    monkeypatch.setenv(f"{prefix}_ALLOW_ALL_USERS", "true")
    scope = set_secret_scope(build_profile_secret_scope(owner), profile_home=str(owner))
    try:
        onboarding.apply(str(owner), {
            "app_id": "app", "client_secret": "secret", "app_secret": "secret", "owner": "scanning-owner", "domain": "feishu",
        })
    finally:
        reset_secret_scope(scope)
    home_token = set_hermes_home_override(owner)
    try:
        saved = load_env()
    finally:
        reset_hermes_home_override(home_token)
    assert saved[f"{prefix}_ALLOWED_USERS"] == "existing,scanning-owner"
    assert saved[f"{prefix}_ALLOW_ALL_USERS"] == "false"
    assert (launch / ".env").read_text(encoding="utf-8") == "PRIVATE_MARKER=untouched\n"
    assert not (launch / "config.yaml").exists()

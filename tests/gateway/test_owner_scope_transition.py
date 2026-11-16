"""An owner RPC already in flight survives the host's first-secondary activation."""
import asyncio
from contextlib import AsyncExitStack
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize("asynchronous", [False, True])
async def test_launch_owner_keeps_its_credentials_when_a_second_home_activates(tmp_path, monkeypatch, asynchronous):
    from agent.secret_scope import UnscopedSecretError, get_secret, is_multiplex_active
    from gateway.session_authorities import async_owner_scope, owner_scope
    from tui_gateway import server

    home = tmp_path / ".hermes"
    bot = home / "profiles" / "worker"
    bot.mkdir(parents=True)
    (home / ".env").write_text("XAI_API_KEY=launch-file-key\n", encoding="utf-8")
    (bot / ".env").write_text("BOT_ONLY_TOKEN=bot-key\n", encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("XAI_API_KEY", "launch-env-key")
    monkeypatch.setattr(server, "_hermes_home", str(home))
    authority = SimpleNamespace(profile_id=str(home),
                                runner=SimpleNamespace(config=SimpleNamespace(multiplex_profiles=False)))

    async with AsyncExitStack() as stack:
        if asynchronous:
            await stack.enter_async_context(async_owner_scope(authority))
        else:
            stack.enter_context(owner_scope(authority))
        assert get_secret("XAI_API_KEY") == "launch-env-key"
        # The real profile resolver freezes the launch env and activates fail-closed reads.
        assert await asyncio.to_thread(server._profile_home, "worker") == bot
        assert is_multiplex_active()
        assert get_secret("XAI_API_KEY") == "launch-file-key"
        assert get_secret("BOT_ONLY_TOKEN") is None

    with pytest.raises(UnscopedSecretError):
        get_secret("XAI_API_KEY")


@pytest.mark.parametrize("owner", ["secondary", "symbolic"])
def test_an_unbound_foreign_owner_never_borrows_the_launch_body(tmp_path, monkeypatch, owner):
    from agent.secret_scope import UnscopedSecretError, get_secret
    from gateway.session_authorities import owner_scope
    from tui_gateway.launch_profile_policy import activate_multi_profile_hosting

    home = tmp_path / ".hermes"
    bot = home / "profiles" / "worker"
    bot.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("XAI_API_KEY", "launch-only-key")
    authority = SimpleNamespace(profile_id=str(bot) if owner == "secondary" else "fixture",
                                runner=SimpleNamespace(config=SimpleNamespace(multiplex_profiles=False)))
    with owner_scope(authority):
        activate_multi_profile_hosting()
        with pytest.raises(UnscopedSecretError):
            get_secret("XAI_API_KEY")

"""A TUI/Desktop agent built on a credential-resolution fallback (primary AuthError -> fallback_providers
entry) must carry the same one-shot switch notice the messaging gateway surfaces (#74349), and the
private notice key must never reach the AIAgent constructor. Drives the real ``_make_agent``."""
from unittest.mock import patch

from hermes_cli.auth import AuthError
from tui_gateway import server


class _StubAgent:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


def _build(monkeypatch, tmp_path, *, primary_fails: bool):
    from tui_gateway import server

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("HERMES_IGNORE_RULES", "1")
    (tmp_path / "config.yaml").write_text("model:\n  default: gpt-5.6-sol\n  provider: openai-codex\n")
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    monkeypatch.setattr(server, "_get_db", lambda: None)
    monkeypatch.setattr(server, "_load_fallback_model",
                        lambda: [{"provider": "anthropic", "model": "claude-sonnet-5", "api_key": "fb"}])

    def _resolve(**kwargs):
        if primary_fails and kwargs.get("requested") != "anthropic":
            raise AuthError("expired")
        return {"api_key": "k", "base_url": "https://example.invalid/v1",
                "provider": kwargs.get("requested") or "openai-codex", "api_mode": "chat_completions"}

    with patch("hermes_cli.runtime_provider.resolve_runtime_provider", side_effect=_resolve), \
         patch("run_agent.AIAgent", _StubAgent):
        return server._make_agent("sid", "key", context_cwd_is_launch_artifact=False)


def test_fallback_build_attaches_the_switch_notice_outside_agent_kwargs(monkeypatch, tmp_path):
    agent = _build(monkeypatch, tmp_path, primary_fails=True)
    assert (agent.kwargs["provider"], agent.kwargs["model"]) == ("anthropic", "claude-sonnet-5")
    assert "_fallback_notice" not in agent.kwargs
    notice = agent._pending_fallback_notice
    assert "openai-codex/gpt-5.6-sol" in notice and "anthropic/claude-sonnet-5" in notice


def test_primary_build_carries_no_notice(monkeypatch, tmp_path):
    agent = _build(monkeypatch, tmp_path, primary_fails=False)
    assert agent.kwargs["provider"] == "openai-codex"
    assert not hasattr(agent, "_pending_fallback_notice")


def test_fallback_build_survives_model_string_shorthand(monkeypatch, tmp_path):
    """``model: <id>`` (the string shorthand every other reader accepts) must not crash the fallback
    build while it names the primary in the notice."""
    from tui_gateway import server

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("HERMES_IGNORE_RULES", "1")
    (tmp_path / "config.yaml").write_text("model: gpt-5.6-sol\n", encoding="utf-8")
    monkeypatch.setattr(server, "_hermes_home", tmp_path)
    monkeypatch.setattr(server, "_get_db", lambda: None)
    monkeypatch.setattr(server, "_load_fallback_model",
                        lambda: [{"provider": "anthropic", "model": "claude-sonnet-5", "api_key": "fb"}])

    def _resolve(**kwargs):
        if kwargs.get("requested") != "anthropic":
            raise AuthError("expired")
        return {"api_key": "k", "base_url": "https://example.invalid/v1",
                "provider": "anthropic", "api_mode": "chat_completions"}

    with patch("hermes_cli.runtime_provider.resolve_runtime_provider", side_effect=_resolve), \
         patch("run_agent.AIAgent", _StubAgent):
        agent = server._make_agent("sid", "key", context_cwd_is_launch_artifact=False)
    assert (agent.kwargs["provider"], agent.kwargs["model"]) == ("anthropic", "claude-sonnet-5")
    assert "gpt-5.6-sol" in agent._pending_fallback_notice and "anthropic/claude-sonnet-5" in agent._pending_fallback_notice


class TestResolveRuntimeWithFallback:
    """Tests for _resolve_runtime_with_fallback(): init-time provider
    fallback when the primary provider raises AuthError."""

    def test_primary_success_returns_runtime(self, monkeypatch):
        """When primary resolve succeeds, return its result directly."""
        expected = {"provider": "openai", "api_key": "tok"}
        monkeypatch.setattr(
            "hermes_cli.runtime_provider.resolve_runtime_provider",
            lambda **kw: expected,
        )
        resolution = server._resolve_runtime_with_fallback(
            {"requested": "openai"}
        )
        assert resolution.runtime == expected
        assert resolution.selected_model is None
        assert resolution.used_fallback is False

    def test_auth_error_tries_fallback_chain(self, monkeypatch):
        """On AuthError from primary, walk fallback_providers chain."""
        from hermes_cli.auth import AuthError

        fallback_runtime = {"provider": "deepseek", "api_key": "fb-tok"}

        def fake_resolve(**kwargs):
            if kwargs.get("requested") == "openai-codex":
                raise AuthError("No Codex credentials stored")
            return fallback_runtime

        monkeypatch.setattr(
            "hermes_cli.runtime_provider.resolve_runtime_provider",
            fake_resolve,
        )
        monkeypatch.setattr(
            server,
            "_load_fallback_model",
            lambda: [{"provider": "deepseek", "model": "deepseek-v4-pro"}],
        )
        resolution = server._resolve_runtime_with_fallback(
            {"requested": "openai-codex"},
        )
        assert resolution.runtime == fallback_runtime
        assert resolution.selected_model == "deepseek-v4-pro"
        assert resolution.used_fallback is True


    def test_auth_error_skips_provider_only_fallback(self, monkeypatch):
        """Auth fallback requires one complete provider/model pair."""
        from hermes_cli.auth import AuthError

        requested = []
        fallback_runtime = {"provider": "openrouter", "api_key": "fb-tok"}

        def fake_resolve(**kwargs):
            requested.append(kwargs.get("requested"))
            if kwargs.get("requested") == "openai-codex":
                raise AuthError("No Codex credentials stored")
            return fallback_runtime

        monkeypatch.setattr(
            "hermes_cli.runtime_provider.resolve_runtime_provider",
            fake_resolve,
        )
        monkeypatch.setattr(
            server,
            "_load_fallback_model",
            lambda: [
                {"provider": "anthropic"},
                {"provider": "openrouter", "model": "z-ai/glm-5.2"},
            ],
        )

        resolution = server._resolve_runtime_with_fallback(
            {"requested": "openai-codex"}
        )

        assert requested == ["openai-codex", "openrouter"]
        assert resolution.runtime == fallback_runtime
        assert resolution.selected_model == "z-ai/glm-5.2"
        assert resolution.used_fallback is True

    def test_fallback_entry_key_env_resolves_api_key(self, monkeypatch):
        """A fallback entry naming its key via key_env passes the resolved
        env value as explicit_api_key (#43861, @VrtxOmega)."""
        from hermes_cli.auth import AuthError

        monkeypatch.setenv("FB_TEST_KEY", "env-resolved-key")
        captured = {}
        fallback_runtime = {"provider": "openrouter", "api_key": "x"}

        def fake_resolve(**kwargs):
            if kwargs.get("requested") == "openai-codex":
                raise AuthError("No Codex credentials stored")
            captured.update(kwargs)
            return fallback_runtime

        monkeypatch.setattr(
            "hermes_cli.runtime_provider.resolve_runtime_provider",
            fake_resolve,
        )
        monkeypatch.setattr(
            server,
            "_load_fallback_model",
            lambda: [
                {
                    "provider": "openrouter",
                    "model": "z-ai/glm-5.2",
                    "key_env": "FB_TEST_KEY",
                }
            ],
        )
        resolution = server._resolve_runtime_with_fallback(
            {"requested": "openai-codex"}
        )
        assert resolution.used_fallback is True
        assert captured.get("explicit_api_key") == "env-resolved-key"

    def test_auth_error_all_fallbacks_fail_raises(self, monkeypatch):
        """When all fallbacks also fail, re-raise the original AuthError."""
        from hermes_cli.auth import AuthError

        def fake_resolve(**kwargs):
            raise AuthError("No credentials for " + str(kwargs.get("requested")))

        monkeypatch.setattr(
            "hermes_cli.runtime_provider.resolve_runtime_provider",
            fake_resolve,
        )
        monkeypatch.setattr(
            server,
            "_load_fallback_model",
            lambda: [{"provider": "deepseek", "model": "deepseek-v4-pro"}],
        )
        import pytest

        with pytest.raises(AuthError, match="No credentials for openai-codex"):
            server._resolve_runtime_with_fallback(
                {"requested": "openai-codex"},
            )

    def test_auth_error_skips_non_dict_entries(self, monkeypatch):
        """Fallback chain entries that are not dicts are skipped."""
        from hermes_cli.auth import AuthError

        fallback_runtime = {"provider": "anthropic", "api_key": "ant-tok"}

        def fake_resolve(**kwargs):
            if kwargs.get("requested") == "openai-codex":
                raise AuthError("No Codex credentials stored")
            return fallback_runtime

        monkeypatch.setattr(
            "hermes_cli.runtime_provider.resolve_runtime_provider",
            fake_resolve,
        )
        monkeypatch.setattr(
            server,
            "_load_fallback_model",
            lambda: [
                "invalid-string-entry",
                {"provider": "anthropic", "model": "claude-sonnet-4-6"},
            ],
        )
        resolution = server._resolve_runtime_with_fallback(
            {"requested": "openai-codex"},
        )
        assert resolution.runtime == fallback_runtime
        assert resolution.selected_model == "claude-sonnet-4-6"
        assert resolution.used_fallback is True

    def test_make_agent_uses_fallback_on_auth_error(self, monkeypatch):
        """Integration: _make_agent falls back to configured fallback
        provider when the primary provider raises AuthError."""
        import types

        from hermes_cli.auth import AuthError

        captured = {}
        fallback_runtime = {
            "provider": "deepseek",
            "api_key": "fb-tok",
            "base_url": "https://fallback.invalid/v1",
        }

        def fake_resolve(**kwargs):
            if kwargs.get("requested") in (None, "openai-codex"):
                raise AuthError("No Codex credentials stored")
            return fallback_runtime

        def fake_agent(**kwargs):
            captured.update(kwargs)
            return types.SimpleNamespace(model=kwargs.get("model"))

        monkeypatch.delenv("HERMES_MODEL", raising=False)
        monkeypatch.delenv("HERMES_INFERENCE_MODEL", raising=False)
        monkeypatch.delenv("HERMES_TUI_PROVIDER", raising=False)
        monkeypatch.setattr(
            server,
            "_load_cfg",
            lambda: {
                "model": {"default": "gpt-5.5", "provider": "openai-codex"},
                "fallback_providers": [
                    {"provider": "deepseek", "model": "deepseek-v4-pro"},
                ],
            },
        )
        monkeypatch.setattr(
            "hermes_cli.runtime_provider.resolve_runtime_provider",
            fake_resolve,
        )
        monkeypatch.setattr("run_agent.AIAgent", fake_agent)
        monkeypatch.setattr(server, "_load_enabled_toolsets", lambda *_a, **_kw: ["file"])
        monkeypatch.setattr(server, "_get_db", lambda: None)

        agent = server._make_agent(
            "sid",
            "session-key",
            model_override={
                "model": "gpt-5.5",
                "provider": "openai-codex",
                "base_url": "https://chatgpt.com/backend-api/codex",
                "api_key": "stale-codex-token",
            },
        )

        assert agent.model == "deepseek-v4-pro"
        assert captured["provider"] == "deepseek"
        assert captured["base_url"] == "https://fallback.invalid/v1"
        assert captured["api_key"] == "fb-tok"

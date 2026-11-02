"""Chat catalogs require saved profile configuration, not borrowed shell keys."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from hermes_cli.auth import is_provider_explicitly_configured
from hermes_cli.inventory import ConfigContext, _filter_explicit_provider_rows


@pytest.fixture
def profile_home(tmp_path, monkeypatch):
    home = tmp_path / "hermes"
    home.mkdir()
    (home / "config.yaml").write_text("model: {}\n")
    (home / "auth.json").write_text(json.dumps({"version": 1, "providers": {}, "credential_pool": {}}))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    return home


def _context():
    return ConfigContext(current_provider="", current_model="", current_base_url="", user_providers={}, custom_providers=[])


def test_chat_catalog_ignores_inherited_key_and_its_seeded_pool(profile_home, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-inherited-key")
    (profile_home / "auth.json").write_text(json.dumps({
        "version": 1, "providers": {}, "credential_pool": {
            "alibaba": [{"id": "inherited", "source": "env:DASHSCOPE_API_KEY", "auth_type": "api_key"}],
        },
    }))
    rows = [{"slug": slug, "models": ["model-a"]} for slug in ("alibaba", "alibaba-coding-plan")]

    # CLI/environment-based resolution remains a deliberate supported route.
    assert is_provider_explicitly_configured("alibaba") is True
    assert _filter_explicit_provider_rows(rows, _context()) == []


def test_default_moa_routes_do_not_make_an_inherited_key_user_configuration(profile_home, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-unrelated-shell-key")
    rows = [{"slug": "openrouter", "models": ["model-a"]}]

    assert _filter_explicit_provider_rows(rows, _context()) == []


def test_saved_auxiliary_route_remains_explicit_configuration(profile_home, monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-selected-shell-key")
    (profile_home / "config.yaml").write_text("auxiliary:\n  vision:\n    provider: openrouter\n")
    rows = [{"slug": "openrouter", "models": ["model-a"]}]

    assert _filter_explicit_provider_rows(rows, _context()) == rows


def test_administrator_saved_dotenv_credential_remains_configured(profile_home, tmp_path, monkeypatch):
    managed = tmp_path / "managed"
    managed.mkdir()
    (managed / ".env").write_text("DEEPSEEK_API_KEY=sk-administrator-key\n")
    monkeypatch.setenv("HERMES_MANAGED_DIR", str(managed))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-administrator-key")
    rows = [{"slug": "deepseek", "models": ["model-a"]}]

    assert _filter_explicit_provider_rows(rows, _context()) == rows


def test_saved_dotenv_credential_stays_scoped_to_its_profile(profile_home, monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-inherited-launch-profile")
    studio = profile_home / "profiles" / "studio"
    studio.mkdir(parents=True)
    (studio / "config.yaml").write_text("model: {}\n")
    (studio / ".env").write_text("DEEPSEEK_API_KEY=sk-saved-studio-key\n")

    from agent import secret_scope
    from tui_gateway import launch_profile_policy
    from hermes_cli.web_server_profiles import _config_profile_scope

    monkeypatch.setattr(secret_scope, "_MULTIPLEX_ACTIVE", False)
    monkeypatch.setattr(launch_profile_policy, "_snapshot", None)
    rows = [{"slug": "deepseek", "models": ["model-a"]}]

    assert _filter_explicit_provider_rows(rows, _context()) == []
    with _config_profile_scope("studio"):
        assert _filter_explicit_provider_rows(rows, _context()) == rows
    with _config_profile_scope(None):
        assert _filter_explicit_provider_rows(rows, _context()) == []


@pytest.mark.parametrize("source", ["manual", "device_code", "hermes_pkce"])
def test_saved_account_credentials_survive_without_dotenv(profile_home, source):
    (profile_home / "auth.json").write_text(json.dumps({
        "version": 1, "providers": {}, "credential_pool": {
            "alibaba": [{"id": "saved", "source": source, "auth_type": "api_key"}],
        },
    }))
    rows = [{"slug": "alibaba", "models": ["model-a"]}]

    assert _filter_explicit_provider_rows(rows, _context()) == rows


def test_current_custom_and_local_rows_keep_their_existing_routes(profile_home, monkeypatch):
    monkeypatch.setenv("DASHSCOPE_API_KEY", "sk-unrelated-shell-key")
    rows = [
        {"slug": "alibaba", "models": ["model-a"]},
        {"slug": "custom:lab", "is_user_defined": True, "models": ["model-b"]},
        {"slug": "llamacpp", "source": "local-runtime", "models": ["local-model"]},
    ]
    ctx = ConfigContext(current_provider="alibaba", current_model="model-a", current_base_url="", user_providers={}, custom_providers=[])

    assert _filter_explicit_provider_rows(rows, ctx) == rows

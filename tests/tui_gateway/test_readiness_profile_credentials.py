"""A secondary readiness probe cannot consume the launch profile's declared credential."""

import json
import os
from pathlib import Path

import pytest

from tui_gateway import server


@pytest.mark.parametrize("configured", [True, False], ids=["declared-key", "wrong-key-name"])
def test_launch_readiness_after_unconfigured_profile_probe(tmp_path, monkeypatch, configured):
    from agent.secret_scope import is_multiplex_active
    from hermes_cli.profiles import create_profile

    home = tmp_path / ".hermes"
    home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(server, "_hermes_home", home)
    for key in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "HERMES_TUI_MODEL", "HERMES_TUI_PROVIDER",
                "HERMES_INFERENCE_PROVIDER", "HERMES_MODEL"):
        monkeypatch.delenv(key, raising=False)
    endpoint = "http://127.0.0.1:1/v1"
    config = {"model": {"default": "mock-model", "provider": "custom", "base_url": endpoint},
              "custom_providers": [{"name": "Mock", "base_url": endpoint, "key_env": "OPENAI_API_KEY"}]}
    (home / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
    dotenv = "MOCK_API_KEY=e2e-mock-key\n" + ("OPENAI_API_KEY=e2e-mock-key\n" if configured else "")
    (home / ".env").write_text(dotenv, encoding="utf-8")

    def readiness(params):
        return server.handle_request({"id": "readiness", "method": "setup.runtime_check", "params": params})["result"]

    assert not is_multiplex_active()
    assert readiness({})["ok"] is True  # legacy single-profile mode permits the keyless placeholder
    monkeypatch.setattr("hermes_cli.profiles._notify_multiplexer", lambda name: None)
    secondary = create_profile("unconfigured", no_alias=True, no_skills=True)
    (secondary / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
    secondary_before = (secondary / ".env").read_bytes()
    env_before = os.environ.get("OPENAI_API_KEY")

    missing = readiness({"profile": "unconfigured"})
    assert missing["ok"] is False and "OPENAI_API_KEY" in missing["error"]
    assert is_multiplex_active()
    restored = readiness({})

    assert restored["ok"] is configured
    if not configured:
        assert "OPENAI_API_KEY" in restored["error"] and "'default'" in restored["error"]
    assert (home / ".env").read_text(encoding="utf-8") == dotenv
    assert (secondary / ".env").read_bytes() == secondary_before
    assert os.environ.get("OPENAI_API_KEY") == env_before

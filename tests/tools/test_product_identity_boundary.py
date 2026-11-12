"""Product copy reaches model tools while renderer payloads retain their real names."""

import json

from tools import read_window_tool, voice_live  # register the real desktop handler
from tools.registry import registry


def test_desktop_tool_error_names_aino_and_preserves_callback_evidence():
    unavailable = json.loads(registry.dispatch("read_window_below", {}))
    assert "Aino desktop app" in unavailable["error"]

    window = {"window": {"app": "Hermes Studio", "title": "Hermes reference"}, "platform": "darwin"}
    result = registry.dispatch("read_window_below", {}, callback=lambda: json.dumps(window))
    assert json.loads(result) == window


def test_live_voice_session_names_aino_without_changing_client_delegation(monkeypatch):
    monkeypatch.setattr(voice_live, "_live_section", lambda: {"instructions": "Keep the name Hermes Studio."})
    session = voice_live.build_session_config()

    assert session["instructions"].startswith("You are Aino,")
    assert "- Aino Agent:" in session["instructions"]
    assert session["instructions"].endswith("Keep the name Hermes Studio.")
    assert session["delegation"] == {"type": "client"}

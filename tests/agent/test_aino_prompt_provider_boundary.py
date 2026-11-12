"""Brand updates reach the real provider without rewriting a continuing chat's cached prefix.

The model is a recording loopback HTTP provider; sessions, CLI prompt refresh and the
agent's turn loop are real. No production credentials or user history are involved.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from tests.e2e.core.history._helpers import NO_BACKGROUND_REVIEW, OFFLINE_CONFIG
from tests.fakes.fake_llm_provider import FakeLLMServer, write_hermes_home

LEGACY_PROMPT = (
    "You are Hermes Agent, built by Nous Research. Keep this continuing conversation stable.\n\n"
    "Model: fake-model\nProvider: custom\nPlatform: desktop\n\n"
    "# Hermes runtime environment\n\nLegacy runtime instructions.\n\n"
    "<!-- End Hermes runtime environment -->"
)
LEGACY_HISTORY = [
    {"role": "user", "content": "Keep the existing conversation."},
    {"role": "assistant", "content": "The existing conversation remains available."},
]


@pytest.fixture
def desktop_profile(monkeypatch, tmp_path):
    home = Path(os.environ["HERMES_HOME"])
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("TERMINAL_CWD", str(project))
    monkeypatch.chdir(project)
    with FakeLLMServer() as server:
        write_hermes_home(home, server.base_url, extra_config=OFFLINE_CONFIG + NO_BACKGROUND_REVIEW)
        yield server, home


def _system(request: dict) -> str:
    message = request["messages"][0]
    assert message["role"] == "system"
    content = message["content"]
    return "".join(block.get("text", "") for block in content) if isinstance(content, list) else content


def _turn(server, home: Path, session_id: str, text: str, history: list[dict]) -> tuple[list[dict], str]:
    from hermes_state import SessionDB
    from run_agent import AIAgent

    with SessionDB(db_path=home / "state.db") as db:
        db.ensure_session(session_id, source="desktop")
        agent = AIAgent(
            provider="custom", base_url=server.base_url, api_key="sk-fake-e2e", model="fake-model",
            session_db=db, session_id=session_id, quiet_mode=True, platform="desktop",
        )
        try:
            result = agent.run_conversation(text, conversation_history=history, task_id="brand-boundary")
        finally:
            agent.close()
    return result["messages"], _system(server.main_requests()[-1])


def _assert_aino_desktop(prompt: str) -> None:
    assert "You are Aino" in prompt
    assert "inside the Aino desktop app" in prompt
    assert "You are Hermes Agent" not in prompt
    assert "inside the Hermes desktop app" not in prompt
    for protocol in (
        "MEDIA:/absolute/path", '::preview{file="path.html"}', 'data-hermes-send="prompt"',
        'window.hermes.send("prompt")', "var(--foreground)", "var(--muted-foreground)",
        "var(--accent)", "var(--border)", "var(--card)",
    ):
        assert protocol in prompt


def test_new_desktop_session_sends_aino_identity_and_rendering_instructions_to_provider(desktop_profile):
    server, home = desktop_profile

    _, prompt = _turn(server, home, "fresh-desktop", "Introduce yourself in this desktop session.", [])

    _assert_aino_desktop(prompt)


def test_existing_prefix_stays_frozen_until_real_cli_refresh_targets_its_next_turn(
    desktop_profile, monkeypatch,
):
    from hermes_state import SessionDB
    import hermes_cli.main as main_mod

    server, home = desktop_profile
    with SessionDB(db_path=home / "state.db") as db:
        for session_id in ("legacy-selected", "legacy-sibling"):
            db.create_session(session_id, source="desktop", system_prompt=LEGACY_PROMPT)

    selected_history, selected = _turn(
        server, home, "legacy-selected", "Continue without replacing my instructions.", LEGACY_HISTORY,
    )
    sibling_history, sibling = _turn(
        server, home, "legacy-sibling", "Continue this other conversation.", LEGACY_HISTORY,
    )
    assert selected.encode("utf-8") == sibling.encode("utf-8") == LEGACY_PROMPT.encode("utf-8")

    monkeypatch.setattr(sys, "argv", [
        "hermes", "sessions", "refresh-prompts", "--session", "legacy-selected",
    ])
    try:
        main_mod.main()
    except SystemExit as exc:
        assert exc.code in (0, None)

    with SessionDB(db_path=home / "state.db") as db:
        assert db.get_session("legacy-selected")["system_prompt"] == LEGACY_PROMPT
        assert db.get_session("legacy-sibling")["system_prompt"] == LEGACY_PROMPT

    selected_history, refreshed = _turn(
        server, home, "legacy-selected", "Adopt the new desktop instructions now.", selected_history,
    )
    _assert_aino_desktop(refreshed)
    _, untouched = _turn(server, home, "legacy-sibling", "Keep the other prefix.", sibling_history)
    assert untouched.encode("utf-8") == LEGACY_PROMPT.encode("utf-8")
    _, restored = _turn(server, home, "legacy-selected", "Continue with the refreshed prefix.", selected_history)
    assert restored.encode("utf-8") == refreshed.encode("utf-8")
    with SessionDB(db_path=home / "state.db") as db:
        assert db.get_session("legacy-selected")["system_prompt"] == refreshed
        assert db.get_session("legacy-sibling")["system_prompt"] == LEGACY_PROMPT

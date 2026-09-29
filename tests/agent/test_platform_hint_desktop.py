"""System-prompt assembly for the desktop chat surface.

Pins the second half of the fix: the new ``PLATFORM_HINTS["desktop"]``
entry, the deletion of the standalone desktop-hint block from
``build_environment_hints()``, and the lookup-site extension that
appends the embedded-terminal-pane clarifier to the ``tui`` platform hint
when ``HERMES_DESKTOP_TERMINAL=1``.

These tests run against the real prompt builders (no mocks) because
cache-stability and byte-for-byte text contracts are what we are
verifying — mocking the resolver would hide exactly the class of bug
this test covers.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from agent.prompt_builder import PLATFORM_HINTS
from agent.system_prompt import (
    _tui_embedded_pane_clarifier,
    build_system_prompt,
    build_system_prompt_parts,
)


def _stable_prompt(agent):
    with (
        patch("agent.prompt_builder.load_soul_md", return_value=""),
        patch("agent.prompt_builder.build_environment_hints", return_value=""),
        patch("agent.prompt_builder.build_context_files_prompt", return_value=""),
    ):
        return build_system_prompt_parts(agent)["stable"]


def _make_agent(platform="", **overrides):
    base = dict(
        load_soul_identity=False,
        skip_context_files=False,
        valid_tool_names=[],
        _task_completion_guidance=False,
        _tool_use_enforcement=False,
        _environment_probe=False,
        _kanban_worker_guidance="",
        _memory_store=None,
        _memory_manager=None,
        _platform_hint_overrides={},
        model="",
        provider="",
        pass_session_id=False,
        session_id="",
    )
    base["platform"] = platform
    base.update(overrides)
    return SimpleNamespace(**base)









class TestPlatformHintResolutionInStablePrompt:
    """End-to-end through ``build_system_prompt_parts`` — the platform tag on
    the agent drives BOTH which PLATFORM_HINTS entry gets appended AND
    whether the embedded-pane clarifier follows it. The desktop-hint block
    that used to live in ``build_environment_hints()`` is gone."""

    def test_desktop_guidance_follows_session_platform_without_launch_env(self, monkeypatch):
        monkeypatch.delenv("HERMES_DESKTOP", raising=False)
        monkeypatch.delenv("HERMES_DESKTOP_TERMINAL", raising=False)
        desktop = build_system_prompt_parts(_make_agent(platform="desktop", skip_context_files=True))
        tui = build_system_prompt_parts(_make_agent(platform="tui", skip_context_files=True))
        assert PLATFORM_HINTS["desktop"] in desktop["stable"]
        assert PLATFORM_HINTS["desktop"] not in tui["stable"]
        assert PLATFORM_HINTS["tui"] in tui["stable"]

    def test_hint_update_reaches_new_session_without_rewriting_stored_prompt(self, tmp_path, monkeypatch):
        from agent.conversation_loop import _restore_or_build_system_prompt
        from hermes_state import SessionDB

        agent = _make_agent(
            platform="desktop", skip_context_files=True,
            session_id="desktop-progress", _use_prompt_caching=False,
            _emit_diagnostic_status=lambda *_: None,
        )
        stored_prompt = build_system_prompt(agent)
        db = SessionDB(tmp_path / "state.db")
        try:
            db.create_session(agent.session_id, source=agent.platform, system_prompt=stored_prompt)
            next_hint = PLATFORM_HINTS["desktop"] + "\nUpdated surface instructions for the next session."
            monkeypatch.setitem(PLATFORM_HINTS, "desktop", next_hint)
            new_prompt = build_system_prompt_parts(_make_agent(platform="desktop", skip_context_files=True))
            assert next_hint in new_prompt["stable"]
            assert next_hint not in stored_prompt

            agent._session_db = db
            _restore_or_build_system_prompt(agent, None, [{"role": "user", "content": "Continue."}])
            assert agent._cached_system_prompt == stored_prompt
            assert db.get_session(agent.session_id)["system_prompt"] == stored_prompt
        finally:
            db.close()


    def test_embedded_tui_yields_tui_hint_with_clarifier(self, monkeypatch):
        monkeypatch.setenv("HERMES_DESKTOP", "1")
        monkeypatch.setenv("HERMES_DESKTOP_TERMINAL", "1")
        stable = _stable_prompt(_make_agent(platform="tui"))
        assert PLATFORM_HINTS["tui"] in stable
        assert "embedded terminal pane" in stable
        assert "Shift-drag" in stable or "Option-drag" in stable or "⌥" in stable



class TestEmbeddedTuiPaneClarifier:
    """When ``HERMES_DESKTOP_TERMINAL=1``, a standalone ``hermes --tui`` is
    running inside the desktop's embedded terminal pane. The user can
    ⌥-drag-select its output and ⌘/Ctrl+L to send it to the chat composer.
    That clarifier must be appended to the ``tui`` platform hint at the
    resolution site, NOT baked into the static ``PLATFORM_HINTS["tui"]``
    string (which is shared with every standalone TUI session and must
    stay byte-stable)."""





    @pytest.mark.parametrize("val", ["0", "false", ""])
    def test_falsy_env_does_not_trigger_clarifier(self, monkeypatch, val):
        monkeypatch.setenv("HERMES_DESKTOP_TERMINAL", val)
        out = _tui_embedded_pane_clarifier(PLATFORM_HINTS["tui"])
        assert out == PLATFORM_HINTS["tui"], (
            f"HERMES_DESKTOP_TERMINAL={val!r} should not trigger clarifier"
        )



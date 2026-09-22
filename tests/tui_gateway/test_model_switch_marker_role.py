"""Tests for _append_model_switch_marker role fix (issue #48338).

The model switch marker must NOT use role="system" because strict providers
(vLLM, Qwen) reject system messages that appear mid-conversation. Using
role="user" is safe — the system prompt is prepended to the API message list,
so a user-role marker can appear at any later position, and the gateway's
sanitize/merge pass already coalesces consecutive user messages.
"""

from __future__ import annotations

import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

from tui_gateway import server
from tui_gateway.server import _append_model_switch_marker


def test_model_switch_display_metadata_survives_persistence(tmp_path) -> None:
    from hermes_state import SessionDB

    db = SessionDB(tmp_path / "state.db")
    db.create_session("model-display", source="desktop", model="before")
    session = {"session_key": "model-display", "history": [], "agent": SimpleNamespace(_session_db=db)}
    try:
        _append_model_switch_marker(
            session, model="after", provider="aino", previous_model="before", previous_provider="openai")
        durable = db.get_messages_as_conversation("model-display")
        warm_message = session["history"][0]
        stored_message = durable[0]
        assert stored_message["display_metadata"] == warm_message["display_metadata"] == {
            "model": "after", "provider": "aino", "previous_model": "before", "previous_provider": "openai"}
        assert stored_message["timestamp"] == warm_message["timestamp"]
        assert "before" not in durable[0]["content"]
        assert durable[0]["role"] == "user"
    finally:
        db.close()


def test_committed_switch_event_matches_durable_marker(tmp_path, monkeypatch) -> None:
    from hermes_state import SessionDB

    db = SessionDB(tmp_path / "state.db")
    db.create_session("model-event", source="desktop", model="before")
    agent = SimpleNamespace(
        _session_db=db, model="after", provider="aino", _managed_model_metadata=None,
        switch_model=lambda **_kwargs: None)
    session = {"session_key": "model-event", "history": [], "agent": agent}
    emitted = []
    monkeypatch.setattr(server, "_restart_slash_worker", lambda *_args: None)
    monkeypatch.setattr(server, "_persist_live_session_runtime", lambda *_args: None)
    monkeypatch.setattr(server, "_persist_live_session_system_prompt", lambda *_args: None)
    monkeypatch.setattr(server, "_emit_session_info", lambda *_args: None)
    monkeypatch.setattr(server, "_emit", lambda event, sid, payload: emitted.append((event, sid, payload)))
    result = SimpleNamespace(new_model="after", target_provider="aino", api_key="", base_url="",
                             api_mode="", runtime_capabilities=None, managed_metadata=None)
    try:
        server._commit_agent_switch("ui", session, agent, result, "before", None)
        stored = db.get_messages_as_conversation("model-event", include_row_ids=True)[0]
        payload = emitted[-1][2]
        entry = payload["history_entry"]
        assert payload["kind"] == "model_switch"
        assert entry["text"] == "model changed"
        assert entry["row_id"] == stored["_row_id"]
        assert entry["timestamp"] == stored["timestamp"]
        assert entry["display_metadata"] == stored["display_metadata"]
    finally:
        db.close()


class TestAppendModelSwitchMarkerRole:
    """Verify the marker uses role='user', not role='system'."""

    def test_marker_uses_user_role(self) -> None:
        """The history entry must be role='user', not role='system'."""
        session: dict = {"session_key": "test-session", "history": []}
        _append_model_switch_marker(session, model="gpt-4o", provider="openai")
        assert len(session["history"]) == 1
        entry = session["history"][0]
        assert entry["role"] == "user", (
            f"Expected role='user' but got role='{entry['role']}'. "
            "Strict providers (vLLM, Qwen) reject mid-conversation system messages."
        )


    def test_no_marker_for_none_session(self) -> None:
        """None session should be a no-op."""
        _append_model_switch_marker(None, model="gpt-4o", provider="openai")


class TestModelSwitchMarkerDedup:
    """#65891: only the newest marker is meaningful; older ones must not
    accumulate in the live history and burn context tokens every turn."""

    @staticmethod
    def _markers(session: dict) -> list:
        from tui_gateway.server import _is_model_switch_marker

        return [h for h in session["history"] if _is_model_switch_marker(h)]

    def test_second_switch_replaces_first_marker(self) -> None:
        session: dict = {"session_key": "s", "history": []}
        _append_model_switch_marker(session, model="model-a", provider="p")
        _append_model_switch_marker(session, model="model-b", provider="p")
        markers = self._markers(session)
        assert len(markers) == 1, "a second switch must replace, not stack, the marker"
        assert "model-b" in markers[0]["content"]
        assert "model-a" not in markers[0]["content"]
        # The surviving marker is the last history entry.
        assert session["history"][-1] is markers[0]

    def test_five_switches_leave_one_marker(self) -> None:
        # Mirrors the issue's screenshot: 5 consecutive MoA preset switches.
        session: dict = {"session_key": "s", "history": []}
        for name in ("质量-非高峰", "省钱-非高峰", "代码编程-非高峰", "日常对话-非高峰", "智能-高峰"):
            _append_model_switch_marker(session, model=name, provider="moa")
        markers = self._markers(session)
        assert len(markers) == 1
        assert "智能-高峰" in markers[0]["content"]

    def test_dedup_preserves_real_conversation_turns(self) -> None:
        session: dict = {
            "session_key": "s",
            "history": [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "hi"},
            ],
        }
        _append_model_switch_marker(session, model="model-a", provider="p")
        _append_model_switch_marker(session, model="model-b", provider="p")
        # Real turns untouched; exactly one marker, appended at the end.
        assert session["history"][0] == {"role": "user", "content": "hello"}
        assert session["history"][1] == {"role": "assistant", "content": "hi"}
        assert len(self._markers(session)) == 1
        assert len(session["history"]) == 3

    def test_prior_marker_between_turns_is_removed(self) -> None:
        # A stale marker not at the tail (a later turn followed it) is still
        # stripped on the next switch.
        session: dict = {
            "session_key": "s",
            "history": [
                {"role": "user", "content": "q1"},
                _make_marker_entry("model-a"),
                {"role": "assistant", "content": "a1"},
            ],
        }
        _append_model_switch_marker(session, model="model-b", provider="p")
        markers = self._markers(session)
        assert len(markers) == 1
        assert "model-b" in markers[0]["content"]
        # The real turns are preserved in order.
        assert [h["content"] for h in session["history"] if not _is_marker(h)] == ["q1", "a1"]

    def test_history_version_increments_once_on_replace(self) -> None:
        session: dict = {"session_key": "s", "history": [], "history_version": 0}
        _append_model_switch_marker(session, model="model-a", provider="p")
        _append_model_switch_marker(session, model="model-b", provider="p")
        assert session["history_version"] == 2  # one increment per switch


def _make_marker_entry(model: str) -> dict:
    from tui_gateway.server import _MODEL_SWITCH_MARKER_PREFIX

    return {"role": "user", "content": f"{_MODEL_SWITCH_MARKER_PREFIX}{model}.]"}


def _is_marker(entry: dict) -> bool:
    from tui_gateway.server import _is_model_switch_marker

    return _is_model_switch_marker(entry)

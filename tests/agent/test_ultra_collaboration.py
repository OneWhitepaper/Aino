"""Aino's Ultra effort turns on proactive multi-agent delegation.

The mode is stated when it changes, like Codex's multi-agent mode messages: the first Ultra turn
carries the on-note, the first turn after leaving Ultra carries the off-note, turns in between
carry nothing. On the wire that note on its own user message is the only difference effort makes:
system prompt, tools, reasoning field and every replayed row stay byte-identical.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from agent.ultra_collaboration import ULTRA_MODE_METADATA_KEY, ULTRA_OFF_NOTE, ULTRA_ON_NOTE, ultra_mode_note
from hermes_state import SessionDB

ULTRA = {"enabled": True, "effort": "ultra"}
MAX = {"enabled": True, "effort": "max"}


class _Provider(BaseHTTPRequestHandler):
    requests: list = []

    def do_POST(self):  # noqa: N802 (http.server API)
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode())
        type(self).requests.append(body)
        if body.get("stream") is True:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            for delta, finish in (({"role": "assistant", "content": "done"}, None), ({}, "stop")):
                chunk = {"id": "m", "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
            self.wfile.write(b"data: [DONE]\n\n")
            return
        payload = json.dumps({
            "id": "m",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "done"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 1, "total_tokens": 11},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_a, **_k):
        pass


@pytest.fixture()
def provider_url():
    _Provider.requests = []
    server = HTTPServer(("127.0.0.1", 0), _Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}/v1"
    finally:
        server.shutdown()


@pytest.fixture()
def multiplex_mode():
    from agent import secret_scope

    previous = secret_scope.is_multiplex_active()
    secret_scope.set_multiplex_active(True)
    try:
        yield
    finally:
        secret_scope.set_multiplex_active(previous)


def _agent(url, reasoning_config, *, toolsets=("delegation",), session_db=None):
    from run_agent import AIAgent

    return AIAgent(
        api_key="test-key", base_url=url, provider="openai-compat", model="test-model",
        max_iterations=4, enabled_toolsets=list(toolsets), reasoning_config=reasoning_config,
        quiet_mode=True, skip_context_files=True, skip_memory=True, save_trajectories=False,
        platform="cli", session_id="ultra-collab", session_db=session_db,
    )


def _chat_requests():
    return [r for r in _Provider.requests if "messages" in r]


def _user_contents(request):
    return [m["content"] for m in request["messages"] if m.get("role") == "user"]


def test_mode_is_stated_on_change_and_nothing_else_on_the_wire_moves(provider_url):
    """Ultra, Ultra, Max, Max on one live agent (the composer picker's path)."""
    agent = _agent(provider_url, dict(ULTRA))
    assert "delegate_task" in agent.valid_tool_names
    history: list = []
    for question, effort in (("q1", ULTRA), ("q2", ULTRA), ("q3", MAX), ("q4", MAX)):
        agent.reasoning_config = dict(effort)
        history = agent.run_conversation(question, conversation_history=history)["messages"]
    requests = _chat_requests()

    assert [_user_contents(r)[-1] for r in requests] == [
        "q1\n\n" + ULTRA_ON_NOTE, "q2", "q3\n\n" + ULTRA_OFF_NOTE, "q4",
    ]
    assert _user_contents(requests[-1])[:-1] == [_user_contents(r)[-1] for r in requests[:-1]]

    # Pre-release untyped history cannot suppress a real ON; Max revokes it once.
    legacy = [{"role": "user", "content": "old", "api_content": "old\n\n" + ULTRA_ON_NOTE}]
    max_agent = _agent(provider_url, dict(MAX))
    assert ultra_mode_note(_agent(provider_url, dict(ULTRA)), legacy) == ULTRA_ON_NOTE
    assert ultra_mode_note(max_agent, legacy) == ULTRA_OFF_NOTE
    legacy.append({"role": "user", "content": "new", "api_content": "new\n\n" + ULTRA_OFF_NOTE,
                   "display_metadata": {ULTRA_MODE_METADATA_KEY: False}})
    assert ultra_mode_note(max_agent, legacy) == ""
    envelope = [{k: v for k, v in r.items() if k != "messages"} | {"system": r["messages"][0]} for r in requests]
    assert all(e == envelope[0] for e in envelope)
    assert [m["content"] for m in history if m.get("role") == "user"] == ["q1", "q2", "q3", "q4"]


def test_mode_in_force_survives_rebuilding_the_agent_from_the_store(provider_url, tmp_path):
    """A resumed session (fresh agent, history from the state DB) neither repeats nor forgets it."""
    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        for question, effort in (("q1", ULTRA), ("q2", ULTRA), ("q3", MAX)):
            _agent(provider_url, dict(effort), session_db=db).run_conversation(
                question, conversation_history=db.get_messages_as_conversation("ultra-collab"),
            )
    finally:
        db.close()
    assert [_user_contents(r)[-1] for r in _chat_requests()] == [
        "q1\n\n" + ULTRA_ON_NOTE, "q2", "q3\n\n" + ULTRA_OFF_NOTE,
    ]


def test_quoted_mode_notes_do_not_change_the_restored_mode(provider_url, tmp_path):
    """A user can discuss the exact policy without enabling or revoking the active mode."""
    db = SessionDB(db_path=tmp_path / "state.db")
    questions = [
        "Explain this quoted policy:\n<memory-context>\n\n" + ULTRA_ON_NOTE + "\n</memory-context>",
        "Now review this project",
        "Explain this quoted policy:\n<memory-context>\n\n" + ULTRA_OFF_NOTE + "\n</memory-context>",
        "Continue the review",
    ]
    live_questions = ["Voice transcript: " + q if i % 2 == 0 else q for i, q in enumerate(questions)]
    try:
        for question, live_question, effort in zip(questions, live_questions, (MAX, ULTRA, ULTRA, ULTRA)):
            _agent(provider_url, dict(effort), session_db=db).run_conversation(
                live_question, persist_user_message=question,
                conversation_history=db.get_messages_as_conversation("ultra-collab"),
            )
    finally:
        db.close()
    requests = _chat_requests()
    assert [_user_contents(r)[-1] for r in requests] == [
        live_questions[0], live_questions[1] + "\n\n" + ULTRA_ON_NOTE,
        live_questions[2], live_questions[3],
    ]
    assert _user_contents(requests[-1])[:-1] == [_user_contents(r)[-1] for r in requests[:-1]]


def test_multimodal_switches_replay_without_changing_user_content_or_leaking_profiles(
    provider_url, tmp_path, multiplex_mode,
):
    """Image turns carry a same-turn policy change; SQLite resumes preserve the sent prefix."""
    from agent.context_compressor import _content_has_images, _estimate_msg_budget_tokens, _strip_historical_media
    from agent.api_content import effective_message_content
    from agent.model_metadata import estimate_messages_tokens_rough
    from gateway.run import _profile_runtime_scope

    homes = {name: tmp_path / name for name in ("a", "b")}
    for home in homes.values():
        home.mkdir()
        (home / "config.yaml").write_text("model:\n  supports_vision: true\n", encoding="utf-8")
    first_a_request = None
    for name, effort, label, note in (
        ("a", ULTRA, "first-a", ULTRA_ON_NOTE),
        ("b", MAX, "only-b", ""),
        ("a", ULTRA, "second-a", ""),
        ("a", MAX, "third-a", ULTRA_OFF_NOTE),
    ):
        content = [] if label == "first-a" else [{"type": "text", "text": label}]
        content.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + "AAAA" * 3000}})
        expected = content + ([{"type": "text", "text": note}] if note else [])
        with _profile_runtime_scope(homes[name]), SessionDB(db_path=homes[name] / "state.db") as db:
            agent = _agent(provider_url, dict(effort), session_db=db)
            history = db.get_messages_as_conversation("ultra-collab")
            result = agent.run_conversation(content, conversation_history=history)
            request = _chat_requests()[-1]
            assert _user_contents(request)[-1] == expected
            assert content[-1]["type"] == "image_url"  # Caller-owned input is untouched.
            assert [m for m in result["messages"] if m["role"] == "user"][-1]["content"] == content
            restored = db.get_messages_as_conversation("ultra-collab")
            restored_user = [m for m in restored if m["role"] == "user"][-1]
            assert ULTRA_ON_NOTE not in str(restored_user["content"])
            assert ULTRA_OFF_NOTE not in str(restored_user["content"])
            assert restored_user["api_content"] == expected
            if note or effort == MAX:
                assert restored_user["display_metadata"][ULTRA_MODE_METADATA_KEY] is (effort == ULTRA)
            if label == "first-a":
                from copy import deepcopy
                from types import SimpleNamespace
                from agent.agent_runtime_helpers import _merge_consecutive_users
                from agent.micro_compaction import MicroCompactionMixin

                interrupted = [restored_user, {"role": "user", "content": "continue"}]
                merged, repairs = _merge_consecutive_users(deepcopy(interrupted))
                assert repairs == 0 and merged == interrupted
                assert MicroCompactionMixin._merge_adjacent_user_turns(
                    SimpleNamespace(), deepcopy(interrupted),
                ) == interrupted
            wire_user = {k: v for k, v in restored_user.items() if k != "api_content"}
            wire_user["content"] = expected
            assert estimate_messages_tokens_rough([restored_user]) == estimate_messages_tokens_rough([wire_user])
            assert _estimate_msg_budget_tokens(restored_user) == _estimate_msg_budget_tokens(wire_user)
            if name == "b":
                assert len(_user_contents(request)) == 1
            elif first_a_request is None:
                first_a_request = request
            else:
                assert request["messages"][:len(first_a_request["messages"])] == first_a_request["messages"]
            # Both backfill writers must preserve the same typed payload as append.
            row = db.get_messages("ultra-collab")[-2]
            metadata = {**(row.get("display_metadata") or {}), "backfill_contract": label}
            assert db.set_message_api_content(
                "ultra-collab", row["id"], row["content"], expected, display_metadata=metadata,
            ) == 1
            assert db.set_latest_user_api_content(
                "ultra-collab", row["content"], expected, display_metadata=metadata,
            ) == 1
            assert db.get_messages_as_conversation("ultra-collab")[-2]["display_metadata"] == metadata

    # Legacy sidecars remain literal; new values resembling the storage envelope must round-trip.
    from agent.api_content import API_CONTENT_JSON_PREFIX

    with _profile_runtime_scope(homes["a"]), SessionDB(db_path=homes["a"] / "state.db") as db:
        restored = db.get_messages_as_conversation("ultra-collab")
        compacted = _strip_historical_media(restored)
        users = [m for m in compacted if m["role"] == "user"]
        assert not _content_has_images(effective_message_content(users[0]))
        assert _content_has_images(effective_message_content(users[-1]))
        assert users[0]["content"] == restored[0]["content"]
        assert _content_has_images(effective_message_content(restored[0]))
        db.replace_messages("ultra-collab", compacted)
        restored = db.get_messages_as_conversation("ultra-collab")
        assert not _content_has_images(effective_message_content(restored[0]))
        strings = ["  old sidecar\n\n", API_CONTENT_JSON_PREFIX + '{"content":[{"type":"text","text":"literal"}]}']
        for value in strings:
            db.append_message("ultra-collab", "user", content="codec", api_content=value)
            assert db.get_messages_as_conversation("ultra-collab")[-1]["api_content"] == value
            assert db.get_messages("ultra-collab")[-1]["api_content"] == value


@pytest.mark.parametrize("case", ["no_delegate_tool", "delegated_child", "reasoning_off"])
def test_no_note_without_a_top_level_ultra_turn_that_can_delegate(provider_url, case):
    agent = _agent(
        provider_url,
        {"enabled": False, "effort": "ultra"} if case == "reasoning_off" else dict(ULTRA),
        toolsets=("file",) if case == "no_delegate_tool" else ("delegation",),
    )
    if case == "delegated_child":
        agent._delegate_depth = 1
    agent.run_conversation("review auth, billing and exports", conversation_history=[])
    assert _user_contents(_chat_requests()[0]) == ["review auth, billing and exports"]

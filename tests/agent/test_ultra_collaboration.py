"""Aino's Ultra effort turns on proactive multi-agent delegation.

The mode is stated when it changes, like Codex's multi-agent mode messages: the first Ultra turn
carries the on-note, the first turn after leaving Ultra carries the off-note, turns in between
carry nothing. On the wire that note on its own user message is the only difference effort makes:
system prompt, tools, reasoning field and every replayed row stay byte-identical.
"""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from types import SimpleNamespace
from unittest.mock import patch

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


def _agent(url, reasoning_config, *, toolsets=("delegation",), session_db=None, session_id="ultra-collab"):
    from run_agent import AIAgent

    return AIAgent(
        api_key="test-key", base_url=url, provider="openai-compat", model="test-model",
        max_iterations=4, enabled_toolsets=list(toolsets), reasoning_config=reasoning_config,
        quiet_mode=True, skip_context_files=True, skip_memory=True, save_trajectories=False,
        platform="cli", session_id=session_id, session_db=session_db,
    )


def _seed_unanswered_turn(db, session_id, question, *, note, recorded):
    """The durable tail a failed delivery attempt leaves: its turn-start flush wrote the DM row with
    the runtime-stamped mode metadata (and the note's sidecar when it carried one) and no reply followed."""
    db.append_message(
        session_id, "user", content=question,
        api_content=f"{question}\n\n{note}" if note else None,
        display_metadata={ULTRA_MODE_METADATA_KEY: recorded},
    )


def _retry_unanswered_turn(url, effort, db, session_id, question):
    """Re-run a failed delivery turn through the quiet-CLI dispatcher lane: the env-gated adoption
    helper re-stages the persisted tail row as this turn's user message, then the real agent runs.
    History is loaded exactly as that lane loads it — ``cli_agent_setup_mixin._load_resumed_history_late``
    (and ``api_server._conversation_history_for_session``, minus the alternation repair) reads the
    transcript WITHOUT row ids, so the retry cannot assume an addressed row."""
    from hermes_cli.quiet_single_query import adopt_unanswered_turn as adopt_quiet_turn
    from tools.bot_relay import RESUME_UNANSWERED_TURN_ENV

    agent = _agent(url, dict(effort), session_db=db, session_id=session_id)
    history = db.get_messages_as_conversation(session_id, repair_alternation=True)
    cli = SimpleNamespace(conversation_history=history, agent=agent)
    with patch.dict(os.environ, {RESUME_UNANSWERED_TURN_ENV: "1"}):
        assert adopt_quiet_turn(cli, question) is True
    return agent.run_conversation(question, conversation_history=cli.conversation_history)


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


def test_adopted_unanswered_turn_retried_at_max_revokes_the_stale_on(provider_url, tmp_path):
    """A delivery retry adopts the failed attempt's own row, so that row is the only place its
    Ultra-on note lives: running the retry at Max must revoke it on THIS wire and record what was
    sent. Leaving the on-note beside a recorded-off turn keeps proactive delegation alive in the
    transcript with no later note able to revoke it (the retry's own row is never scanned again)."""
    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        db.create_session(session_id="retried-ultra", source="cli")
        _seed_unanswered_turn(db, "retried-ultra", "resume task", note=ULTRA_ON_NOTE, recorded=True)

        result = _retry_unanswered_turn(provider_url, MAX, db, "retried-ultra", "resume task")
        assert result["final_response"] == "done"
        assert _user_contents(_chat_requests()[-1]) == ["resume task\n\n" + ULTRA_OFF_NOTE]

        restored = db.get_messages_as_conversation("retried-ultra")
        user_rows = [m for m in restored if m["role"] == "user"]
        assert [m["content"] for m in user_rows] == ["resume task"]  # adopted in place, never appended twice
        assert user_rows[0]["display_metadata"][ULTRA_MODE_METADATA_KEY] is False
        assert user_rows[0]["api_content"] == "resume task\n\n" + ULTRA_OFF_NOTE

        # The next turn replays the retry's bytes and repeats nothing: the mode is off for good.
        _agent(provider_url, dict(MAX), session_db=db, session_id="retried-ultra").run_conversation(
            "follow up", conversation_history=db.get_messages_as_conversation("retried-ultra", include_row_ids=True),
        )
        assert _user_contents(_chat_requests()[-1]) == ["resume task\n\n" + ULTRA_OFF_NOTE, "follow up"]
    finally:
        db.close()


def test_adopted_unanswered_turn_retried_at_ultra_announces_the_mode(provider_url, tmp_path):
    """Mirror image: the failed attempt ran at Max (recorded off, nothing on the wire) and the retry
    runs at Ultra. The adopted row's own record is the whole provenance, so the retry must record the
    mode it announces — a row left recorded off while the wire says Ultra makes every rebuild announce
    it again, the same way a sent Max turn becomes the provenance for the next Ultra turn."""
    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        db.create_session(session_id="retried-max", source="cli")
        _seed_unanswered_turn(db, "retried-max", "resume task", note="", recorded=False)

        _retry_unanswered_turn(provider_url, ULTRA, db, "retried-max", "resume task")
        assert _user_contents(_chat_requests()[-1]) == ["resume task\n\n" + ULTRA_ON_NOTE]

        restored = db.get_messages_as_conversation("retried-max")
        user_row = [m for m in restored if m["role"] == "user"][0]
        assert user_row["display_metadata"][ULTRA_MODE_METADATA_KEY] is True
        assert user_row["api_content"] == "resume task\n\n" + ULTRA_ON_NOTE

        # Staying on Ultra states nothing further; the announced note is replayed verbatim.
        _agent(provider_url, dict(ULTRA), session_db=db, session_id="retried-max").run_conversation(
            "follow up", conversation_history=db.get_messages_as_conversation("retried-max", include_row_ids=True),
        )
        assert _user_contents(_chat_requests()[-1]) == ["resume task\n\n" + ULTRA_ON_NOTE, "follow up"]
    finally:
        db.close()


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


def test_ultra_note_defines_result_integration_and_bounded_verification():
    """The Ultra contract must converge after delivery without imposing a length or read cap."""
    assert "completion notice" in ULTRA_ON_NOTE
    assert "consume the complete result" in ULTRA_ON_NOTE
    assert "central claims" in ULTRA_ON_NOTE
    assert "focused lookups" in ULTRA_ON_NOTE
    assert "Do not reopen a broad scan" in ULTRA_ON_NOTE
    assert "preserve limitations" in ULTRA_ON_NOTE
    assert "requested format" in ULTRA_ON_NOTE
    assert "400" not in ULTRA_ON_NOTE

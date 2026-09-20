"""Managed input admission crosses the real turn/flush/provider boundary atomically."""
import hashlib

import pytest

from tests.agent.test_api_content_sidecar import wire_env, _chat_requests, _user_messages


def _input():
    from agent.conversation_input import ManagedConversationInput
    return ManagedConversationInput(
        input_id="input-one", input_digest=hashlib.sha256(b"hello").hexdigest(),
        conversation_id="conversation", participant_id="alice", session_generation=1,
    )


@pytest.mark.parametrize("failure", ["commit", "sidecar", "snapshot", "ack"])
def test_managed_input_failure_never_reaches_main_provider(wire_env, monkeypatch, failure):
    from agent.conversation_input import managed_conversation_input
    make_agent, handler, db, sid = wire_env
    agent = make_agent()
    db.create_session(sid, source="test")
    original = db._execute_write
    if failure == "commit":
        def execute(fn, patience_s=None):
            def fail(conn):
                result = fn(conn)
                if conn.execute("SELECT 1 FROM conversation_input_receipts").fetchone():
                    raise RuntimeError("injected commit failure")
                return result
            return original(fail, patience_s=patience_s)
        monkeypatch.setattr(db, "_execute_write", execute)
    elif failure == "sidecar":
        monkeypatch.setattr(db, "set_message_api_content", lambda *a, **k: 0)
    elif failure == "snapshot":
        def reject(agent):
            assert db.get_conversation_input_receipt("input-one") is not None
            raise RuntimeError("snapshot mismatch")
        agent._conversation_snapshot_guard = reject
    before = len(_chat_requests(handler))
    def ack(receipt):
        if failure == "ack":
            raise RuntimeError("shared ACK failed")
    with managed_conversation_input(agent, _input(), on_persisted=ack):
        with pytest.raises(RuntimeError):
            agent.run_conversation("hello")
    assert len(_chat_requests(handler)) == before
    assert agent._managed_conversation_input is None
    if failure == "commit":
        monkeypatch.setattr(db, "_execute_write", original)
        agent._persist_session(agent._session_messages)
        assert db.get_conversation_input_receipt("input-one") is None
        assert not [row for row in db.get_messages(sid) if row["role"] == "user"]


@pytest.mark.parametrize("compact", [None, "in_place", "rotation", "callback_failure"])
def test_managed_receipt_survives_flush_compaction_and_replay(wire_env, monkeypatch, compact):
    from agent.conversation_input import ConversationInputRecoveryRequired, managed_conversation_input
    from agent.turn_context_compaction import CompactionOutcome
    make_agent, handler, db, sid = wire_env
    agent = make_agent()
    seen = []
    committed = []
    def guard(agent):
        receipt = db.get_conversation_input_receipt("input-one")
        assert receipt is not None
        assert db.get_session(agent.session_id)["system_prompt"] == agent._cached_system_prompt
        seen.append(receipt)
    agent._conversation_snapshot_guard = guard
    history = []
    if compact:
        def compression_committed(agent):
            guard(agent)
            committed.append(agent.session_id)
            if compact == "callback_failure":
                raise RuntimeError("compression publication failed")
        agent._conversation_compression_committed = compression_committed
        def forbid_config_refresh(*args, **kwargs):
            raise AssertionError("compression tried to import changed Profile configuration")
        monkeypatch.setattr("agent.conversation_compression._refresh_agent_tool_definitions", forbid_config_refresh)
        monkeypatch.setattr(agent, "_invalidate_system_prompt", forbid_config_refresh)
        db.create_session(sid, source="test")
        db.append_message(sid, "user", content="old request " * 300)
        db.append_message(sid, "assistant", content="old response " * 300)
        history = db.get_messages_as_conversation(sid)
        agent.compression_in_place = compact != "rotation"
        agent.context_compressor.compress = lambda messages, **kwargs: [dict(messages[-1])]
        agent.context_compressor._last_compress_aborted = False
        agent.context_compressor._last_summary_error = None
        def compress(agent, **kwargs):
            from agent.conversation_compression import compress_context
            assert db.get_conversation_input_receipt("input-one") is not None
            messages, prompt = compress_context(
                agent, kwargs["messages"], system_message=kwargs["system_message"],
                approx_tokens=100_000, force=True,
            )
            assert agent._last_compaction_in_place == (compact != "rotation")
            assert len(messages) == 1
            agent._persist_user_message_idx = 0
            return CompactionOutcome(
                messages=messages, active_system_prompt=prompt,
                conversation_history=messages[:], current_turn_user_idx=0, compressed=True,
            )
        monkeypatch.setattr("agent.turn_context_compaction.run_turn_start_compaction", compress)
    if compact == "callback_failure":
        before = len(_chat_requests(handler))
        with managed_conversation_input(agent, _input()):
            with pytest.raises(RuntimeError, match="compression publication"):
                agent.run_conversation("hello", conversation_history=history)
        assert db.get_conversation_input_receipt("input-one") is not None
        assert len(_chat_requests(handler)) == before
        assert agent._managed_conversation_input is None
        return
    with managed_conversation_input(agent, _input()) as admission:
        result = agent.run_conversation("hello", persist_user_message="display text", conversation_history=history)
        assert admission.receipt.message_row_id == seen[0].message_row_id
        assert admission.ready is True
        if compact:
            assert committed == [agent.session_id]
        assert result["final_response"] == "DONE"
        agent._persist_session(agent._session_messages)
        agent._persist_session(agent._session_messages)
    assert agent._managed_conversation_input is None
    rows = db.get_messages(agent.session_id)
    user = [row for row in rows if row["role"] == "user"]
    assert len(user) == 1
    assert user[0]["content"] == "display text"
    assert user[0]["api_content"] == _user_messages(_chat_requests(handler)[-1])[-1]["content"]
    assert db.get_conversation_input_receipt("input-one").message_row_id == seen[0].message_row_id
    before = len(_chat_requests(handler))
    with pytest.raises(ConversationInputRecoveryRequired) as replay:
        with managed_conversation_input(agent, _input()):
            agent.run_conversation("hello")
    assert replay.value.receipt.message_row_id == seen[0].message_row_id
    assert len(_chat_requests(handler)) == before
    assert len([row for row in db.get_messages(agent.session_id) if row["role"] == "user"]) == 1

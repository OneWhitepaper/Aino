"""Reply diagnostics are turn-scoped presentation data, never model context."""

from types import SimpleNamespace

import pytest

from hermes_state import SessionDB


def test_reply_metrics_measure_all_calls_and_survive_reopening(tmp_path, monkeypatch):
    from run_agent import AIAgent
    from agent.turn_usage import record_response_usage
    from tui_gateway.turn_metrics import begin_turn_metrics, finish_turn_metrics

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    db = SessionDB(db_path=tmp_path / "state.db")
    db.create_session("metrics", "desktop")
    agent = AIAgent(api_key="test", base_url="https://api.openai.com/v1", provider="openai",
                    model="gpt-4o", api_mode="chat_completions", session_id="metrics",
                    quiet_mode=True, skip_context_files=True, skip_memory=True,
                    save_trajectories=False, enabled_toolsets=[])
    agent._session_db = db
    session = {"session_key": "metrics", "created_at": 100, "history": []}

    def record(prompt, output, cached, duration):
        usage = SimpleNamespace(prompt_tokens=prompt, completion_tokens=output,
                                total_tokens=prompt + output,
                                prompt_tokens_details=SimpleNamespace(cached_tokens=cached))
        record_response_usage(agent, SimpleNamespace(usage=usage), messages=[], api_call_count=1,
                              api_duration=duration, compression_attempts=0, max_compression_attempts=3)

    try:
        record(9000, 1000, 0, 100)  # Previous turn must not affect this reply.
        before = begin_turn_metrics(agent, session, now=200, monotonic=10)
        db.append_message("metrics", "user", "question")
        row = db.append_message("metrics", "assistant", "answer")
        db.set_message_reaction("metrics", row, "ok")
        session["history"] = [{"role": "user", "content": "question"},
                              {"role": "assistant", "content": "answer"}]
        for _ in range(12):  # More than the rolling speed deque can hold.
            record(100, 10, 80, 0.5)
        metrics = finish_turn_metrics(agent, session, before, {"context_percent": 18},
                                      "answer", persist=True, monotonic=22)
        assert metrics["duration_s"] == 12
        assert metrics["session_elapsed_s"] == 112
        assert metrics["total_tokens"] == 1320
        assert metrics["tokens_per_second"] == pytest.approx(20)
        assert metrics["cache_hit_pct"] == pytest.approx(80)
        assert metrics["context_percent"] == 18
        with SessionDB(db_path=db.db_path) as reopened:
            messages = reopened.get_messages_as_conversation("metrics", include_row_ids=True)
            assert messages[-1]["display_metadata"]["turn_metrics"] == metrics
            assert reopened.get_message_reactions("metrics", row)[0]["emoji"] == "ok"
        assert [m["content"] for m in messages] == ["question", "answer"]
        assert session["history"][-1]["display_metadata"]["turn_metrics"] == metrics
        from agent.turn_context import _reset_per_turn_agent_state, build_api_messages
        _reset_per_turn_agent_state(agent)
        wire, system = build_api_messages(
            agent, messages, current_turn_user_idx=-1, ext_prefetch_cache=None,
            plugin_user_context=None, moa_config=None, active_system_prompt="stable system")
        assert all("display_metadata" not in message for message in wire)
        assert system == "stable system"
    finally:
        agent.close()
        db.close()


def test_missing_usage_never_reuses_previous_reply_or_session_totals(tmp_path):
    from tui_gateway.turn_metrics import begin_turn_metrics, finish_turn_metrics

    with SessionDB(db_path=tmp_path / "state.db") as db:
        db.create_session("metrics", "desktop")
        db.append_message("metrics", "assistant", "same answer")
        agent = SimpleNamespace(_session_db=db, session_id="metrics", session_total_tokens=5000)
        session = {"session_key": "metrics", "created_at": 100, "history": []}
        before = begin_turn_metrics(agent, session, now=200, monotonic=10)
        result = finish_turn_metrics(agent, session, before, {"avg_tps": 300, "cache_hit_pct": 95},
                                     "same answer", persist=True, monotonic=12)
        assert result == {"duration_s": 2, "session_elapsed_s": 102}
        assert "display_metadata" not in db.get_messages_as_conversation("metrics")[-1]


def test_native_codex_usage_does_not_require_standard_loop_timing():
    from agent.codex_runtime import _record_codex_app_server_usage
    from tui_gateway.managed_model_usage import begin_managed_usage, end_managed_usage
    from tui_gateway.turn_metrics import begin_turn_metrics, finish_turn_metrics

    agent = SimpleNamespace(
        model="gpt-4o", provider="openai", base_url="https://api.openai.com/v1", api_key="test",
        session_api_calls=0, session_prompt_tokens=0, session_completion_tokens=0,
        session_total_tokens=0, session_input_tokens=0, session_output_tokens=0,
        session_cache_read_tokens=0, session_cache_write_tokens=0, session_reasoning_tokens=0,
        session_estimated_cost_usd=0, _session_db=None,
    )
    session = {"history": []}
    token = begin_managed_usage(agent)
    try:
        start = begin_turn_metrics(agent, session, monotonic=10)
        _record_codex_app_server_usage(agent, SimpleNamespace(token_usage_last={
            "inputTokens": 500, "cachedInputTokens": 400, "outputTokens": 50,
        }))
        metrics = finish_turn_metrics(agent, session, start, {}, "done", persist=False, monotonic=20)
    finally:
        end_managed_usage(token)
    assert metrics["total_tokens"] == 550
    assert metrics["cache_hit_pct"] == 80
    assert metrics["non_aino_model_calls"] is True
    assert "tokens_per_second" not in metrics


def test_transformed_reply_keeps_metrics_on_its_original_persisted_row(tmp_path):
    from tui_gateway.turn_metrics import begin_turn_metrics, finish_turn_metrics

    with SessionDB(db_path=tmp_path / "state.db") as db:
        db.create_session("metrics", "desktop")
        agent = SimpleNamespace(_session_db=db, session_id="metrics")
        session = {"session_key": "metrics", "history": []}
        start = begin_turn_metrics(agent, session, monotonic=10)
        db.append_message("metrics", "user", "question")
        db.append_message("metrics", "assistant", "original answer")
        session["history"] = [{"role": "user", "content": "question"},
                              {"role": "assistant", "content": "original answer"}]
        metrics = finish_turn_metrics(agent, session, start, {}, "original answer\nExtra output-hook note",
                                      persist=True, monotonic=12)
        row = db.get_messages_as_conversation("metrics")[-1]
        assert row["content"] == "original answer"
        assert row["display_metadata"]["turn_metrics"] == metrics


@pytest.mark.parametrize(("provider", "base_url", "api_key"), [
    ("openrouter", "https://openrouter.ai/api/v1", "fixture-key"),
    ("custom", "http://127.0.0.1:12345/v1", "no-key-required"),
])
def test_completed_non_aino_call_records_neutral_source_for_canonical_and_local_runtime(
        provider, base_url, api_key):
    from agent.turn_usage import record_response_usage
    from run_agent import AIAgent
    from tui_gateway.managed_model_usage import begin_managed_usage, end_managed_usage
    from tui_gateway.turn_metrics import begin_turn_metrics, finish_turn_metrics

    agent = AIAgent(
        api_key=api_key, base_url=base_url, provider=provider, model="fixture-model",
        api_mode="chat_completions", quiet_mode=True, skip_context_files=True,
        skip_memory=True, save_trajectories=False, enabled_toolsets=[])
    session = {"history": []}
    token = begin_managed_usage(agent)
    try:
        start = begin_turn_metrics(agent, session, monotonic=10)
        usage = SimpleNamespace(
            prompt_tokens=10, completion_tokens=3, total_tokens=13,
            prompt_tokens_details=SimpleNamespace(cached_tokens=0))
        record_response_usage(
            agent, SimpleNamespace(usage=usage), messages=[], api_call_count=1,
            api_duration=1, compression_attempts=0, max_compression_attempts=3)
        metrics = finish_turn_metrics(
            agent, session, start, {}, "done", persist=False, monotonic=12)
    finally:
        end_managed_usage(token)
        agent.close()

    assert metrics["non_aino_model_calls"] is True
    assert metrics["duration_s"] == 2
    assert metrics["total_tokens"] == 13
    assert "billing" not in metrics

"""An ambiguous managed request stays partial and nonretryable across a cold read."""

import json
import threading
from types import SimpleNamespace

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential
from agent.conversation_loop import _close_durable_failed_turn
from agent.managed_inference_errors import ManagedOperationUnknown, managed_failure_result
from hermes_state import SessionDB
from run_agent import AIAgent
from tools.bot_failure_reasons import RETRY_NONE, result_retry_action
from tui_gateway import server
from tui_gateway.turn_marker import read_turn_marker, record_turn_start


def test_managed_unknown_keeps_partial_and_nonretryable_verdict_after_cold_resume(tmp_path, monkeypatch, request):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setenv("HERMES_DISABLE_PLUGINS", "1")
    (tmp_path / "config.yaml").write_text(
        "model:\n  provider: openai-compat\n  default: fixture-model\n"
        "  base_url: http://127.0.0.1:1/v1\n  context_length: 256000\n"
        "compression:\n  enabled: false\n")
    db_path = tmp_path / "state.db"
    session_id = "managed-unknown"
    partial = "The existing file contains three entries."
    prompt = "Inspect the file and continue."
    db = SessionDB(db_path=db_path)
    request.addfinalizer(db.close)
    db.create_session(session_id, source="tui", model="fixture-model")
    agent = AIAgent(session_db=db, session_id=session_id, model="fixture-model", provider="openai-compat",
                    api_key="fixture", base_url="http://127.0.0.1:1/v1", quiet_mode=True,
                    skip_context_files=True, skip_memory=True, enabled_toolsets=[])
    agent.api_key = ManagedCredential(lambda: "fixture", "owner", session_id, "fixture-model",
                                     "https://aino.invalid/v1", "chat_completions", False,
                                     scope=BillingScope("aino", "owner", session_id, "turn", "chat"))
    agent.provider = "aino"
    agent._current_streamed_assistant_text = partial
    agent._session_title_hint = "Managed test"
    messages = [{"role": "user", "content": prompt}]
    agent._flush_messages_to_session_db(messages)

    result = managed_failure_result(agent, ManagedOperationUnknown(), messages, 1)
    assert result["failed"] and not result["completed"]
    assert result["failure_reason"] == "managed_operation_unknown"
    assert result["failure_retryable"] is False
    assert result["partial"] is True
    assert result["final_response"] == partial
    assert result_retry_action(result) == RETRY_NONE

    _close_durable_failed_turn(agent, result)
    _close_durable_failed_turn(agent, result)
    session = {"agent": agent, "session_key": session_id, "profile_home": str(tmp_path),
               "history": messages, "history_lock": threading.Lock(), "running": False,
               "managed_model_params": {"source": "aino"}}
    server._start_inflight_turn(session, prompt)
    server._append_inflight_delta(session, partial)
    state = SimpleNamespace(result=result, agent=agent, history=[], compression_count=0,
                            metrics_start=None, prompt_text=prompt, terminal_callback=None,
                            receipt_committed=False)
    payload, text, status = server._complete_turn_payload(session, state, None, 80, "viewer")
    assert (text, status) == (partial, "error")
    assert payload["partial"] is True
    assert payload["error_surface"]["code"] == "managed_operation_unknown"
    assert payload["error_surface"]["retryable"] is False
    live = server._inflight_snapshot(session)
    assert live["assistant"] == partial
    assert live["error_surface"] == payload["error_surface"]
    db.close()

    # New SessionDB and session objects retain no in-memory failure/result state.
    with SessionDB(db_path=db_path) as reopened:
        rows = reopened.get_messages(session_id)
        assert [row["role"] for row in rows] == ["user", "assistant"]
        failed = rows[-1]
        assert partial in failed["content"]
        metadata = failed["display_metadata"]
        metadata = json.loads(metadata) if isinstance(metadata, str) else metadata
        assert metadata["error_surface"]["code"] == "managed_operation_unknown"
        assert metadata["error_surface"]["retryable"] is False
        assert metadata["error"] == result["error"]
        visible = server._history_to_messages(rows, profile_home=str(tmp_path))
        assert partial in visible[-1]["text"]
        assert visible[-1]["display_metadata"]["error_surface"]["retryable"] is False
        cold = {"session_key": session_id, "profile_home": str(tmp_path),
                "history": rows, "history_lock": threading.Lock(), "running": False,
                "managed_model_params": {"source": "aino"}}
        record_turn_start(tmp_path, session_id, prompt)
        monkeypatch.setattr(server, "_hermes_home", tmp_path)
        monkeypatch.setattr(server, "_auto_continue_config", lambda: (True, 3600, 3))
        assert server._maybe_schedule_auto_continue("cold-viewer", cold, session_id) is None
        assert not cold.get("_auto_continue_scheduled")
        assert read_turn_marker(tmp_path, session_id) is not None

"""An intentional user pause closes API roles without asking the user to resend."""

import threading
import time
from types import SimpleNamespace

import pytest

from agent.conversation_loop import _close_durable_failed_turn
from agent.turn_facade_lease import _lease_not_acquired_result
from agent.turn_failure_copy import FAILED_TURN_NOTICE
from gateway.run import _normalize_empty_agent_response
from hermes_state import SessionDB
from tests.agent.test_turn_finalizer_interrupt_alternation import _StubAgent, _finalize
from tests.agent.test_turn_api_call_interrupt import _bare_agent


@pytest.mark.parametrize("reason", ["explicit stop requested", "gateway shutdown"])
@pytest.mark.parametrize("partial", ["", "Visible draft."])
def test_only_the_empty_user_pause_omits_internal_model_wait_diagnostics(reason, partial):
    from agent.turn_api_call import handle_api_interrupt
    from agent.turn_retry_state import TurnRetryState

    agent = _bare_agent(partial)
    agent._tool_interrupt_reason = reason
    messages = [{"role": "user", "content": "start"}]
    verdict = handle_api_interrupt(
        agent, _retry=TurnRetryState(), thinking_spinner=None, messages=messages,
        conversation_history=[], api_start_time=time.time(), interrupted=False, final_response=None,
    )
    if partial:
        assert verdict.final_response == partial
        assert messages[-1]["content"] == partial
    elif reason == "explicit stop requested":
        assert verdict.final_response == ""
        finished = _StubAgent()
        finished._tool_interrupt_reason = reason
        result = _finalize(finished, messages, interrupted=True, final_response=verdict.final_response)
        assert result["final_response"] == ""
        assert result["user_interrupted"] is True
    else:
        assert verdict.final_response.startswith("Operation interrupted: waiting for model response (")


def test_user_pause_of_budget_summary_omits_internal_model_wait_diagnostics():
    from agent.turn_finalizer import _resolve_budget_fallback

    agent = _StubAgent()
    agent.max_iterations = 1
    agent._tool_interrupt_reason = "explicit stop requested"
    agent._emit_diagnostic_status = lambda text: None

    def pause(*args):
        raise InterruptedError("Agent interrupted during API call")

    agent._handle_max_iterations = pause
    response, _, _, interrupted = _resolve_budget_fallback(
        agent, final_response=None, api_call_count=1, interrupted=False, failed=False, messages=[],
        _turn_exit_reason="budget_exhausted", _pending_verification_response=None,
        _pending_verification_response_previewed=False, logger=SimpleNamespace(),
    )
    assert interrupted is True
    assert response == ""


@pytest.mark.parametrize("failure", [False, True])
def test_user_pause_closes_the_durable_tail_without_resend_advice(tmp_path, monkeypatch, failure):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    with SessionDB(tmp_path / "state.db") as db:
        db.create_session("sess-1", source="desktop", model="stub/model")
        db.append_message("sess-1", "user", "continue the task")
        messages = [{"role": "user", "content": "continue the task"}]
        agent = _StubAgent()
        agent._tool_interrupt_reason = "explicit stop requested"
        result = _finalize(agent, messages, interrupted=True)
        if failure:
            result.update(failed=True, error="fixture persistence failure")

        def flush(rows):
            row = rows[-1]
            db.append_message("sess-1", row["role"], row["content"],
                              display_kind=row.get("display_kind"), api_content=row.get("api_content"))

        agent._session_db = db
        agent._flush_messages_to_session_db = flush
        _close_durable_failed_turn(agent, result)
        _close_durable_failed_turn(agent, result)
        rows = db.get_messages("sess-1")
        assert [row["role"] for row in rows] == ["user", "assistant"]
        if failure:
            assert rows[-1]["display_kind"] == "failed_turn"
            assert rows[-1]["content"] == FAILED_TURN_NOTICE
        else:
            assert rows[-1]["display_kind"] == "hidden"
            assert not rows[-1]["content"]
            assert rows[-1]["api_content"]
            assert result["user_interrupted"] is True


@pytest.mark.parametrize("reason", ["explicit stop requested", "gateway shutdown", None])
@pytest.mark.parametrize("waited", [False, True])
def test_early_stop_suppresses_resend_only_with_proven_user_intent(reason, waited):
    stopped = threading.Event()
    stopped.set()
    agent = SimpleNamespace(_interrupt_requested=True, _hard_interrupt_requested=stopped,
                            _tool_interrupt_reason=reason, _interrupt_message=None,
                            clear_interrupt=lambda: None)
    result = _lease_not_acquired_result(agent, "session", [], waited=waited)
    text = _normalize_empty_agent_response(result, result["final_response"])
    assert result["interrupted"] is True
    if reason == "explicit stop requested":
        assert result["user_interrupted"] is True
        assert text == ""
    else:
        assert not result.get("user_interrupted")
        assert "not processed" in text

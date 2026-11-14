"""Explicit pauses retain control-flow semantics after a managed request was sent."""

from types import SimpleNamespace

import httpx
import pytest

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential
from tests.tui_gateway.test_managed_model_agent import managed_gateway as _managed_gateway, result

managed_gateway = _managed_gateway


@pytest.mark.parametrize("entry", ["primary", "summary"])
def test_dispatched_managed_pause_reaches_interrupt_handler(monkeypatch, entry):
    from agent.chat_completion_summary import managed_summary_call
    from agent.turn_api_call import perform_api_call

    key = ManagedCredential(lambda: "fixture", "owner", "session", "model", "https://aino.invalid/v1",
                            "chat_completions", False,
                            scope=BillingScope("aino", "owner", "session", "turn", "chat"))
    paused = InterruptedError("Agent interrupted during API call")

    def dispatch(request):
        key.prepare_request(httpx.Request("POST", key.base_url + "/chat/completions", json={"model": "model"}))
        raise paused

    agent = SimpleNamespace(api_key=key, api_mode="chat_completions", provider="aino", model="model",
                            session_id="session", platform="desktop", base_url=key.base_url,
                            _disable_streaming=True, _has_pending_redirect=lambda: False,
                            _interruptible_api_call=dispatch)
    monkeypatch.setattr("agent.relay_llm.execute", lambda request, callback, **kw: callback(request))
    monkeypatch.setattr("agent.relay_llm.execute_current", lambda request, callback, **kw: callback(request))
    monkeypatch.setattr("hermes_cli.middleware.run_llm_execution_middleware",
                        lambda request, callback, **kw: callback(request))

    with pytest.raises(InterruptedError) as stopped:
        if entry == "summary":
            managed_summary_call(agent, "summary-operation", {}, dispatch, retry_count=0)
        else:
            perform_api_call(agent, api_kwargs={}, _original_api_kwargs={}, _llm_middleware_trace=[],
                             _moa_prepared_request=None, _retry=None, thinking_spinner=None, retry_count=0,
                             api_call_count=0, api_request_id="primary-operation", effective_task_id="task",
                             turn_id="turn", interrupted=False)
    assert stopped.value is paused


def test_managed_pause_settles_interrupted_without_model_failure_and_can_continue(managed_gateway):
    from tui_gateway import server

    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid)
    session = server._sessions[sid]
    server._start_agent_build(sid, session)
    assert session["agent_ready"].wait(timeout=30)
    assert not session.get("agent_error")
    f.hold.set()
    result(f.call("prompt.submit", session_id=sid, text="Read sample.txt"))
    assert f.entered.wait(timeout=10)
    result(f.call("session.interrupt", session_id=sid))
    f.release.set()
    with server._sessions_lock:
        thread = session["_run_thread"]
    thread.join(timeout=10)
    assert not thread.is_alive()
    assert len(f.requests) == 1
    terminal = [event["params"]["payload"] for event in f.chat.events
                if event.get("params", {}).get("type") == "message.complete"][-1]
    assert terminal["status"] == "interrupted"
    assert not terminal.get("error_surface")
    assert not session["running"]

    f.hold.clear()
    f.submit(sid, "Continue the paused task without repeating completed work")
    terminal = [event["params"]["payload"] for event in f.chat.events
                if event.get("params", {}).get("type") == "message.complete"][-1]
    assert terminal["status"] == "complete"
    assert not terminal.get("error_surface")

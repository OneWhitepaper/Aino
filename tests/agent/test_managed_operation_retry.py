"""Managed ambiguous outcomes stop before any automatic replay or paid fallback."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import UUID

import httpx
import pytest

from agent.auxiliary_billing_scope import BillingScope, ManagedCredential
from agent.managed_inference_errors import ManagedOperationUnknown, managed_failure_result
from tests.agent.test_stream_retry_backoff import _bare_call, _agent
from tests.tui_gateway.test_managed_model_agent import managed_gateway as _managed_gateway

managed_gateway = _managed_gateway


def credential():
    return ManagedCredential(lambda: "fixture", "owner", "session", "model",
                             "https://aino.invalid/v1", "chat_completions", False,
                             scope=BillingScope("aino", "owner", "session", "turn", "chat"))


def status_error(status, code=None):
    error = RuntimeError("fixture refusal")
    error.status_code = status
    error.body = {"error": {"code": code}}
    return error


@pytest.mark.parametrize("error", [
    httpx.ReadError("accepted then response lost"), httpx.ReadTimeout("response lost"),
    httpx.WriteError("partial send"), httpx.RemoteProtocolError("stream dropped"),
    status_error(502), status_error(409, "DESKTOP_OPERATION_UNKNOWN"),
])
def test_managed_ambiguous_call_is_nonretryable_and_preserves_history(error):
    history = [{"role": "user", "content": "original"}, {"role": "tool", "content": "already executed"}]
    result = managed_failure_result(SimpleNamespace(api_key=credential()), error, history, 1)
    assert result["failure_reason"] == "managed_operation_unknown"
    assert result["failure_retryable"] is False
    assert result["messages"] is history
    assert not result["completed"]


@pytest.mark.parametrize("error", [httpx.ConnectError("not connected"), httpx.ConnectTimeout("not connected"),
                                  httpx.PoolTimeout("no connection acquired")])
def test_proven_presend_failure_keeps_existing_recovery(error):
    assert managed_failure_result(SimpleNamespace(api_key=credential()), error, [], 0) is None


def test_sdk_wrapped_local_authority_error_keeps_auth_reason():
    from agent.auxiliary_billing_scope import managed_operation_scope
    from agent.managed_inference_errors import managed_operation_error
    from openai import APIConnectionError

    request = httpx.Request("POST", "https://aino.invalid/v1/chat/completions", json={"model": "model"})
    error = APIConnectionError(request=request)
    error.__cause__ = RuntimeError("managed_model_identity_mismatch")
    with managed_operation_scope("logical"):
        credential().prepare_request(request)
        assert managed_operation_error(error, managed=True) is None
    result = managed_failure_result(SimpleNamespace(api_key=credential()), error, [], 0)
    assert result["failure_reason"] == "managed_credential_revoked"


@pytest.mark.parametrize("partial_tool", [False, True])
def test_managed_stream_drop_cannot_reconnect_or_probe(partial_tool):
    agent = _agent(api_key=credential())
    call = _bare_call(agent)
    call.deltas_were_sent["yes"] = partial_tool
    call.provider_tool_in_flight = {"yes": partial_tool}
    call._retry_after_drop = Mock()
    call._unmask_server_error_with_nonstreaming = Mock()
    assert call._handle_stream_error(httpx.ReadError("accepted then dropped"), 0, 2) is False
    assert managed_failure_result(agent, call.result["error"], [], 1)["failure_retryable"] is False
    call._retry_after_drop.assert_not_called()
    call._unmask_server_error_with_nonstreaming.assert_not_called()


def test_primary_operation_identity_survives_attempts_but_not_new_logical_call(monkeypatch):
    from agent.turn_api_call import perform_api_call

    key, requests = credential(), []
    agent = SimpleNamespace(api_key=key, api_mode="chat_completions", provider="aino", model="model",
                            session_id="session", platform="desktop", base_url=key.base_url,
                            is_subagent=False, _fallback_index=0, _disable_streaming=True,
                            _has_pending_redirect=lambda: False)

    def dispatch(kwargs):
        request = httpx.Request("POST", key.base_url + "/chat/completions", json={"model": "model"})
        key.prepare_request(request)
        requests.append(request)
        return "response"

    agent._interruptible_api_call = dispatch
    monkeypatch.setattr("agent.relay_llm.execute", lambda request, callback, **kw: callback(request))
    monkeypatch.setattr("hermes_cli.middleware.run_llm_execution_middleware",
                        lambda request, callback, **kw: callback(request))
    for logical in ("turn:api:0", "turn:api:0", "turn:api:1"):
        perform_api_call(agent, api_kwargs={}, _original_api_kwargs={}, _llm_middleware_trace=[],
                         _moa_prepared_request=None, _retry=None, thinking_spinner=None, retry_count=0,
                         api_call_count=0, api_request_id=logical, effective_task_id="task", turn_id="turn",
                         interrupted=False)
    operation_ids = [r.headers["x-aino-operation-id"] for r in requests]
    assert operation_ids[0] == operation_ids[1] != operation_ids[2]
    assert len({r.headers["x-aino-call-id"] for r in requests}) == 3
    for value in operation_ids:
        UUID(value)


@pytest.mark.parametrize("async_mode", [False, True])
def test_managed_auxiliary_accept_then_drop_executes_once(managed_gateway, monkeypatch, async_mode):
    from agent.auxiliary_client import call_llm, async_call_llm
    from tui_gateway.managed_session import runtime_for_session

    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid, context_window=256000)
    model, runtime = runtime_for_session(sid)
    accepted = []

    original_send = httpx.Client._send_single_request
    original_async_send = httpx.AsyncClient._send_single_request

    def accepted_then_drop(client, request):
        if request.url.path != "/v1/chat/completions":
            return original_send(client, request)
        accepted.append(dict(request.headers))
        raise httpx.ReadError("provider accepted then response was lost", request=request)

    async def async_accepted_then_drop(client, request):
        if request.url.path != "/v1/chat/completions":
            return await original_async_send(client, request)
        return accepted_then_drop(client, request)

    if async_mode:
        monkeypatch.setattr(httpx.AsyncClient, "_send_single_request", async_accepted_then_drop)
    else:
        monkeypatch.setattr(httpx.Client, "_send_single_request", accepted_then_drop)
    kwargs = dict(task="compression", main_runtime={**runtime, "model": model},
                  messages=[{"role": "user", "content": "fixture"}], timeout=3)
    with pytest.raises(Exception) as failure:
        if async_mode:
            asyncio.run(async_call_llm(**kwargs))
        else:
            call_llm(**kwargs)
    assert len(accepted) == 1
    UUID(accepted[0]["x-aino-operation-id"])
    assert "outcome" in str(failure.value).lower()


@pytest.mark.parametrize("code,reason", [("IDEMPOTENCY_KEY_CONFLICT", "managed_operation_conflict"),
                                       ("INVALID_DESKTOP_OPERATION", "managed_operation_invalid")])
def test_operation_refusals_do_not_retry_or_reject_device(code, reason):
    result = managed_failure_result(SimpleNamespace(api_key=credential()), status_error(409, code), [], 1)
    assert result["failure_reason"] == reason
    assert result["failure_retryable"] is False


def test_managed_empty_followup_keeps_tool_history_and_does_not_nudge():
    from agent.turn_empty_response import recover_empty_response

    messages = [{"role": "user", "content": "fixture"}, {"role": "tool", "content": "already executed"}]
    before = [dict(row) for row in messages]
    agent = SimpleNamespace(api_key=credential(), _has_content_after_think_block=lambda text: False)
    verdict = recover_empty_response(
        agent, SimpleNamespace(), None, "stop", final_response="", messages=messages, api_messages=[],
        conversation_history=[], active_system_prompt="stable", api_call_count=1, turn_exit_reason=None,
        preflight_compression_blocked=False)
    assert verdict.action == "return"
    assert verdict.result["failure_reason"] == "managed_operation_unknown"
    assert messages == before


def test_direct_image_call_has_stable_request_identity_and_new_explicit_call():
    from dataclasses import replace

    key = replace(credential(), api_mode="images_generations")
    requests = [httpx.Request("POST", key.base_url + "/images/generations", json={"model": "model"})
                for _ in range(2)]
    key.prepare_request(requests[0])
    operation = requests[0].headers["x-aino-operation-id"]
    call = requests[0].headers["x-aino-call-id"]
    key.prepare_request(requests[0])
    key.prepare_request(requests[1])
    assert requests[0].headers["x-aino-operation-id"] == operation
    assert requests[0].headers["x-aino-call-id"] != call
    assert requests[1].headers["x-aino-operation-id"] != operation


def test_managed_clean_eof_with_partial_content_is_unknown():
    call = _bare_call(_agent(api_key=credential()))
    call._assemble_tool_calls = Mock(return_value=(None, False))
    with pytest.raises(ManagedOperationUnknown):
        call._finish_chat_stream(None, "assistant", ["partial"], [], {}, None, "model", None,
                                 flush_pending=lambda: None)


def test_managed_stream_run_never_converts_unknown_to_continuation_stub():
    agent = _agent(api_key=credential())
    call = _bare_call(agent)
    call._resolve_stale_timeout = Mock()
    call._run_call = Mock()
    call._monitor_loop = Mock()
    call._monitor_interrupted = {"yes": False}
    call._abandon_error = None
    call.deltas_were_sent["yes"] = True
    call.result["error"] = ManagedOperationUnknown()
    call.result["response"] = None
    call._partial_stream_stub = Mock(return_value="unsafe continuation")
    with pytest.raises(ManagedOperationUnknown):
        call.run()
    call._partial_stream_stub.assert_not_called()


def test_managed_iteration_summary_empty_cannot_use_second_attempt(monkeypatch):
    from agent import chat_completion_helpers as cch

    calls = []
    agent = SimpleNamespace(api_key=credential(), max_iterations=1, suppress_status_output=True,
                            api_mode="chat_completions")

    def attempt(retry):
        calls.append(retry)
        return cch.summary_text(SimpleNamespace(
            api_key=credential(), _get_transport=lambda: SimpleNamespace(
                normalize_response=lambda response: SimpleNamespace(tool_calls=None, content=""))), None)

    monkeypatch.setattr(cch, "_iteration_summary_api_messages", lambda *args: [])
    monkeypatch.setattr(cch, "_chat_summary_attempt", lambda *args: attempt)
    with pytest.raises(ManagedOperationUnknown):
        cch.handle_max_iterations(agent, [], 1)
    assert calls == [0]


@pytest.mark.parametrize("drop_kind", ["transport", "clean_eof", "invalid_response"])
def test_partial_managed_stream_stops_full_turn_and_persists_unknown(managed_gateway, monkeypatch, drop_kind):
    from tui_gateway import server

    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid, context_window=256000)
    session = server._sessions[sid]
    server._start_agent_build(sid, session)
    assert session["agent_ready"].wait(timeout=20)
    accepted, partial = [], "The first result is available."

    class AcceptedStream(httpx.SyncByteStream):
        def __iter__(self):
            data = {"id": "accepted-operation", "object": "chat.completion.chunk", "created": 1,
                    "model": "fixture-upstream", "choices": [{"index": 0,
                        "delta": {"role": "assistant", "content": partial}, "finish_reason": None}]}
            yield ("data: " + json.dumps(data) + "\n\n").encode()
            if drop_kind == "transport":
                raise httpx.ReadError("upstream accepted, response lost")

    send = httpx.Client._send_single_request

    def dispatch(client, request):
        if request.url.path != "/v1/chat/completions":
            return send(client, request)
        accepted.append(request)
        if drop_kind == "invalid_response":
            return httpx.Response(200, json={"id": "invalid-response", "choices": []}, request=request)
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                              request=request, stream=AcceptedStream())

    monkeypatch.setattr(httpx.Client, "_send_single_request", dispatch)
    if drop_kind == "invalid_response":
        session["agent"]._disable_streaming = True
    f.submit(sid, "Inspect the fixture")
    assert len(accepted) == 1
    UUID(accepted[0].headers["x-aino-operation-id"])
    terminal = [e["params"]["payload"] for e in f.chat.events
                if e.get("params", {}).get("type") == "message.complete"][-1]
    assert terminal["status"] == "error"
    assert terminal.get("partial", False) is (drop_kind != "invalid_response")
    assert terminal["error_surface"]["code"] == "managed_operation_unknown"
    assert terminal["error_surface"]["retryable"] is False
    rows = f.db.get_messages(session["session_key"])
    if drop_kind != "invalid_response":
        assert partial in terminal["text"]
        assert partial in rows[-1]["content"]
    assert rows[-1]["display_metadata"]["error_surface"]["retryable"] is False


@pytest.mark.parametrize("async_mode", [False, True])
def test_managed_aux_stream_negotiation_cannot_reissue_plain_request(monkeypatch, async_mode):
    from agent import auxiliary_client as aux

    calls = []

    def dispatch(**kwargs):
        calls.append(kwargs)
        raise RuntimeError("response payload lost during stream negotiation")

    async def async_dispatch(**kwargs):
        return dispatch(**kwargs)

    client = SimpleNamespace(_hermes_aux_effective_provider="aino", chat=SimpleNamespace(
        completions=SimpleNamespace(create=async_dispatch if async_mode else dispatch)))
    monkeypatch.setattr(aux, "_aux_progress_active", lambda: True)
    with pytest.raises(RuntimeError):
        if async_mode:
            asyncio.run(aux._acreate_with_progress(client, {"model": "model"}, "compression"))
        else:
            aux._create_with_progress(client, {"model": "model"}, "compression")
    assert len(calls) == 1


@pytest.mark.parametrize("async_mode", [False, True])
def test_presend_aux_retry_reuses_operation_and_gets_new_call_id(managed_gateway, monkeypatch, async_mode):
    from agent import auxiliary_client as aux
    from tui_gateway.managed_session import runtime_for_session

    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid, context_window=256000)
    model, runtime = runtime_for_session(sid)
    attempts = []
    send, async_send = httpx.Client._send_single_request, httpx.AsyncClient._send_single_request

    def dispatch(client, request):
        if request.url.path == "/v1/chat/completions":
            attempts.append(dict(request.headers))
            if len(attempts) == 1:
                raise httpx.ConnectError("connection never established", request=request)
        return send(client, request)

    async def async_dispatch(client, request):
        if request.url.path == "/v1/chat/completions":
            attempts.append(dict(request.headers))
            if len(attempts) == 1:
                raise httpx.ConnectError("connection never established", request=request)
        return await async_send(client, request)

    monkeypatch.setattr(aux, "_TRANSIENT_RETRY_BACKOFF_BASE", 0)
    monkeypatch.setattr(httpx.AsyncClient if async_mode else httpx.Client, "_send_single_request",
                        async_dispatch if async_mode else dispatch)
    kwargs = dict(task="compression", main_runtime={**runtime, "model": model},
                  messages=[{"role": "user", "content": "fixture"}], timeout=3)
    response = asyncio.run(aux.async_call_llm(**kwargs)) if async_mode else aux.call_llm(**kwargs)
    assert response.choices[0].message.content
    assert len(attempts) == 2
    assert attempts[0]["x-aino-operation-id"] == attempts[1]["x-aino-operation-id"]
    assert attempts[0]["x-aino-call-id"] != attempts[1]["x-aino-call-id"]


def test_managed_anthropic_event_order_failure_does_not_reissue_create():
    from agent.anthropic_adapter import create_anthropic_message
    from agent.auxiliary_billing_scope import configure_managed_http, managed_operation_scope
    from tests.agent.test_anthropic_stream_fallbacks import _client

    key = credential()
    client, created = _client(RuntimeError('Unexpected event order, got content_block_delta before "message_start"'))
    kwargs = {}
    configure_managed_http(kwargs, key)
    client._client = kwargs["http_client"]
    request = httpx.Request("POST", key.base_url + "/chat/completions", json={"model": "model"})
    with managed_operation_scope("anthropic-operation"):
        key.prepare_request(request)
        with pytest.raises(ManagedOperationUnknown):
            create_anthropic_message(client, {"model": "model", "messages": [], "max_tokens": 8})
    assert not created
    client._client.close()


def test_managed_aux_clean_eof_cannot_turn_partial_summary_into_success():
    from agent.auxiliary_billing_scope import managed_operation_scope
    from agent.auxiliary_client import _ChatStreamAccumulator
    from tests.agent.test_aux_progress_streaming import _chunk

    key = credential()
    request = httpx.Request("POST", key.base_url + "/chat/completions", json={"model": "model"})
    with managed_operation_scope("summary-operation"):
        key.prepare_request(request)
        accumulator = _ChatStreamAccumulator()
        accumulator.feed(_chunk(content="partial summary", finish_reason=None))
        with pytest.raises(ManagedOperationUnknown):
            accumulator.finish()


@pytest.mark.parametrize("wrapped", [False, True])
def test_managed_codex_response_loss_before_first_event_cannot_reissue(wrapped):
    from agent.codex_runtime import run_codex_stream
    from openai import APIConnectionError

    key, accepted = credential(), []

    def create(**kwargs):
        request = httpx.Request("POST", key.base_url + "/responses", json={"model": "model"})
        key.prepare_request(request)
        accepted.append(request)
        error = httpx.ReadError("accepted response lost", request=request)
        if wrapped:
            outer = APIConnectionError(request=request)
            outer.__cause__ = error
            raise outer
        raise error

    agent = SimpleNamespace(api_key=key, _interrupt_requested=False, _current_api_request_id="logical",
                            _fallback_index=0, is_subagent=False, model="model", provider="aino", session_id="",
                            _client_log_context=lambda: "", _buffer_diagnostic_status=lambda message: None)
    with pytest.raises(ManagedOperationUnknown):
        run_codex_stream(agent, {"model": "model"}, client=SimpleNamespace(responses=SimpleNamespace(create=create)))
    assert len(accepted) == 1


def test_managed_codex_partial_content_without_terminal_is_unknown():
    from agent.auxiliary_billing_scope import managed_operation_scope
    from agent.codex_runtime import _consume_codex_event_stream

    key = credential()
    request = httpx.Request("POST", key.base_url + "/responses", json={"model": "model"})
    event = SimpleNamespace(type="response.output_item.done", item=SimpleNamespace(
        type="message", status="completed", content=[SimpleNamespace(type="output_text", text="partial")]))
    with managed_operation_scope("codex-partial"):
        key.prepare_request(request)
        with pytest.raises(ManagedOperationUnknown):
            _consume_codex_event_stream(iter([event]), model="model")

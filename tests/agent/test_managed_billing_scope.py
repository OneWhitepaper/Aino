"""Exercise actual auxiliary resolution with session-bound credentials."""

import pytest
from uuid import UUID, uuid4
import asyncio

from tests.tui_gateway.test_managed_model_agent import managed_gateway  # noqa: F401
from tui_gateway.managed_session import runtime_for_session


@pytest.mark.parametrize("task", ["title_generation", "compression"])
@pytest.mark.parametrize("protocol", ["chat_completions", "responses", "anthropic_messages"])
@pytest.mark.parametrize("async_mode", [False, True])
def test_managed_auxiliary_inherits_exact_live_runtime(managed_gateway, task, protocol, async_mode):
    from agent.auxiliary_client import call_llm, async_call_llm
    from agent.auxiliary_billing_scope import BillingScope, billing_scope

    f = managed_gateway
    f.protocol = protocol
    sid = f.create()["session_id"]
    f.bind(sid)
    model, runtime = runtime_for_session(sid)
    for _ in range(2):
        turn = str(uuid4())
        token = billing_scope.set(BillingScope("aino", "user-one", runtime["api_key"].session_id, turn, "chat"))
        try:
            kwargs = dict(task=task, main_runtime={**runtime, "model": model},
                          messages=[{"role": "user", "content": "fixture"}], max_tokens=32, timeout=3)
            if async_mode:
                asyncio.run(async_call_llm(**kwargs))
            else:
                call_llm(**kwargs)
        finally:
            billing_scope.reset(token)
        headers = {k.lower(): v for k, v in f.request_headers[-1].items()}
        assert headers["x-aino-turn-id"] == turn
    assert f.requests[-1][1] == "Bearer fixture-secret-one"
    assert f.requests[-1][2]["model"] == "fixture-upstream"
    headers = {k.lower(): v for k, v in f.request_headers[-1].items()}
    UUID(headers["x-aino-session-id"])
    assert headers["x-aino-purpose"] == {"title_generation": "title", "compression": "compression"}[task]
    assert "x-aino-task" not in headers


def test_auxiliary_receipts_preserve_detail_with_legacy_compatible_purpose(managed_gateway):
    from agent.auxiliary_client import call_llm
    from agent.auxiliary_billing_scope import BillingScope, billing_scope

    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid, vision=True)
    model, runtime = runtime_for_session(sid)
    cases = [(task, "other_auxiliary", task) for task in (
        "session_summary", "approval", "mcp", "tts_audio_tags", "side_question")]
    cases += [("chat", "chat", None), ("title_generation", "title", None),
              ("compression", "compression", None), ("vision", "vision", None),
              ("delegation", "delegation", None), ("unknown-task", "other_auxiliary", None)]
    scope = BillingScope("aino", "user-one", runtime["api_key"].session_id, str(uuid4()), "chat")
    token = billing_scope.set(scope)
    try:
        for task, purpose, detail in cases:
            response = call_llm(task=task, main_runtime={**runtime, "model": model},
                               messages=[{"role": "user", "content": "fixture"}], timeout=3,
                               extra_headers={"X-Aino-Task": "stale-task"})
            assert response.choices[0].message.content
            headers = {k.lower(): v for k, v in f.request_headers[-1].items()}
            # Older servers accept the six original purposes and ignore the new header.
            assert headers["x-aino-purpose"] == purpose
            assert headers.get("x-aino-task") == detail
            assert scope.calls.snapshot()["calls"][-1] == {
                "call_id": headers["x-aino-call-id"], "purpose": detail or purpose}
    finally:
        billing_scope.reset(token)


def test_side_question_fork_is_correlated_without_changing_parent_runtime(managed_gateway):
    from agent.auxiliary_billing_scope import BillingScope, billing_scope
    from agent.side_question import _answer_via_fork
    from tui_gateway import server as srv

    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid)
    f.submit(sid, "Read the fixture file")
    session = srv._sessions[sid]
    parent = session["agent"]
    credential = parent.api_key
    scope = BillingScope("aino", credential.user_id, credential.session_id, str(uuid4()), "chat")
    token = billing_scope.set(scope)
    start = len(f.request_headers)
    try:
        assert _answer_via_fork(parent, "What did you read?", session["history"])
    finally:
        billing_scope.reset(token)
    assert parent.api_key is credential and credential.scope is None
    assert len(f.request_headers) > start
    for raw_headers in f.request_headers[start:]:
        headers = {k.lower(): v for k, v in raw_headers.items()}
        assert headers["x-aino-purpose"] == "other_auxiliary"
        assert headers["x-aino-task"] == "side_question"
        assert headers["x-aino-turn-id"] == scope.turn_id
        assert {"call_id": headers["x-aino-call-id"], "purpose": "side_question"} in scope.calls.snapshot()["calls"]


@pytest.mark.parametrize("status", [401, 402])
def test_managed_aux_failure_cannot_spend_byok_fallback(managed_gateway, tmp_path, status):
    import yaml
    from agent.auxiliary_client import call_llm

    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid)
    model, runtime = runtime_for_session(sid)
    config = yaml.safe_load((tmp_path / "config.yaml").read_text())
    config["auxiliary"]["compression"] = {"fallback_chain": [{"provider": "custom:fixture-byok"}]}
    (tmp_path / "config.yaml").write_text(yaml.safe_dump(config))
    f.response_status["Bearer fixture-secret-one"] = status
    with pytest.raises(Exception) as error:
        call_llm(task="compression", main_runtime={**runtime, "model": model},
                 messages=[{"role": "user", "content": "fixture"}], timeout=3)
    assert getattr(error.value, "status_code", None) == status
    assert [r[1] for r in f.requests] == ["Bearer fixture-secret-one"]


def test_explicit_byok_override_never_uses_managed_key(managed_gateway, tmp_path):
    import yaml
    from agent.auxiliary_client import call_llm
    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid)
    model, runtime = runtime_for_session(sid)
    config = yaml.safe_load((tmp_path / "config.yaml").read_text())
    config["auxiliary"]["compression"] = {"provider": "custom:fixture-byok"}
    (tmp_path / "config.yaml").write_text(yaml.safe_dump(config))
    call_llm(task="compression", main_runtime={**runtime, "model": model},
             messages=[{"role": "user", "content": "fixture"}], timeout=3)
    assert f.requests[-1][1] == "Bearer byok-fixture-key"
    assert not any(k.lower().startswith("x-aino-") for k in f.request_headers[-1])
    assert any(e.get("params", {}).get("payload", {}).get("billing_source") == "custom:fixture-byok"
               for e in f.chat.events)


def test_missing_custom_override_cannot_discover_an_unrelated_provider(managed_gateway, monkeypatch):
    from agent.auxiliary_client import resolve_provider_client
    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid)
    model, runtime = runtime_for_session(sid)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "fixture-unrelated-provider")
    client, _ = resolve_provider_client("custom", model="fixture-model", task="compression",
                                        main_runtime={**runtime, "model": model})
    assert client is None
    assert not f.requests


def test_concurrent_vision_calls_keep_their_account_and_turn(managed_gateway):
    from concurrent.futures import ThreadPoolExecutor
    from agent.auxiliary_client import call_llm, scoped_runtime_main
    from agent.auxiliary_billing_scope import BillingScope, billing_scope
    f = managed_gateway
    pairs = []
    for owner in ("one", "two"):
        sid = f.create()["session_id"]
        f.bind(sid, owner_id=owner, key="fixture-" + owner, vision=True)
        model, runtime = runtime_for_session(sid)
        scope = BillingScope("aino", owner, runtime["api_key"].session_id, str(uuid4()), "chat")
        pairs.append((runtime, model, scope))
    def invoke(pair):
        runtime, model, scope = pair
        token = billing_scope.set(scope)
        try:
            with scoped_runtime_main({**runtime, "model": model}):
                call_llm(task="vision", messages=[{"role": "user", "content": "fixture image"}], timeout=3)
        finally:
            billing_scope.reset(token)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(invoke, pairs))
    for raw in f.request_headers:
        h = {k.lower(): v for k, v in raw.items()}
        pair = next(pair for pair in pairs if "Bearer fixture-" + pair[2].user_id == h["authorization"])
        assert h["x-aino-session-id"] == pair[2].session_id
        assert h["x-aino-turn-id"] == pair[2].turn_id
        assert h["x-aino-purpose"] == "vision"


def test_compression_stall_pin_cannot_switch_billing_source(managed_gateway):
    import time
    from agent.context_compressor import pin_summary_route
    from tui_gateway import server as srv
    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid)
    srv._start_agent_build(sid, srv._sessions[sid])
    assert srv._sessions[sid]["agent_ready"].wait(20)
    compressor = srv._sessions[sid]["agent"].context_compressor
    with pin_summary_route({"provider": "custom:fixture-byok"}):
        assert compressor._call_summary_llm("Summarize fixture", time.monotonic())
    assert {r[1] for r in f.requests} == {"Bearer fixture-secret-one"}


@pytest.mark.parametrize("vision", [False, True])
def test_lease_rejects_ungranted_vision_or_a_changed_wire_model(managed_gateway, vision):
    from agent.auxiliary_client import resolve_provider_client
    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid, vision=vision)
    model, runtime = runtime_for_session(sid)
    if not vision:
        with pytest.raises(RuntimeError, match="vision_unsupported"):
            resolve_provider_client("auto", main_runtime={**runtime, "model": model}, is_vision=True)
    else:
        client, _ = resolve_provider_client("auto", main_runtime={**runtime, "model": model}, task="compression")
        with pytest.raises(Exception):
            client.chat.completions.create(model="not-in-this-lease", messages=[{"role": "user", "content": "fixture"}])
    assert not f.requests


def test_byok_chat_and_compression_ignore_another_live_platform_session(managed_gateway):
    import time
    from tests.tui_gateway.test_managed_model_agent import result
    from tui_gateway import server as srv
    f = managed_gateway
    platform_sid = f.create()["session_id"]
    f.bind(platform_sid)
    sid = f.create()["session_id"]
    result(f.call("config.set", session_id=sid, key="model",
                  value="fixture-byok-model --provider custom:fixture-byok --session"))
    f.submit(sid, "Read the fixture file")
    assert srv._sessions[sid]["agent"].context_compressor._call_summary_llm("Summarize", time.monotonic())
    assert {r[1] for r in f.requests} == {"Bearer byok-fixture-key"}
    assert all(not any(k.lower().startswith("x-aino-") for k in h) for h in f.request_headers)

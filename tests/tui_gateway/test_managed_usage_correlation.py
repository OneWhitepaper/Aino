"""Billing metadata travels on the real wire, never in the conversation."""

from uuid import UUID

import pytest

from tests.tui_gateway.test_managed_model_agent import managed_gateway  # noqa: F401


@pytest.mark.parametrize("protocol", ["chat_completions", "responses", "anthropic_messages"])
def test_managed_tool_rounds_share_turn_but_not_request_ids(managed_gateway, protocol):
    f = managed_gateway
    f.protocol = protocol
    sid = f.create()["session_id"]
    f.bind(sid)
    f.submit(sid, "Read the fixture file")
    first_turn = list(f.request_headers)
    assert len(first_turn) >= 2
    headers = [{k.lower(): v for k, v in h.items()} for h in first_turn]
    assert len({h.get("x-aino-session-id") for h in headers}) == 1
    UUID(headers[0]["x-aino-session-id"])
    assert len({h["x-aino-turn-id"] for h in headers}) == 1
    assert len({h["x-aino-call-id"] for h in headers}) == len(headers)
    assert {h["x-aino-purpose"] for h in headers} == {"chat"}
    for h in headers:
        UUID(h["x-aino-turn-id"])
        UUID(h["x-aino-call-id"])
    f.submit(sid, "Continue")
    second = {k.lower(): v for k, v in f.request_headers[-1].items()}
    assert second["x-aino-turn-id"] != headers[0]["x-aino-turn-id"]
    for _, _, body in f.requests:
        assert headers[0]["x-aino-turn-id"] not in str(body)
    completed = [e["params"]["payload"] for e in f.chat.events
                 if e.get("params", {}).get("type") == "message.complete"]
    assert completed[-1]["turn_metrics"]["billing"]["turn_id"] == second["x-aino-turn-id"]
    billing = completed[0]["turn_metrics"]["billing"]
    assert {call["call_id"] for call in billing["calls"]} == {h["x-aino-call-id"] for h in headers}
    assert billing["calls_complete"] is True
    assert billing["status"] == "pending"  # HTTP completion is not a ledger receipt.
    from tui_gateway import server
    with server._session_db(server._sessions[sid]) as db:
        messages = db.get_messages_as_conversation(server._sessions[sid]["session_key"])
    persisted = [m["display_metadata"]["turn_metrics"]["billing"] for m in messages
                 if m.get("display_metadata", {}).get("turn_metrics", {}).get("billing")]
    assert persisted[0]["calls"] == billing["calls"]


def test_custom_reply_persists_its_source_without_relabeling_managed_history(managed_gateway):
    from tui_gateway import server

    f = managed_gateway
    draft = f.create()
    sid = draft["session_id"]
    f.bind(sid)
    f.submit(sid, "Use the managed model")

    value = "fixture-byok-model --provider custom:fixture-byok --session"
    result = f.call(
        "config.set", session_id=sid, key="model", value=value, confirm_expensive_model=True)
    assert "error" not in result
    f.submit(sid, "Use my custom provider")

    completed = [e["params"]["payload"] for e in f.chat.events
                 if e.get("params", {}).get("type") == "message.complete"]
    managed, custom = completed[-2:]
    assert managed["turn_metrics"]["billing"]["source"] == "aino"
    assert "billing_source" not in managed["turn_metrics"]
    assert custom["turn_metrics"]["non_aino_model_calls"] is True
    assert "billing" not in custom["turn_metrics"]

    selection = dict(session_id=sid, key="model", value="fixture-a", model_source="aino")
    confirmation = f.call("config.set", **selection)
    assert confirmation["result"]["confirm_required"] is True
    assert "error" not in f.call("config.set", **selection, confirm_expensive_model=True)
    f.bind(sid)

    with server._session_db(server._sessions[sid]) as db:
        messages = db.get_messages_as_conversation(server._sessions[sid]["session_key"])
    metrics = [m["display_metadata"]["turn_metrics"] for m in messages
               if m.get("display_metadata", {}).get("turn_metrics")]
    assert metrics[-2]["billing"]["source"] == "aino"
    assert "billing_source" not in metrics[-2]
    assert metrics[-1]["non_aino_model_calls"] is True
    assert "billing" not in metrics[-1]


def test_managed_reply_keeps_aino_settlement_and_persists_explicit_external_title_call(
        managed_gateway, tmp_path, monkeypatch):
    import threading
    import yaml
    import agent.title_generator as titles
    from tui_gateway import server

    f = managed_gateway
    config = yaml.safe_load((tmp_path / "config.yaml").read_text())
    config["auxiliary"]["title_generation"] = {
        "enabled": True,
        "provider": "custom:fixture-byok",
        "model": "fixture-byok-model",
    }
    (tmp_path / "config.yaml").write_text(yaml.safe_dump(config))
    release, finished = threading.Event(), threading.Event()
    original = titles.auto_title_session

    def delayed(*args, **kwargs):
        try:
            assert release.wait(timeout=10)
            original(*args, **kwargs)
        finally:
            finished.set()

    monkeypatch.setattr(titles, "auto_title_session", delayed)
    sid = f.create()["session_id"]
    f.bind(sid)
    try:
        f.submit(sid, "Explain the fixture with an external title")
        completed = [event["params"]["payload"] for event in f.chat.events
                     if event.get("params", {}).get("type") == "message.complete"]
        initial = completed[-1]["turn_metrics"]
        assert initial["billing"]["source"] == "aino"
        assert "non_aino_model_calls" not in initial

        release.set()
        with f.request_condition:
            assert f.request_condition.wait_for(
                lambda: any(auth == "Bearer byok-fixture-key" for _, auth, _ in f.requests), timeout=10)
        with f.chat.condition:
            assert f.chat.condition.wait_for(lambda: any(
                event.get("params", {}).get("payload", {}).get("reply_non_aino_model_calls") is True
                for event in f.chat.events), timeout=10)
        late_updates = [
            event["params"]["payload"] for event in f.chat.events
            if event.get("params", {}).get("type") == "session.usage"
            and event.get("params", {}).get("payload", {}).get("reply_non_aino_model_calls") is True
        ]
        with server._session_db(server._sessions[sid]) as db:
            messages = db.get_messages_as_conversation(server._sessions[sid]["session_key"])
        metrics = next(
            message["display_metadata"]["turn_metrics"] for message in reversed(messages)
            if message.get("display_metadata", {}).get("turn_metrics"))

        assert metrics["billing"]["source"] == "aino"
        assert {call["purpose"] for call in metrics["billing"]["calls"]} == {"chat"}
        assert metrics["non_aino_model_calls"] is True
        assert late_updates[-1]["reply_billing"]["turn_id"] == metrics["billing"]["turn_id"]
    finally:
        release.set()
        finished.wait(timeout=10)


def test_late_title_updates_original_reply_not_next_identical_reply(managed_gateway, tmp_path, monkeypatch):
    import threading
    import yaml
    import agent.title_generator as titles
    from tui_gateway import server
    f = managed_gateway
    config = yaml.safe_load((tmp_path / "config.yaml").read_text())
    config["auxiliary"]["title_generation"]["enabled"] = True
    (tmp_path / "config.yaml").write_text(yaml.safe_dump(config))
    release, finished = threading.Event(), threading.Event()
    original = titles.auto_title_session

    def delayed(*args, **kwargs):
        try:
            assert release.wait(timeout=10)
            original(*args, **kwargs)
        finally:
            finished.set()

    monkeypatch.setattr(titles, "auto_title_session", delayed)
    sid = f.create()["session_id"]
    f.bind(sid)
    try:
        f.submit(sid, "Read the fixture file and explain it")
        completed = [e["params"]["payload"] for e in f.chat.events
                     if e.get("params", {}).get("type") == "message.complete"]
        first = completed[-1]["turn_metrics"]["billing"]
        assert first["calls_complete"] is False
        # Keep the second turn free of its own title upgrade, which upstream may
        # retry while the first turn's derived title is still provisional.
        monkeypatch.setattr(titles, "maybe_auto_title", lambda *args, **kwargs: None)
        f.submit(sid, "Continue")
        release.set()
        assert finished.wait(timeout=10)
        with f.chat.condition:
            assert f.chat.condition.wait_for(lambda: any(
                e.get("params", {}).get("payload", {}).get("reply_billing", {}).get("calls_complete")
                for e in f.chat.events), timeout=10)
        with server._session_db(server._sessions[sid]) as db:
            messages = db.get_messages_as_conversation(server._sessions[sid]["session_key"])
        bills = [m["display_metadata"]["turn_metrics"]["billing"] for m in messages
                 if m.get("display_metadata", {}).get("turn_metrics", {}).get("billing")]
        assert bills[0]["turn_id"] == first["turn_id"]
        assert bills[0]["calls_complete"] is True
        assert {call["purpose"] for call in bills[0]["calls"]} == {"chat", "title"}
        assert {call["purpose"] for call in bills[1]["calls"]} == {"chat"}
    finally:
        release.set()
        finished.wait(timeout=10)


def test_background_title_has_the_original_turn_scope(managed_gateway, tmp_path):
    import yaml
    f = managed_gateway
    config = yaml.safe_load((tmp_path / "config.yaml").read_text())
    config["auxiliary"]["title_generation"]["enabled"] = True
    (tmp_path / "config.yaml").write_text(yaml.safe_dump(config))
    sid = f.create()["session_id"]
    f.bind(sid)
    f.submit(sid, "Read the fixture file and explain it")
    with f.request_condition:
        assert f.request_condition.wait_for(lambda: any(
            h.get("X-Aino-Purpose") == "title" for h in f.request_headers), timeout=10)
    headers = [{k.lower(): v for k, v in h.items()} for h in f.request_headers]
    assert {h["x-aino-purpose"] for h in headers} == {"chat", "title"}
    assert len({h["x-aino-turn-id"] for h in headers}) == 1


@pytest.mark.parametrize("status,reason", [(401, "managed_upstream_auth_failed"),
    (402, "managed_balance_unavailable"),
    ((401, "DESKTOP_CREDENTIAL_EXPIRED"), "managed_credential_expired"),
    ((401, "DESKTOP_CREDENTIAL_REVOKED"), "managed_credential_revoked"),
    ((403, "INSUFFICIENT_BALANCE"), "managed_balance_unavailable"),
    ((403, "SUBSCRIPTION_NOT_FOUND"), "managed_balance_unavailable"),
    ((429, "USAGE_LIMIT_EXCEEDED"), "managed_balance_unavailable")])
def test_managed_refusals_are_not_replayed_or_sent_to_byok(managed_gateway, status, reason):
    f = managed_gateway
    sid = f.create()["session_id"]
    f.bind(sid)
    f.response_status["Bearer fixture-secret-one"] = status
    f.submit(sid, "Keep this draft when refused")
    completed = [e["params"]["payload"] for e in f.chat.events
                 if e.get("params", {}).get("type") == "message.complete"]
    assert completed[-1]["status"] == "error"
    assert completed[-1]["error_surface"]["code"] == reason
    assert len(f.requests) == 1
    assert not any(r[1] == "Bearer byok-fixture-key" for r in f.requests)


@pytest.mark.parametrize("protocol", ["chat_completions", "anthropic_messages", "responses"])
@pytest.mark.parametrize("named_profile", [False, True])
def test_billing_identity_survives_compression_resume_but_not_a_branch(
        managed_gateway, tmp_path, named_profile, protocol):
    import json
    import yaml
    from agent.context_compressor import is_compaction_summary_message
    from hermes_cli.profiles import get_profile_dir
    from tests.tui_gateway.test_managed_model_agent import result
    from tui_gateway import server as srv

    f = managed_gateway

    def normalize_headers(headers):
        return {key.lower(): value for key, value in headers.items()}

    config_path = tmp_path / "config.yaml"
    config = yaml.safe_load(config_path.read_text())
    config.setdefault("compression", {})["in_place"] = False
    config_path.write_text(yaml.safe_dump(config))
    f.protocol = protocol
    if named_profile:
        f.profile = "billing-fixture"
        profile = get_profile_dir(f.profile)
        assert profile.is_relative_to(tmp_path)
        profile.mkdir(parents=True)
        (profile / "config.yaml").write_text(config_path.read_text())

    draft = f.create()
    sid, parent = draft["session_id"], draft["stored_session_id"]
    f.bind(sid)
    compressible_context = "retain this compression probe context " * 700
    for prompt in ("Read the fixture file", "Explain its contents: " + compressible_context,
                   "Check it once more"):
        f.submit(sid, prompt)

    with srv._sessions[sid]["history_lock"]:
        pre_compression_history = list(srv._sessions[sid]["history"])
    captured_before_compression = len(f.requests)
    captured = [
        (normalize_headers(headers), body)
        for headers, (_, _, body) in zip(f.request_headers, f.requests)
    ]
    baseline_headers, _ = next(
        (headers, body) for headers, body in captured
        if headers.get("x-aino-purpose") == "chat"
    )
    billing_session_id = baseline_headers["x-aino-session-id"]
    baseline_turn_id = baseline_headers["x-aino-turn-id"]
    baseline_call_id = baseline_headers["x-aino-call-id"]

    compressed = result(f.call("session.compress", session_id=sid))
    assert compressed["status"] == "compressed"
    tip = srv._sessions[sid]["session_key"]
    assert tip != parent
    with srv._session_db(srv._sessions[sid]) as db:
        assert db.get_session(parent)["end_reason"] == "compression"
        assert db.get_compression_lineage(tip) == [parent, tip]
    with srv._sessions[sid]["history_lock"]:
        compressed_history = list(srv._sessions[sid]["history"])
    assert len(compressed_history) < len(pre_compression_history)
    assert any(is_compaction_summary_message(message) for message in compressed_history)

    compression_headers = [
        headers for headers in map(normalize_headers, f.request_headers[captured_before_compression:])
        if headers.get("x-aino-purpose") == "compression"
    ]
    assert compression_headers
    compression = compression_headers[0]
    assert compression["x-aino-session-id"] == billing_session_id
    assert compression["x-aino-turn-id"]
    assert compression["x-aino-call-id"]
    assert compression["x-aino-turn-id"] != baseline_turn_id
    assert compression["x-aino-call-id"] != baseline_call_id

    result(f.call("session.close", session_id=sid))
    resumed = result(f.call("session.resume", session_id=tip, source="desktop"))
    resumed_sid = resumed["session_id"]
    f.sessions.append(resumed_sid)
    with srv._sessions[resumed_sid]["history_lock"]:
        restored_history = list(srv._sessions[resumed_sid]["history"])
    assert len(restored_history) < len(pre_compression_history)
    assert any(is_compaction_summary_message(message) for message in restored_history)

    f.bind(resumed_sid)
    resumed_start = len(f.requests)
    f.submit(resumed_sid, "Continue from the compacted handoff")
    resumed_requests = [
        (headers, body)
        for headers, (_, _, body) in zip(
            map(normalize_headers, f.request_headers[resumed_start:]), f.requests[resumed_start:])
        if headers.get("x-aino-purpose") == "chat"
    ]
    resumed_handoff = next((
        (headers, body) for headers, body in resumed_requests
        if "CONTEXT COMPACTION" in json.dumps(body)
    ), None)
    assert resumed_handoff is not None
    resumed_headers, resumed_body = resumed_handoff
    assert resumed_headers["x-aino-session-id"] == billing_session_id
    assert resumed_headers["x-aino-turn-id"]
    assert resumed_headers["x-aino-turn-id"] not in {
        baseline_turn_id, compression["x-aino-turn-id"]}
    assert resumed_headers["x-aino-call-id"]
    assert resumed_headers["x-aino-call-id"] not in {
        baseline_call_id, compression["x-aino-call-id"]}
    assert "CONTEXT COMPACTION" in json.dumps(resumed_body)

    branch = result(f.call("session.branch", session_id=resumed_sid, name="separate billing"))
    branch_sid = branch["session_id"]
    f.sessions.append(branch_sid)
    f.bind(branch_sid)
    branch_start = len(f.requests)
    f.submit(branch_sid, "Read this branch independently")
    branch_headers = next(
        headers for headers in map(normalize_headers, f.request_headers[branch_start:])
        if headers.get("x-aino-purpose") == "chat"
    )
    assert branch_headers["x-aino-session-id"] != billing_session_id
    assert branch_headers["x-aino-turn-id"]
    assert branch_headers["x-aino-turn-id"] not in {
        baseline_turn_id, compression["x-aino-turn-id"], resumed_headers["x-aino-turn-id"]}
    assert branch_headers["x-aino-call-id"]
    assert branch_headers["x-aino-call-id"] not in {
        baseline_call_id, compression["x-aino-call-id"], resumed_headers["x-aino-call-id"]}

"""Summary inference inherits live transport/model authority, not profile credentials."""
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

from hermes_state import SessionDB
from tui_gateway import server as srv
from tui_gateway.managed_model_runtime import ManagedModelBinding, ManagedModelOwner, get_registry


@pytest.fixture
def summary_rpc(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr("hermes_state.DEFAULT_DB_PATH", tmp_path / "state.db")
    db = SessionDB(tmp_path / "state.db")
    db.create_session("stored-summary", "gui")
    first = db.append_message("stored-summary", "user", "Implement a separate cited session summary. " * 25)
    db.append_message("stored-summary", "assistant", "The history reader is implemented and verified. " * 25)
    requests = []
    request_hooks = []

    class Model(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append((body, dict(self.headers)))
            for hook in request_hooks:
                hook()
            summary = {"objective": {"text": "Implement a cited summary.", "message_ids": [first]},
                       "completed": [], "conclusions": [], "open_questions": []}
            payload = json.dumps({"id": "fixture", "object": "chat.completion", "created": 1,
                "model": body["model"], "choices": [{"index": 0, "finish_reason": "stop",
                "message": {"role": "assistant", "content": json.dumps(summary)}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    http = ThreadingHTTPServer(("127.0.0.1", 0), Model)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    origin = f"http://127.0.0.1:{http.server_port}"
    config = {"model": {"provider": "fixture", "default": "profile-must-not-run"},
              "custom_providers": [{"name": "fixture", "base_url": origin + "/v1", "api_key": "profile-key"}],
              "auxiliary": {"session_summary": {"provider": "auto", "timeout": 5}}}
    (tmp_path / "config.yaml").write_text(json.dumps(config))

    class Peer:
        auth_identity = {"provider": "fixture", "user_id": "gateway-owner"}
        def __init__(self):
            self.condition = threading.Condition()
            self.events = []
        def write(self, value):
            with self.condition:
                self.events.append(value)
                self.condition.notify_all()
            return True

    peer = Peer()
    agent = SimpleNamespace(model="temporary-session-model", provider="custom", base_url=origin + "/v1",
                            api_key="session-key", api_mode="chat_completions")
    session = {"session_key": "stored-summary", "transport": peer, "viewers": {},
               "agent": agent, "history_lock": threading.RLock(), "running": False}
    monkeypatch.setattr(srv, "_sessions", {"live-summary": session})
    monkeypatch.setattr(srv, "_get_db", lambda: db)
    counter = 0

    def call(transport=peer, **params):
        nonlocal counter
        counter += 1
        rid = counter
        response = srv.dispatch({"id": rid, "method": "session.summary", "params": {
            "session_id": "live-summary", "language": "en", **params}}, transport)
        if response is not None:
            return response
        with transport.condition:
            assert transport.condition.wait_for(lambda: any(e.get("id") == rid for e in transport.events), timeout=10)
            return next(e for e in transport.events if e.get("id") == rid)

    yield SimpleNamespace(db=db, peer=peer, Peer=Peer, session=session, agent=agent, call=call,
                          requests=requests, config=config, path=tmp_path / "config.yaml", origin=origin,
                          request_hooks=request_hooks)
    get_registry().clear_session("live-summary")
    http.shutdown()
    http.server_close()
    thread.join(5)
    db.close()


def test_summary_uses_temporary_session_model_and_rejects_foreign_transport(summary_rpc, monkeypatch):
    rig = summary_rpc
    from hermes_cli.web_session_summary import session_summary
    refusal = session_summary("stored-summary", language="en", generate=True)
    assert refusal["error_code"] == "runtime_required" and not rig.requests
    before = rig.db.get_messages("stored-summary", include_inactive=True)
    result = rig.call()
    assert result.get("result", {}).get("summary"), result
    body, headers = rig.requests[0]
    assert body["model"] == rig.agent.model
    assert headers["Authorization"] == "Bearer session-key"
    assert rig.db.get_messages("stored-summary", include_inactive=True) == before
    foreign = rig.call(rig.Peer(), language="ja")
    assert foreign["error"]["code"] == 4001 and len(rig.requests) == 1
    # A lazy history resume resolves its stored selection without constructing an agent.
    rig.session["agent"] = None
    rig.session["resume_runtime_overrides"] = {
        "model_override": {"model": "historical-session-model", "provider": "fixture"},
        "provider_override": "fixture"}
    assert rig.call(language="zh")["result"]["summary"]
    assert rig.requests[-1][0]["model"] == "historical-session-model"
    assert rig.session["agent"] is None
    # An independent auxiliary selection remains explicit and uses its own key.
    rig.config["auxiliary"]["session_summary"].update(provider="fixture", model="independent-summary")
    rig.path.write_text(json.dumps(rig.config))
    assert rig.call(language="ja")["result"]["summary"]
    assert rig.requests[-1][0]["model"] == "independent-summary"
    assert rig.requests[-1][1]["Authorization"] == "Bearer profile-key"
    def unavailable(*args):
        raise RuntimeError("main provider disconnected")
    monkeypatch.setattr(srv, "_resolve_agent_model_runtime", unavailable)
    assert rig.call(language="zh-hant")["result"]["summary"]
    assert rig.requests[-1][0]["model"] == "independent-summary"


def test_summary_managed_model_uses_authorized_lease_and_billing_headers(summary_rpc):
    rig = summary_rpc
    registry = get_registry()
    owner = ManagedModelOwner(rig.origin, "platform-owner")
    rig.session["managed_model_params"] = {"model_source": "aino", "model_id": "fixture-model"}
    ticket = registry.issue("live-summary", rig.session, rig.peer, owner, "fixture-model")
    revision = registry.claim("live-summary", rig.session, rig.peer, ticket, owner, "fixture-model")
    binding = ManagedModelBinding("live-summary", owner, "fixture-model", "managed-session-model",
        "chat_completions", {}, "credential", "managed-secret", rig.origin + "/v1",
        datetime.now(timezone.utc) + timedelta(minutes=5), revision)
    registry.bind(binding, rig.session, rig.peer)
    result = rig.call()
    assert result.get("result", {}).get("summary"), result
    body, headers = rig.requests[0]
    assert body["model"] == binding.model and headers["Authorization"] == "Bearer managed-secret"
    assert headers["X-Aino-Purpose"] == "other_auxiliary"
    assert headers["X-Aino-Task"] == "session_summary"
    assert headers["X-Aino-Session-Id"] and headers["X-Aino-Turn-Id"] and headers["X-Aino-Call-Id"]
    usage = rig.db._read_one("SELECT billing_provider, input_tokens, output_tokens FROM session_model_usage WHERE task=?",
                            ("session_summary",))
    assert tuple(usage) == ("aino", 10, 5)
    registry.clear_session("live-summary")
    missing = rig.call(language="ja")
    assert missing["error"]["code"] == 4006 and len(rig.requests) == 1


@pytest.mark.parametrize("transport_fails", [False, True])
def test_foreground_turn_supersedes_summary_without_caching_a_failure(summary_rpc, monkeypatch, transport_fails):
    rig = summary_rpc
    from hermes_cli import web_session_summary as summaries
    real_call = summaries._call

    def call_with_racing_transport(*args, **kwargs):
        result = real_call(*args, **kwargs)
        if transport_fails:
            raise RuntimeError("Fixture transport closed during foreground startup")
        return result

    monkeypatch.setattr(summaries, "_call", call_with_racing_transport)

    def begin_turn():
        rig.session["running"] = True

    rig.request_hooks.append(begin_turn)
    busy = rig.call()["result"]
    assert busy["busy"] and busy["error_code"] == "busy" and busy["summary"] is None
    cached = summaries.session_summary("stored-summary", language="en")
    assert not cached.get("error") and not cached.get("error_code")
    rig.session["running"] = False
    rig.request_hooks.clear()
    monkeypatch.setattr(summaries, "_call", real_call)
    resumed = rig.call()["result"]
    assert resumed["summary"] and not resumed["stale"] and len(rig.requests) == 2


@pytest.mark.parametrize("starting_agent", [False, True])
def test_foreground_start_releases_summary_host_before_provider_response(summary_rpc, starting_agent):
    rig = summary_rpc
    initial = rig.call()["result"]["summary"]
    rig.db.append_message("stored-summary", "user", "Please verify the completed implementation once more.")
    waiting = threading.Event()
    release = threading.Event()

    def hold_response():
        waiting.set()
        release.wait(10)

    rig.request_hooks.append(hold_response)
    with ThreadPoolExecutor(max_workers=1) as pool:
        request = pool.submit(rig.call)
        try:
            assert waiting.wait(3)
            if starting_agent:
                rig.session["agent_build_started"] = True
                rig.session["agent_ready"] = threading.Event()
            else:
                rig.session["running"] = True
            busy = request.result(timeout=3)["result"]
            assert busy["busy"] and busy["error_code"] == "busy"
            assert busy["summary"] == initial and not release.is_set()
            from hermes_cli.web_session_summary import session_summary
            cached = session_summary("stored-summary", language="en")
            assert cached["summary"] == initial and not cached.get("error")
        finally:
            release.set()
    rig.session["running"] = False
    rig.session["agent_build_started"] = False
    rig.request_hooks.clear()
    retried = rig.call()["result"]
    assert retried["summary"] and not retried["stale"] and len(rig.requests) == 3

"""An explicit same-model pick refreshes a named provider's frozen transport, not its history."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading

import pytest

from tests.gateway.test_session_follow_profile_config import _owner


MODEL = "transport-fixture"
PROVIDER = "fixture-relay"


class _Catalog(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        raw = json.dumps({"data": [{"id": MODEL}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


@pytest.fixture
def profile(tmp_path, monkeypatch):
    from agent import models_dev
    from gateway import run

    home = tmp_path / "profile"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(run, "_hermes_home", home)
    catalog = {"custom": {"id": "custom", "models": {MODEL: {
        "id": MODEL, "name": MODEL, "tool_call": True,
        "cost": {"input": 0, "output": 0}, "limit": {"context": 100000, "output": 4000},
    }}}}
    monkeypatch.setattr(models_dev, "fetch_models_dev", lambda *args, **kwargs: catalog)
    peer = ThreadingHTTPServer(("127.0.0.1", 0), _Catalog)
    thread = threading.Thread(target=peer.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{peer.server_port}/v1"
    config = {
        "model": {"default": MODEL, "provider": PROVIDER, "base_url": url, "api_mode": "chat_completions"},
        "providers": {PROVIDER: {"name": "Fixture relay", "base_url": url,
                                 "api_mode": "chat_completions", "models": {MODEL: {}}}},
        "platform_toolsets": {"cli": []},
    }
    (home / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
    try:
        yield home, config
    finally:
        peer.shutdown()
        peer.server_close()
        thread.join(timeout=5)


@pytest.mark.asyncio
async def test_same_model_reselection_refreshes_transport_with_history_and_fences_intact(profile):
    from gateway.run_turn_prepare import GatewayTurnPrepareMixin
    from gateway.session_policy import policy_for_source
    from hermes_state_local import local_receipt

    home, config = profile
    store, runner, authority, owner = _owner(home)
    runner._peek_session_state = lambda key: None
    runner._resolve_session_agent_runtime = GatewayTurnPrepareMixin._resolve_session_agent_runtime.__get__(runner)
    try:
        created = await owner.dispatch({"id": "create", "method": "session.create", "params": {
            "request_id": "transport-chat", "source": "gui", "cwd": str(home), "toolsets": [],
            "model": MODEL, "provider": PROVIDER,
        }})
        assert "result" in created, created
        sid = created["result"]["session_id"]
        live = authority.sessions[sid]
        db = authority.db
        db.append_message(sid, "user", "Keep this conversation")
        db.append_message(sid, "assistant", "Its existing answer stays here")
        history = db.get_messages(sid)
        before = db.get_session(sid)
        original_request = local_receipt(db, sid)["policy"]["request_json"]

        def runtime():
            model, route = runner._resolve_session_agent_runtime(source=live.source, fallback=False)
            assert model == MODEL
            return route

        assert runtime()["api_mode"] == "chat_completions"
        config["providers"][PROVIDER]["api_mode"] = "codex_responses"
        (home / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
        # A profile edit alone cannot rewrite an existing conversation's route.
        assert runtime()["api_mode"] == "chat_completions"

        params = {
            "session_id": sid, "request_id": "refresh-transport", "operation": "model",
            "expected_revision": before["runtime_revision"], "expected_generation": before["runtime_generation"],
            "payload": {"model": MODEL, "provider": PROVIDER},
        }
        for field, reason in (("expected_revision", "revision_conflict"), ("expected_generation", "stale_generation")):
            refused = await owner.dispatch({"id": field, "method": "session.mutate", "params": {
                **params, field: params[field] + 1, "request_id": field,
            }})
            assert refused["error"]["data"]["reason"] == reason, refused
            assert runtime()["api_mode"] == "chat_completions"
            assert db.get_messages(sid) == history

        refreshed = await owner.dispatch({"id": "refresh", "method": "session.mutate", "params": params})
        assert "result" in refreshed, refreshed
        assert refreshed["result"]["model"] == MODEL
        assert runtime()["api_mode"] == "codex_responses"
        policy = policy_for_source(runner, live.source)
        assert not policy.follows_profile
        assert policy.config()["model"]["api_mode"] == "codex_responses"
        assert policy.config()["providers"][PROVIDER]["api_mode"] == "codex_responses"
        assert local_receipt(db, sid)["policy"]["request_json"] == original_request
        after = db.get_session(sid)
        assert after["runtime_revision"] > before["runtime_revision"]
        assert after["runtime_generation"] == before["runtime_generation"] + 1
        assert after["system_prompt"] == before["system_prompt"]
        assert db.get_messages(sid) == history

        retry = await owner.dispatch({"id": "retry", "method": "session.mutate", "params": params})
        assert retry["result"] == refreshed["result"]
        assert db.get_session(sid)["runtime_revision"] == after["runtime_revision"]
        assert db.get_session(sid)["runtime_generation"] == after["runtime_generation"]
        assert db.get_messages(sid) == history
    finally:
        await owner.close()
        store.close_all_db_handles()

"""A canonical same-model pick refreshes a frozen relay's message-ID replay policy."""

from types import SimpleNamespace
from pathlib import Path

import pytest

from tests.gateway.test_session_follow_profile_config import _owner
from tests.gateway import test_session_model_transport_refresh

MODEL = test_session_model_transport_refresh.MODEL
PROVIDER = test_session_model_transport_refresh.PROVIDER
profile = test_session_model_transport_refresh.profile


@pytest.mark.asyncio
@pytest.mark.parametrize("initial", [None, True], ids=["default", "explicit-true"])
async def test_same_model_pick_refreshes_only_frozen_replay_policy(profile, initial, monkeypatch):
    import hermes_state
    from agent.codex_responses_adapter import classify_responses_route
    from agent.transports.codex import ResponsesApiTransport
    from gateway.run_turn_prepare import GatewayTurnPrepareMixin
    from gateway.session_local import load_profile_config
    from gateway.session_policy import policy_for_source, route_launch_key
    from gateway.session_worker_construct import route_runtime
    from hermes_cli.config import atomic_config_write, get_compatible_custom_providers
    from hermes_state_local import local_receipt

    home, config = profile
    # The hermetic fixture pins this separately once hermes_state is already imported.
    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", home / "state.db")
    config["model"]["api_mode"] = "codex_responses"
    config["providers"][PROVIDER]["api_mode"] = "codex_responses"
    if initial is not None:
        config["providers"][PROVIDER]["responses_replay_item_ids"] = initial
    atomic_config_write(home / "config.yaml", config)
    store, runner, authority, owner = _owner(home)
    assert Path(authority.db.db_path).resolve().parent == home.resolve()
    runner._peek_session_state = lambda key: None
    runner._resolve_session_agent_runtime = GatewayTurnPrepareMixin._resolve_session_agent_runtime.__get__(runner)
    try:
        created = await owner.dispatch({"id": "create", "method": "session.create", "params": {
            "request_id": "replay-chat", "source": "gui", "cwd": str(home), "toolsets": [],
            "model": MODEL, "provider": PROVIDER,
        }})
        assert "result" in created, created
        sid = created["result"]["session_id"]
        live, db = authority.sessions[sid], authority.db
        db.update_system_prompt(sid, "Keep the original cached system prefix.")
        db.append_message(sid, "user", "Keep my conversation")
        db.append_message(sid, "assistant", "Its original answer")
        history, before = db.get_messages(sid), db.get_session(sid)
        original_request = local_receipt(db, sid)["policy"]["request_json"]

        def replay_state():
            model, route = runner._resolve_session_agent_runtime(source=live.source, fallback=False)
            assert model == MODEL
            policy = policy_for_source(runner, live.source)
            frozen = policy.config()
            runtime, fallback = route_runtime(
                policy, frozen, model, route_launch_key(authority, policy, frozen), fallback=False,
            )
            assert fallback is None and route["base_url"] == runtime["base_url"]
            agent = SimpleNamespace(
                provider=runtime["provider"], requested_provider=frozen["model"]["provider"],
                base_url=runtime["base_url"], _custom_providers=get_compatible_custom_providers(frozen),
            )
            endpoint = classify_responses_route(agent).endpoint
            message = ResponsesApiTransport().convert_messages([{
                "role": "assistant", "content": "Existing response", "codex_message_items": [{
                    "type": "message", "role": "assistant", "id": "msg_original",
                    "status": "completed", "phase": "commentary",
                    "content": [{"type": "output_text", "text": "Existing response"}],
                }],
            }], endpoint=endpoint, base_url=runtime["base_url"])[0]
            return runtime, endpoint, message

        assert replay_state()[1].replay_item_ids is True
        assert replay_state()[2]["id"] == "msg_original"
        config["providers"][PROVIDER]["responses_replay_item_ids"] = False
        atomic_config_write(home / "config.yaml", config)
        assert load_profile_config(home)["providers"][PROVIDER]["responses_replay_item_ids"] is False
        # A live profile edit cannot silently rewrite a held conversation's wire policy.
        assert replay_state()[1].replay_item_ids is True
        assert replay_state()[2]["id"] == "msg_original"

        params = {
            "session_id": sid, "request_id": "refresh-replay", "operation": "model",
            "expected_revision": before["runtime_revision"], "expected_generation": before["runtime_generation"],
            "payload": {"model": MODEL, "provider": PROVIDER},
        }
        for field, reason in (("expected_revision", "revision_conflict"), ("expected_generation", "stale_generation")):
            refused = await owner.dispatch({"id": field, "method": "session.mutate", "params": {
                **params, field: params[field] + 1, "request_id": field,
            }})
            assert refused["error"]["data"]["reason"] == reason, refused
            assert replay_state()[1].replay_item_ids is True
            assert db.get_messages(sid) == history

        refreshed = await owner.dispatch({"id": "refresh", "method": "session.mutate", "params": params})
        assert "result" in refreshed, refreshed
        runtime, endpoint, message = replay_state()
        assert runtime["responses_replay_item_ids"] is False
        assert endpoint.replay_item_ids is False and "id" not in message
        assert message["content"] == [{"type": "output_text", "text": "Existing response"}]
        assert message["phase"] == "commentary" and message["status"] == "completed"
        policy = policy_for_source(runner, live.source)
        assert not policy.follows_profile
        assert policy.config()["providers"][PROVIDER]["responses_replay_item_ids"] is False
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

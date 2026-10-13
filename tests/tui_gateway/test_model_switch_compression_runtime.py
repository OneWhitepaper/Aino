"""Compression children must resume the stable runtime after managed/BYOK switches."""

import json

import pytest
import hermes_yaml as yaml

import tui_gateway.server as srv
from agent.context_compressor import is_compaction_summary_message
from tests.tui_gateway.test_managed_model_agent import managed_gateway, result
from tui_gateway.managed_model_runtime import get_registry


@pytest.mark.parametrize("one_turn", [False, True], ids=["persistent", "once-restored"])
def test_compression_resume_routes_to_the_stable_switched_runtime(
        managed_gateway, tmp_path, one_turn):
    f = managed_gateway
    config_path = tmp_path / "config.yaml"
    config = yaml.safe_load(config_path.read_text())
    provider_a = config["custom_providers"][0]
    provider_a["context_length"] = 200_000
    provider_b = {
        "name": "fixture-byok-b", "model": "fixture-byok-b-model",
        "base_url": provider_a["base_url"].replace("/v1", "/byok-b/v1"),
        "api_key": "byok-b-fixture-key",
        "context_length": provider_a["context_length"],
    }
    config["custom_providers"].append(provider_b)
    config["model"] = {
        "default": provider_b["model"], "provider": f"custom:{provider_b['name']}",
        "context_length": provider_b["context_length"],
    }
    config.setdefault("compression", {})["in_place"] = False
    config_path.write_text(yaml.safe_dump(config))

    draft = f.create()
    sid, parent = draft["session_id"], draft["stored_session_id"]
    lease = f.bind(sid)
    f.submit(sid, "Read the fixture file")

    def switch(provider, scope):
        return result(f.call("config.set", session_id=sid, key="model",
            value=f"{provider['model']} --provider custom:{provider['name']} --{scope}",
            confirm_expensive_model=True))

    switch(provider_a, "session")
    assert get_registry().get(sid) is None
    f.submit(sid, "Explain its contents: " + "retain this compression probe context " * 700)
    switched = switch(provider_b, "once" if one_turn else "session")
    assert switched["scope"] == ("once" if one_turn else "session")
    temporary_start = len(f.requests)
    f.submit(sid, "Check it once more")
    switched_requests = f.requests[temporary_start:]
    assert switched_requests
    assert all(path == "/byok-b/v1/chat/completions"
               and auth == f"Bearer {provider_b['api_key']}"
               and body["model"] == provider_b["model"]
               for path, auth, body in switched_requests)

    stable = provider_a if one_turn else provider_b
    session = srv._sessions[sid]
    agent = session["agent"]
    assert agent.model == stable["model"]
    assert agent.base_url.rstrip("/") == stable["base_url"]
    assert not session.get("managed_model_params")
    assert not getattr(agent, "_managed_model_metadata", None)
    history_count = len(f.db.get_messages(parent))

    compressed = result(f.call("session.compress", session_id=sid))
    assert compressed["status"] == "compressed"
    tip = session["session_key"]
    assert tip != parent
    assert f.db.get_compression_lineage(tip) == [parent, tip]
    assert len(session["history"]) < history_count
    assert any(is_compaction_summary_message(message) for message in session["history"])
    child = f.db.get_session(tip)
    child_config = json.loads(child["model_config"])

    result(f.call("session.close", session_id=sid))
    resumed = result(f.call("session.resume", session_id=tip, source="desktop"))
    resumed_sid = resumed["session_id"]
    f.sessions.append(resumed_sid)
    resumed_start = len(f.requests)
    f.submit(resumed_sid, "Continue from the compacted handoff")
    resumed_requests = f.requests[resumed_start:]
    assert resumed_requests
    expected_path = "/v1/chat/completions" if one_turn else "/byok-b/v1/chat/completions"
    assert {(path, auth, body["model"]) for path, auth, body in resumed_requests} == {
        (expected_path, f"Bearer {stable['api_key']}", stable["model"]),
    }
    assert any("CONTEXT COMPACTION" in json.dumps(body) for _, _, body in resumed_requests)

    assert child["model"] == child_config["model"] == stable["model"]
    assert child_config["provider"] == f"custom:{stable['name']}"
    assert child_config["base_url"] == stable["base_url"]
    assert child_config["api_mode"] == agent.api_mode
    for key in ("model", "provider", "base_url", "api_mode"):
        assert agent._session_init_model_config[key] == child_config[key]
    for key in ("model_source", "model_id", "platform_owner", "api_key", "credential_id"):
        assert key not in child_config
    persisted = json.dumps([f.db.get_session(key) for key in (parent, tip)])
    assert all(secret not in persisted
               for secret in (lease["api_key"], provider_a["api_key"], provider_b["api_key"]))
    for path in tmp_path.glob("state.db*"):
        assert all(secret.encode() not in path.read_bytes()
                   for secret in (lease["api_key"], provider_a["api_key"], provider_b["api_key"]))

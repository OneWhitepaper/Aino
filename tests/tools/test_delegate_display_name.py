"""A child's friendly name is display metadata, not its goal, route, or identity."""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from agent.delegation_provider import DelegationProvider
from tests.tools.test_delegate import _make_mock_parent


class _Provider(DelegationProvider):
    name = "named-test"

    def __init__(self):
        self.received = []

    def route_task(self, task, config):
        self.received.append(dict(task))
        return {}


def test_name_is_not_a_provider_parameter_or_a_replacement_goal():
    from tools.delegate_tool_routes import _route_one
    from tools.delegate_tool_tasks import _normalize_task_list

    goal = "Read the source and verify the original account boundary."
    provider = _Provider()
    original = [{"goal": goal, "display_name": "  账号 核验  "}]
    tasks, error = _normalize_task_list(None, None, original, None, "leaf", 3)
    assert error is None
    _route_one(provider, {}, 0, tasks[0], {})
    assert provider.received == [{"goal": goal, "context": None, "index": 0}]
    assert tasks[0]["display_name"] == "账号 核验"
    assert tasks[0]["goal"] == goal
    assert original[0]["display_name"] == "  账号 核验  "

    legacy, error = _normalize_task_list("Old call", None, None, None, "leaf", 3)
    assert error is None and "display_name" not in legacy[0]
    _, error = _normalize_task_list(None, None, [{"goal": goal, "display_name": {"name": "wrong"}}], None, "leaf", 3)
    assert error and "display_name" in error


def test_named_child_keeps_name_and_identity_in_events_roster_and_result(monkeypatch):
    from tools import delegate_tool as dt
    from tools import delegate_tool_registry as registry
    from tools.delegate_tool_child_run import _SchemaOutcome, _build_result_entry, _fabricated_entry, _register_child
    from tui_gateway.contracts.events import SubagentEventPayload
    from tui_gateway.contracts.profiles_vault_complete_foreign_subagents import SubagentSnapshot
    from tui_gateway.methods_subagents import _live_work_owners
    from tui_gateway.tool_progress import _subagent_payload

    parent = _make_mock_parent()
    parent.session_id = "parent-session"
    events = []
    parent.tool_progress_callback = lambda event, name=None, preview=None, args=None, **kw: events.append((event, kw))
    route = SimpleNamespace(error=None, creds={"model": "example", "provider": "openrouter", "api_key": "k",
                           "base_url": "http://127.0.0.1:8080/v1", "api_mode": "chat_completions"},
                            routing_cfg={}, reasoning_effort=None, profile_home=None, report=lambda: None)
    child = MagicMock()
    child.session_id, child.model = "child-session", "example"
    child._session_init_model_config = {}
    monkeypatch.setattr(registry, "_active_subagents", {})
    monkeypatch.setattr(dt, "_load_config", dict)
    from tools.registry import registry as tools
    batches = []
    with (patch("run_agent.AIAgent", return_value=child),
          patch.object(dt, "_routes_for", return_value=([route], None)),
          patch.object(dt, "_run_batch", side_effect=lambda batch, background: batches.append(batch) or json.dumps({"status": "built"}))):
        response = tools.dispatch("delegate_task", {"tasks": [{
            "goal": "Inspect the complete original task without truncating it.", "display_name": "源码核验",
        }]}, parent_agent=parent)
    assert json.loads(response)["status"] == "built"
    children = batches[0].children
    assert len(children) == 1 and events
    for event, metadata in events:
        payload = _subagent_payload(event, None, None, metadata, show_reasoning=False)
        SubagentEventPayload.model_validate(payload)
        assert payload["display_name"] == "源码核验"
        assert payload["goal"] == "Inspect the complete original task without truncating it."
        assert payload["subagent_id"] == child._subagent_id

    _register_child(child, parent, children[0][1]["goal"], owner_session_id="ui-parent",
                    owner_transport=object(), owner_session_record={})
    _, _, snapshot = next(item for item in _live_work_owners() if item[0] == "subagents")
    SubagentSnapshot.model_validate(snapshot)
    assert snapshot["display_name"] == "源码核验"
    assert snapshot["child_session_id"] == "child-session"

    from gateway import session_ancillary
    with (patch.object(session_ancillary, "_require_current_route"),
          patch.object(session_ancillary, "_owner_objects", return_value=(parent, list(registry._active_subagents.values())))):
        native = session_ancillary._project(None, None, {}, "subagents")["subagents"][0]
    SubagentSnapshot.model_validate(native)
    assert native["display_name"] == "源码核验"

    result = _build_result_entry(child, {"completed": True, "final_response": "Verified."}, 0, 2,
                                _SchemaOutcome(None, None, [], 0))
    failure = _fabricated_entry(0, "failed", "Unavailable", child)
    for entry in (result, failure):
        assert entry["display_name"] == "源码核验"
        assert entry["subagent_id"] == child._subagent_id
        assert entry["child_session_id"] == "child-session"

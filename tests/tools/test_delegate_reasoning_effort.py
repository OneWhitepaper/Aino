"""Per-task reasoning choices reach real child requests without changing the parent."""

from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading

import pytest

from hermes_constants import get_hermes_home
from tools import delegate_tool
from tools.registry import registry


@pytest.fixture
def delegation_runtime(monkeypatch, request):
    from gateway.session_context import clear_session_vars, set_session_vars
    from run_agent import AIAgent

    requests = []
    children = []

    class Provider(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            if "messages" not in body and "input" not in body:
                self.send_error(404)
                return
            requests.append(body)
            if "input" in body:
                message = {"id": "msg_local", "type": "message", "role": "assistant",
                           "status": "completed",
                           "content": [{"type": "output_text", "text": "done", "annotations": []}]}
                response = {"id": "resp_local", "object": "response", "created_at": 0,
                            "model": body["model"], "status": "completed", "output": [message],
                            "usage": {"input_tokens": 10, "output_tokens": 1, "total_tokens": 11}}
                events = [
                    {"type": "response.created",
                     "response": {**response, "status": "in_progress", "output": []}},
                    {"type": "response.output_item.done", "output_index": 0, "item": message},
                    {"type": "response.completed", "response": response},
                ]
                payload = "".join(f"data: {json.dumps(event)}\n\n" for event in events).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            if body.get("model") == "unavailable-primary":
                payload = json.dumps({"error": {"message": "Model not found", "code": "model_not_found"}}).encode()
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            message = {"role": "assistant", "content": "done"}
            response = {"id": "local", "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 10, "completion_tokens": 1, "total_tokens": 11}}
            last = body["messages"][-1]
            if last.get("role") == "user" and "private-current-envelope-sentinel" in str(last.get("content")):
                message["content"] = None
                message["tool_calls"] = [{"id": "context-probe", "type": "function", "function": {
                    "name": "delegate_task", "arguments": json.dumps({"tasks": [{
                        "goal": "Inspect only the pagination boundary", "context_turns": "1",
                    }]}),
                }}]
                response["choices"][0]["finish_reason"] = "tool_calls"
            content_type = "application/json"
            if body.get("stream"):
                response["choices"][0]["delta"] = response["choices"][0].pop("message")
                payload = ("data: " + json.dumps(response) + "\n\ndata: [DONE]\n\n").encode()
                content_type = "text/event-stream"
            else:
                payload = json.dumps(response).encode()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    config_path = get_hermes_home() / "config.yaml"
    config_path.write_text("delegation:\n  max_iterations: 4\n  max_concurrent_children: 3\n", encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    tokens = set_session_vars(async_delivery=False)
    real_build = delegate_tool._build_child_agent

    def capture_child(**kwargs):
        child = real_build(**kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(delegate_tool, "_build_child_agent", capture_child)
    parent = AIAgent(
        api_key="test-key", base_url=f"http://127.0.0.1:{server.server_port}/v1",
        provider="custom", model="test-model", api_mode=getattr(request, "param", "chat_completions"),
        reasoning_config={"enabled": True, "effort": "ultra"}, enabled_toolsets=["delegation"],
        max_iterations=4, quiet_mode=True, skip_context_files=True, skip_memory=True,
        save_trajectories=False, platform="cli", session_id="parent-effort",
    )
    try:
        yield parent, children, requests, config_path
    finally:
        parent.close()
        clear_session_vars(tokens)
        server.shutdown()
        server.server_close()


def _decoded(value):
    return json.loads(value) if isinstance(value, str) else value


def _wire_effort(request):
    return request.get("reasoning_effort") or request.get("reasoning", {}).get("effort")


@pytest.mark.parametrize("delegation_runtime", ["codex_responses"], indirect=True)
def test_responses_configured_child_effort_yields_to_task_override(delegation_runtime):
    parent, children, requests, config_path = delegation_runtime
    config_path.write_text(json.dumps({
        "agent": {"reasoning_effort": "ultra"},
        "delegation": {"max_iterations": 4, "max_concurrent_children": 3, "reasoning_effort": "high"},
    }), encoding="utf-8")
    history = parent.run_conversation("Parent before delegation")["messages"]
    original_request = deepcopy(requests[-1])
    original_history = deepcopy(history)
    original_config = config_path.read_bytes()
    tasks = [{"goal": "Review the difficult boundary", "reasoning_effort": "max"},
             {"goal": "Extract the documented constraints"}]
    original_tasks = deepcopy(tasks)

    result = _decoded(registry.dispatch("delegate_task", {"tasks": tasks}, parent_agent=parent))

    assert [entry["status"] for entry in result["results"]] == ["completed", "completed"]
    assert all(child.api_mode == "codex_responses" for child in children)
    assert {request["input"][-1]["content"]: _wire_effort(request) for request in requests[1:]} == {
        "Review the difficult boundary": "max", "Extract the documented constraints": "high",
    }
    assert tasks == original_tasks and history == original_history
    assert config_path.read_bytes() == original_config
    assert parent.reasoning_config == {"enabled": True, "effort": "ultra"}

    parent.run_conversation("Parent after delegation", conversation_history=history)
    assert _wire_effort(requests[-1]) == _wire_effort(original_request) == "max"
    assert requests[-1]["input"][:len(original_request["input"])] == original_request["input"]
    assert requests[-1]["instructions"] == original_request["instructions"]
    assert requests[-1]["tools"] == original_request["tools"]


def test_batch_efforts_reach_child_wires_and_leave_parent_context_unchanged(delegation_runtime):
    parent, children, requests, config_path = delegation_runtime
    history = parent.run_conversation("Parent before delegation")["messages"]
    original_request = deepcopy(requests[-1])
    original_history = deepcopy(history)
    original_reasoning = deepcopy(parent.reasoning_config)
    original_config = config_path.read_bytes()
    tasks = [{"goal": "Extract the three headings", "reasoning_effort": "medium"},
             {"goal": "Review the important boundary", "reasoning_effort": "high"},
             {"goal": "Investigate the difficult case"}]
    wire_schema = next(tool["function"] for tool in original_request["tools"]
                       if tool["function"]["name"] == "delegate_task")
    task_schema = wire_schema["parameters"]["properties"]["tasks"]["items"]
    advertised_efforts = task_schema["properties"]["reasoning_effort"]["enum"]
    assert all(task["reasoning_effort"] in advertised_efforts for task in tasks if "reasoning_effort" in task)
    assert "reasoning_effort" not in task_schema.get("required", [])
    original_tasks = deepcopy(tasks)
    result = _decoded(registry.dispatch("delegate_task", {"tasks": tasks}, parent_agent=parent))
    assert [entry["status"] for entry in result["results"]] == ["completed"] * len(tasks)
    assert [child.reasoning_config for child in children] == [
        {"enabled": True, "effort": "medium"}, {"enabled": True, "effort": "high"}, original_reasoning,
    ]
    assert {request["messages"][-1]["content"]: _wire_effort(request) for request in requests[1:]} == {
        task["goal"]: effort for task, effort in zip(tasks, ("medium", "high", "max"))
    }
    assert parent.reasoning_config == original_reasoning
    assert history == original_history and tasks == original_tasks
    assert config_path.read_bytes() == original_config
    parent.run_conversation("Parent after delegation", conversation_history=history)
    assert requests[-1]["messages"][:len(original_request["messages"])] == original_request["messages"]
    assert _wire_effort(requests[-1]) == _wire_effort(original_request) == "max"

    # A real primary-model failure must preserve each explicit task choice even
    # when ordinary fallback configuration would resolve the global Ultra level.
    config_path.write_text(json.dumps({
        "agent": {"reasoning_effort": "ultra"},
        "delegation": {"model": "unavailable-primary", "max_iterations": 4,
                       "fallback_providers": [{"provider": "custom", "model": "fallback-model",
                           "base_url": parent.base_url, "api_key": "test-key", "api_mode": "chat_completions"}]},
    }), encoding="utf-8")
    fallback_tasks = [{"goal": "Finish the fallback " + effort + " case", "reasoning_effort": effort}
                      for effort in ("medium", "high", "none")]
    start = len(requests)
    result = _decoded(registry.dispatch("delegate_task", {"tasks": fallback_tasks}, parent_agent=parent))
    assert [entry["status"] for entry in result["results"]] == ["completed"] * len(fallback_tasks)
    for task in fallback_tasks:
        sent = [request for request in requests[start:] if request["messages"][-1]["content"] == task["goal"]]
        assert [request["model"] for request in sent] == ["unavailable-primary", "fallback-model"]
        assert [_wire_effort(request) for request in sent] == [task["reasoning_effort"]] * 2
    assert parent.reasoning_config == original_reasoning and parent.model == original_request["model"]
    assert parent._cached_system_prompt == original_request["messages"][0]["content"]


def test_invalid_batch_is_atomic_and_legacy_single_effort_keeps_config_precedence(delegation_runtime):
    parent, children, requests, config_path = delegation_runtime
    for invalid in ("hgih", "", True, {"effort": "low"}):
        result = _decoded(registry.dispatch("delegate_task", {"tasks": [
            {"goal": "Read the relevant guide", "reasoning_effort": "medium"},
            {"goal": "Review the relevant code", "reasoning_effort": invalid},
        ]}, parent_agent=parent))
        assert "Task 1" in result["error"] and "reasoning_effort" in result["error"]
        assert not children and not requests

    config_path.write_text("delegation:\n  max_iterations: 4\n  reasoning_effort: low\n", encoding="utf-8")
    # Exercise both real model dispatch and registry fallback for the legacy single-goal form.
    result = _decoded(parent._dispatch_delegate_task({"goal": "Review a small parser", "reasoning_effort": "high"}))
    assert result["results"][0]["status"] == "completed"
    inherited = _decoded(registry.dispatch("delegate_task", {"goal": "Review another parser"}, parent_agent=parent))
    assert inherited["results"][0]["status"] == "completed"
    assert [child.reasoning_config for child in children] == [
        {"enabled": True, "effort": "high"}, {"enabled": True, "effort": "low"},
    ]
    assert [_wire_effort(request) for request in requests] == ["high", "low"]
    assert parent.reasoning_config == {"enabled": True, "effort": "ultra"}


    # An ordinary, non-delegated agent still re-resolves fallback model/global defaults.
    config_path.write_text("agent:\n  reasoning_effort: ultra\n", encoding="utf-8")
    ordinary = type(parent)(
        api_key="test-key", base_url=parent.base_url, provider="custom", model="unavailable-primary",
        api_mode="chat_completions", reasoning_config={"enabled": True, "effort": "low"},
        fallback_model=[{"provider": "custom", "model": "fallback-model", "base_url": parent.base_url,
                         "api_key": "test-key", "api_mode": "chat_completions"}],
        enabled_toolsets=[], max_iterations=4, quiet_mode=True, skip_context_files=True,
        skip_memory=True, save_trajectories=False, platform="cli",
    )
    start = len(requests)
    try:
        assert ordinary.run_conversation("Use the ordinary fallback policy")["final_response"] == "done"
        assert ordinary.reasoning_config == {"enabled": True, "effort": "ultra"}
    finally:
        ordinary.close()
    assert [request["model"] for request in requests[start:]] == ["unavailable-primary", "fallback-model"]
    assert [_wire_effort(request) for request in requests[start:]] == ["low", "max"]
    assert parent.reasoning_config == {"enabled": True, "effort": "ultra"}


def test_context_excerpts_use_live_turn_and_preserve_parent_and_child_scope(delegation_runtime):
    from agent.inline_tool_executors import INLINE_TOOL_EXECUTORS, InlineToolContext
    from agent.context_compressor import ContextCompressor, SUMMARY_PREFIX, _SUMMARY_END_MARKER
    from types import SimpleNamespace
    from tools.delegate_tool_tasks import _coerce_task_contexts
    from agent.prompt_builder import STEER_DISPLAY_KIND

    parent, children, requests, _ = delegation_runtime
    parent.run_conversation("Old session snapshot")
    live = [
        {"role": "system", "content": "private-system-sentinel"},
        {"role": "user", "content": "Keep the public interface; answer in Chinese.",
         "api_content": "private-mode-sentinel"},
        {"role": "assistant", "content": "Approved the module boundary.",
         "codex_message_items": [
             {"type": "message", "role": "assistant", "phase": "commentary",
              "content": [{"type": "output_text", "text": "private-commentary-sentinel"}]},
             {"type": "message", "role": "assistant", "phase": "final_answer",
              "content": [{"type": "output_text", "text": "Approved the module boundary."}]}],
         "codex_reasoning_items": [{"encrypted_content": "private-reasoning-sentinel"}]},
        {"role": "tool", "content": "private-tool-sentinel"},
        {"role": "user", "display_kind": STEER_DISPLAY_KIND, "content": "User correction: no new dependencies."},
        {"role": "user", "_compressed_summary": True, "_compressed_summary_has_user_turn": True,
         "content": f"{SUMMARY_PREFIX}\nprivate-summary-sentinel\n{_SUMMARY_END_MARKER}\n\nRetained visible requirement."},
        {"role": "user", "content": [
            {"type": "text", "text": "Now investigate the parser boundary."},
            {"type": "image_url", "image_url": {"url": "private-image-sentinel"}}]},
        {"role": "user", "_compressed_summary": True, "_compressed_summary_has_user_turn": True,
         "content": f"{SUMMARY_PREFIX}\nprivate-standalone-sentinel\n{_SUMMARY_END_MARKER}"},
        {"role": "user", "_empty_recovery_synthetic": True, "content": "private-recovery-sentinel"},
        {"role": "assistant", "content": "private-pending-sentinel", "tool_calls": [{"id": "pending"}]},
    ]
    before = deepcopy(live)
    tasks = [{"goal": "Inspect the first boundary", "context_turns": "all", "context": "Only inspect auth.py."},
             {"goal": "Inspect the second boundary", "context_turns": "1"},
             {"goal": "Inspect the third boundary", "context_turns": "none"}]
    original_tasks = deepcopy(tasks)
    result = _decoded(INLINE_TOOL_EXECUTORS["delegate_task"](
        parent, {"tasks": tasks}, InlineToolContext(effective_task_id="parent-effort", messages=live),
    ))
    assert all(entry["status"] == "completed" for entry in result["results"])
    by_goal = {request["messages"][-1]["content"]: request for request in requests[1:]}
    contexts = [by_goal[task["goal"]]["messages"][0]["content"] for task in tasks]
    assert "Keep the public interface" in contexts[0] and "answer in Chinese" in contexts[0]
    assert "Approved the module boundary" in contexts[0] and "Only inspect auth.py" in contexts[0]
    assert "User correction: no new dependencies" in contexts[0] and "Retained visible requirement" in contexts[0]
    assert "Keep the public interface" not in contexts[1] and "Approved the module boundary" not in contexts[1]
    assert all("Now investigate the parser boundary" in context for context in contexts[:2])
    assert "Now investigate the parser boundary" not in contexts[2]
    assert all("private-" not in context and "Old session snapshot" not in context for context in contexts)
    assert all(_wire_effort(request) == "max" for request in by_goal.values())
    assert all(child.model == parent.model for child in children)
    assert live == before and tasks == original_tasks

    # The real gateway-style prologue keeps an API envelope in live content until
    # finalization; use its existing durable projection, not just api_content omission.
    start = len(requests)
    parent.run_conversation(
        "private-current-envelope-sentinel", persist_user_message="Visible requirement: preserve pagination.",
    )
    wire = requests[start:]
    assert "private-current-envelope-sentinel" in str(wire[0]["messages"][-1]["content"])
    child_request = next(request for request in wire
                         if request["messages"][-1]["content"] == "Inspect only the pagination boundary")
    child_context = child_request["messages"][0]["content"]
    assert "Visible requirement: preserve pagination." in child_context
    assert "private-current-envelope-sentinel" not in child_context

    for force_user_leading in (False, True):
        carrier = {"role": "user", "content": "private-current-envelope-sentinel"}
        ContextCompressor._merge_summary_into_tail_row(
            SimpleNamespace(_summary_has_user_turn=True), carrier,
            SUMMARY_PREFIX + "\nprivate-summary-sentinel", "user", force_user_leading,
        )
        carrier_before = deepcopy(carrier)
        owner = SimpleNamespace(_persist_user_message_idx=0,
                                _persist_user_message_override="Visible current requirement.")
        contexts, error = _coerce_task_contexts([{"context_turns": "1"}], [carrier], owner)
        assert error is None and "Visible current requirement." in contexts[0]
        assert "private-" not in contexts[0] and carrier == carrier_before

    image_only = [
        {"role": "user", "content": "Old text request."},
        {"role": "assistant", "content": "Old final answer."},
        {"role": "user", "content": [{"type": "image_url",
                                             "image_url": {"url": "private-image-sentinel"}}]},
    ]
    contexts, error = _coerce_task_contexts([{"context_turns": "1"}], image_only, SimpleNamespace())
    assert error is None and contexts == [None]
    image_only.append({"role": "assistant", "content": "Current image analysis."})
    contexts, error = _coerce_task_contexts([{"context_turns": "1"}], image_only, SimpleNamespace())
    assert error is None and "Current image analysis." in contexts[0]
    assert "Old " not in contexts[0] and "private-" not in contexts[0]


def test_context_selection_validates_batch_before_spawn_and_keeps_isolated_default(delegation_runtime):
    parent, children, requests, _ = delegation_runtime
    parent._session_messages = [{"role": "user", "content": "Do not expose this by default."}]
    for invalid in ("0", "-1", "", "recent", True, {}, 1.5):
        result = _decoded(registry.dispatch("delegate_task", {"tasks": [
            {"goal": "Inspect the first boundary", "context_turns": "1"},
            {"goal": "Inspect the second boundary", "context_turns": invalid},
        ]}, parent_agent=parent))
        assert "Task 1" in result["error"] and "context_turns" in result["error"]
        assert not children and not requests
    result = _decoded(registry.dispatch("delegate_task", {"tasks": [
        {"goal": "Inspect only the assigned boundary", "context": "Read the specification."},
    ]}, parent_agent=parent))
    assert result["results"][0]["status"] == "completed"
    assert "Do not expose this by default" not in requests[0]["messages"][0]["content"]
    assert "Read the specification" in requests[0]["messages"][0]["content"]

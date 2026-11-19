"""Native Code evidence must survive the actual canonical viewer payload bound."""

import json

from agent.transports.codex_event_projector import CodexEventProjector
from gateway.run_turn_progress import _tool_complete_payload


def test_native_patch_under_event_budget_does_not_duplicate_its_body_and_lose_review():
    text = "x" * 33000 + "\n"
    item = {"id": "patch", "type": "fileChange", "status": "completed", "changes": [
        {"path": "/repo/large.txt", "kind": {"type": "add"}, "diff": text}]}
    messages = CodexEventProjector().project({"method": "item/completed", "params": {"item": item}}).messages
    call = messages[0]["tool_calls"][0]
    payload = _tool_complete_payload(call["id"], "apply_patch", json.loads(call["function"]["arguments"]),
                                     messages[1]["content"])
    result = json.loads(payload["result"])
    assert not result.get("truncated")
    assert result["success"] is True
    assert "+" + text.rstrip() in result["changes"][0]["diff"]

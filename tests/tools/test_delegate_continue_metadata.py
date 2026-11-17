"""A continued child's display identity and explicit reasoning survive a rebuild or restart."""
import json
from unittest.mock import patch

import pytest

from tests.tools.test_delegate_continue import _completion, _parent, _ScriptedModel
from tests.tools.test_delegate_resumable import _forget_process_state


@pytest.mark.parametrize("restart", [False, True])
def test_continue_keeps_the_child_name_and_explicit_reasoning(restart):
    from tools.delegate_tool import delegate_task

    model, parent = _ScriptedModel(), _parent()
    with patch("run_agent.AIAgent", side_effect=model):
        spawned = json.loads(delegate_task(tasks=[{
            "goal": "Inspect the account boundary", "display_name": "Boundary review", "reasoning_effort": "high",
        }], background=True, parent_agent=parent))
        _completion(spawned["delegation_id"])
        if restart:
            _forget_process_state()
        continued = json.loads(delegate_task(
            action="continue", subagent_id=spawned["subagent_ids"][0], message="Check the sibling path too",
            background=True, parent_agent=parent))
        assert continued.get("status") == "dispatched", continued
        result = _completion(continued["delegation_id"])

    assert model.builds[1]["reasoning_config"] == model.builds[0]["reasoning_config"] == {
        "enabled": True, "effort": "high",
    }
    assert '"display_name": "Boundary review"' in json.dumps(result)

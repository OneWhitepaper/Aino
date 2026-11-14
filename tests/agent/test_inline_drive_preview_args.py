"""The inline desktop preview executor preserves its full tool arguments."""

from types import SimpleNamespace

from agent.inline_tool_executors import INLINE_TOOL_EXECUTORS, InlineToolContext


def test_drive_preview_inline_executor_forwards_full_and_allow_shortcut(monkeypatch):
    from tools import drive_preview_tool

    captured = {}

    def dispatch(**kwargs):
        captured.update(kwargs)
        return "preview result"

    monkeypatch.setattr(drive_preview_tool, "drive_preview_tool", dispatch)
    agent = SimpleNamespace(drive_preview_callback=lambda payload: "bridge result")
    context = InlineToolContext(effective_task_id="task-1", tool_call_id="call-1")

    result = INLINE_TOOL_EXECUTORS["drive_preview"](
        agent,
        {"action": "elements", "full": True, "allow_shortcut": True},
        context,
    )

    assert result == "preview result"
    assert captured["full"] is True
    assert captured["allow_shortcut"] is True


def test_inline_visual_action_reaches_the_real_tool_and_renderer_callback():
    import json

    seen = []
    agent = SimpleNamespace(drive_preview_callback=lambda payload: seen.append(payload) or '{"success":true}')
    context = InlineToolContext(effective_task_id="task-1", tool_call_id="call-visual")
    args = {
        "action": "drag",
        "tab_id": "tab-a",
        "observation_id": "observation-a",
        "coordinate": [1, 2],
        "to_coordinate": [5, 6],
        "sensitive": True,
    }

    result = INLINE_TOOL_EXECUTORS["drive_preview"](agent, args, context)

    assert json.loads(result)["success"] is True
    assert seen == [args]

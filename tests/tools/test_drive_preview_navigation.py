"""Existing desktop browser actions expose double-click and session-owned tab navigation."""

import json
from types import SimpleNamespace

import pytest

from agent.inline_tool_executors import INLINE_TOOL_EXECUTORS, InlineToolContext
from tools import drive_preview_tool
from tools.registry import registry


@pytest.mark.parametrize("args", [
    {"action": "tabs"},
    {"action": "select_tab", "tab_id": "tab-owned"},
    {"action": "double_click", "ref": "btn-edit"},
    {"action": "double_click", "tab_id": "tab-owned", "observation_id": "seen", "coordinate": [1, 2]},
])
def test_navigation_reaches_real_registry_and_inline_callback(args):
    captured = []
    def callback(payload):
        captured.append(payload)
        return '{"success":true}'

    assert json.loads(registry.dispatch(drive_preview_tool.ACT_PREVIEW_SCHEMA["name"], args, callback=callback))["success"] is True
    assert json.loads(INLINE_TOOL_EXECUTORS["drive_preview"](
        SimpleNamespace(drive_preview_callback=callback), args, InlineToolContext(effective_task_id="task"),
    ))["success"] is True
    assert captured == [args, args]


@pytest.mark.parametrize("args", [{"action": "select_tab"}, {"action": "double_click"}])
def test_navigation_missing_target_never_crosses_renderer(args):
    def unexpected(_payload):
        pytest.fail("invalid browser navigation reached the renderer")

    assert "error" in json.loads(registry.dispatch(drive_preview_tool.ACT_PREVIEW_SCHEMA["name"], args, callback=unexpected))


@pytest.mark.parametrize("args", [
    {"action": "dialog_status", "tab_id": "tab-owned"},
    {"action": "dialog_respond", "tab_id": "tab-owned", "dialog_id": "dialog-1", "accept": False},
    {"action": "dialog_respond", "tab_id": "tab-owned", "dialog_id": "dialog-1", "accept": True, "prompt_text": "Synthetic"},
    {"action": "upload_files", "tab_id": "tab-owned", "ref": "inp-upload", "paths": ["/tmp/synthetic.txt"]},
    {"action": "upload_files", "tab_id": "tab-owned", "chooser_id": "chooser-1", "paths": ["/tmp/synthetic.txt"]},
    {"action": "downloads_status", "tab_id": "tab-owned"},
    {"action": "download_cancel", "tab_id": "tab-owned", "download_id": "download-1"},
    {"action": "downloads_status", "download_path": "/tmp/synthetic-export.csv"},
])
def test_native_feature_arguments_survive_registry_inline_and_wire_contract(args):
    from tui_gateway.contracts.server_requests import PreviewActRequestParams

    captured = []

    def callback(payload):
        captured.append(payload)
        PreviewActRequestParams.model_validate({"session_id": "session-1", **payload})
        return '{"success":true}'

    result = INLINE_TOOL_EXECUTORS["drive_preview"](
        SimpleNamespace(drive_preview_callback=callback), args, InlineToolContext(effective_task_id="task"),
    )
    assert json.loads(result)["success"] is True
    assert captured == [args]


@pytest.mark.parametrize("args", [
    {"action": "upload_files", "chooser_id": "chooser-1", "ref": "inp-other", "paths": ["/tmp/synthetic.txt"]},
    {"action": "click", "chooser_id": "chooser-1", "ref": "btn-open"},
    {"action": "upload_files", "chooser_id": " ", "paths": ["/tmp/synthetic.txt"]},
])
def test_ambiguous_or_invalid_chooser_never_crosses_renderer(args):
    def unexpected(_payload):
        pytest.fail("invalid chooser request reached the renderer")

    assert "error" in json.loads(registry.dispatch(drive_preview_tool.ACT_PREVIEW_SCHEMA["name"], args, callback=unexpected))

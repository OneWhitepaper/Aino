"""Native tool evidence must survive both live callbacks and transcript replay."""

import json
from types import SimpleNamespace

import pytest

from agent.codex_runtime import _codex_output_preview, make_codex_app_server_event_bridge
from agent.transports.codex_event_projector import CodexEventProjector


def delivered(item):
    calls = []
    bridge = make_codex_app_server_event_bridge(SimpleNamespace(
        tool_complete_callback=lambda *args: calls.append(args)))
    note = {"method": "item/completed", "params": {"item": item}}
    bridge(note)
    messages = CodexEventProjector().project(note).messages
    return json.loads(calls[0][3]), json.loads(messages[-1]["content"])


def test_native_command_keeps_the_same_execution_receipt_live_and_after_reload():
    item = {"id": "command-1", "type": "commandExecution", "command": "npm test", "cwd": "/repo",
            "status": "completed", "exitCode": 0, "aggregatedOutput": "3 tests passed\n", "durationMs": 1250}
    for result in delivered(item):
        assert result == {"output": "3 tests passed\n", "exit_code": 0, "duration_s": 1.25,
                          "status": "completed"}


@pytest.mark.parametrize("status", ["failed", "declined"])
def test_native_command_without_exit_code_does_not_look_successful(status):
    for result in delivered({"id": "denied", "type": "commandExecution", "command": "restricted",
                             "status": status, "aggregatedOutput": "not executed"}):
        assert result["status"] == status
        assert result["error"]
        assert "exit_code" not in result


def test_native_patch_keeps_each_file_diff_instead_of_only_a_change_count():
    changes = [
        {"path": "/repo/a.py", "kind": {"type": "update", "move_path": "/repo/b.py"},
         "diff": "@@ -1 +1 @@\n-old\n+new\n"},
        {"path": "/repo/c.py", "kind": {"type": "add"}, "diff": "created\n"},
    ]
    for result in delivered({"id": "patch-1", "type": "fileChange", "status": "completed", "changes": changes}):
        assert [(c["path"], c["kind"]) for c in result["changes"]] == [(c["path"], c["kind"]) for c in changes]
        assert result["success"] is True
        assert "--- /repo/a.py\n+++ /repo/b.py\n" in result["changes"][0]["diff"]
        assert "--- /dev/null\n+++ /repo/c.py\n" in result["changes"][1]["diff"]
        assert "-old\n+new" in result["changes"][0]["diff"]


def test_native_output_progress_is_correlated_bounded_and_not_a_completion():
    progress, completed = [], []
    bridge = make_codex_app_server_event_bridge(SimpleNamespace(
        tool_progress_callback=lambda *args, **kwargs: progress.append((args, kwargs)),
        tool_complete_callback=lambda *args: completed.append(args)))
    bridge({"method": "item/started", "params": {"item": {
        "id": "cmd", "type": "commandExecution", "command": "npm test"}}})
    bridge({"method": "item/commandExecution/outputDelta", "params": {
        "itemId": "cmd", "delta": "x" * 5000 + "\nCompiling fixture\n"}})
    args, kwargs = progress[-1]
    assert args[0] == "tool.progress"
    assert args[2].endswith("Compiling fixture") and len(args[2]) <= 500
    assert kwargs["tool_call_id"] == "codex_exec_cmd"
    assert not completed
    count = len(progress)
    bridge({"method": "item/commandExecution/outputDelta", "params": {"itemId": "unknown", "delta": "stale"}})
    assert len(progress) == count


def test_completed_native_patch_supplies_paths_missing_from_its_start_event():
    calls = []
    bridge = make_codex_app_server_event_bridge(SimpleNamespace(tool_complete_callback=lambda *args: calls.append(args)))
    bridge({"method": "item/started", "params": {"item": {"id": "patch", "type": "fileChange", "changes": []}}})
    bridge({"method": "item/completed", "params": {"item": {
        "id": "patch", "type": "fileChange", "status": "completed",
        "changes": [{"path": "/repo/a.py", "kind": {"type": "add"}, "diff": "new\n"}]}}})
    assert calls[0][2] == {"changes": [{"path": "/repo/a.py", "kind": "add"}]}


@pytest.mark.parametrize("split", [False, True])
def test_live_output_redacts_complete_lines_before_truncating_them(split):
    events = []
    bridge = make_codex_app_server_event_bridge(SimpleNamespace(
        tool_progress_callback=lambda *args, **kwargs: events.append(args)))
    bridge({"method": "item/started", "params": {"item": {
        "id": "secret-command", "type": "commandExecution", "command": "fixture"}}})
    secret = "sk-" + "ABCDef0123456789" * 3
    line = "API_KEY=" + secret + " " + "x" * 480 + "\n"
    chunks = [line[:20], line[20:]] if split else [line]
    for chunk in chunks:
        bridge({"method": "item/commandExecution/outputDelta", "params": {"itemId": "secret-command", "delta": chunk}})
    messages = " ".join(str(args[2]) for args in events if args[0] == "tool.progress")
    assert "x" * 100 in messages
    assert secret[-19:] not in messages


def test_over_budget_output_stops_previews_instead_of_losing_redaction_context():
    events = []
    bridge = make_codex_app_server_event_bridge(SimpleNamespace(
        tool_progress_callback=lambda *args, **kwargs: events.append(args)))
    bridge({"method": "item/started", "params": {"item": {"id": "cmd", "type": "commandExecution"}}})
    for chunk in ("x" * (64 * 1024 + 1), "do-not-display-this-fragment\n", "safe new line\n"):
        bridge({"method": "item/commandExecution/outputDelta", "params": {"itemId": "cmd", "delta": chunk}})
    assert [args[2] for args in events if args[0] == "tool.progress"] == []


@pytest.mark.parametrize("armor", ["PRIVATE KEY", "PGP PRIVATE KEY BLOCK"])
def test_live_preview_keeps_redaction_context_across_private_key_lines(armor):
    body = "aBcD+eFgH/iJkLmN0pQrStUvWxYz1234567890=" * 2
    buffer, disabled, previews = "", False, []
    for delta in (f"-----BEGIN {armor}-----\n", body + "\n", f"-----END {armor}-----\n", "finished\n"):
        preview, buffer, disabled = _codex_output_preview(buffer, disabled, delta)
        previews.append(preview)
    assert body not in "\n".join(previews)
    assert previews[-1].endswith("finished")

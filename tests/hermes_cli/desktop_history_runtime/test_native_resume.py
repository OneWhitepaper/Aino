"""An isolated Codex home must resume selected rollouts without a copied SQLite DB."""

import json

import pytest

from tests.hermes_cli.desktop_history_runtime.test_migration import THREAD, migrate, rollout, row, workfile


@pytest.mark.parametrize("archive", [False, True])
def test_pinned_codex_resumes_original_thread_without_source_index(homes, tmp_path, request, archive):
    binary = request.config.getoption("--code-history-codex")
    if binary is None:
        pytest.skip("supply --code-history-codex to run the offline native engine probe")
    from agent.transports.codex_app_server import CodexAppServerClient

    source, target = homes
    generated = workfile(source, "result.txt")
    native = rollout(source, cwd=generated.parent, archive=archive)
    with native.open("a") as handle:
        for payload in (
            {"type": "task_started", "turn_id": "turn-one", "model_context_window": 258400,
             "collaboration_mode_kind": "default"},
            {"type": "user_message", "message": "remember amber", "images": [], "local_images": [],
             "text_elements": []},
            {"type": "agent_message", "message": "amber remembered", "phase": "final_answer"},
            {"type": "task_complete", "turn_id": "turn-one", "last_agent_message": "amber remembered"},
        ):
            handle.write(json.dumps({"timestamp": "2026-11-23T10:00:01Z", "type": "event_msg",
                                     "payload": payload}) + "\n")
    rows, _manifest = migrate(source, target, [row(cwd=generated.parent)])
    code_home = target / "code"
    assert list(code_home.glob("*.sqlite*")) == []
    client = CodexAppServerClient(
        codex_bin=binary, codex_home=str(code_home), inherit_credentials=False,
        env={"HOME": str(tmp_path), "XDG_CONFIG_HOME": str(tmp_path / "config")},
        extra_args=["-c", 'model_provider="aino_code"', "-c", 'model="gpt-5.1-codex"',
                    "-c", 'model_providers.aino_code.name="Recovery probe"',
                    "-c", 'model_providers.aino_code.base_url="http://127.0.0.1:9/v1"',
                    "-c", 'model_providers.aino_code.wire_api="responses"',
                    "-c", "analytics.enabled=false", "-c", "feedback.enabled=false"],
    )
    try:
        client.initialize()
        result = client.request("thread/resume", {"threadId": THREAD, "cwd": rows[0]["cwd"],
                                                  "modelProvider": "aino_code"}, timeout=15)
        assert result["thread"]["id"] == THREAD
        assert result["thread"]["cwd"] == rows[0]["cwd"]
        assert "remember amber" in str(result["thread"]["turns"])
    finally:
        client.close()

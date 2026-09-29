"""``delegation.compression_threshold_tokens`` is an OPTIONAL absolute cap on a subagent's compaction
trigger, off by default, and its value is validated rather than coerced.

Default off: a 1M-window child compacts at the same 0.50 x window as its parent (500K). A replay of a
1,393-agent run put 200K-400K caps within 5% of each other once cache prefixes are intact, and every
compaction is a chance to lose detail, so the cap is opt-in. The validation matters because YAML
``true`` coerces to int 1 (a one-token trigger) and ``"200k"`` would silently read as no cap.
"""
from types import SimpleNamespace

from agent.context_compressor import ContextCompressor
from tools.delegate_tool import _apply_child_compression_cap, _child_compression_cap_tokens


def _child(window=1_000_000, threshold=0.50, cap=None):
    cc = ContextCompressor(model="anthropic/claude-fable-5.1", threshold_percent=threshold,
                           config_context_length=window, threshold_tokens_cap=cap)
    return SimpleNamespace(context_compressor=cc)


def test_default_is_no_cap_child_keeps_the_ratio_trigger():
    child = _child()
    _apply_child_compression_cap(child, {})
    assert child.context_compressor.threshold_tokens == 500_000
    _apply_child_compression_cap(child, {"compression_threshold_tokens": 0})
    assert child.context_compressor.threshold_tokens == 500_000


def test_explicit_cap_is_the_lower_of_delegation_and_global_and_never_raises():
    child = _child()
    _apply_child_compression_cap(child, {"compression_threshold_tokens": 300_000})
    assert child.context_compressor.threshold_tokens == 300_000
    child = _child(cap=150_000)
    _apply_child_compression_cap(child, {"compression_threshold_tokens": 200_000})
    assert child.context_compressor.threshold_tokens == 150_000
    small = _child(window=128_000)
    before = small.context_compressor.threshold_tokens
    _apply_child_compression_cap(small, {"compression_threshold_tokens": 200_000})
    assert small.context_compressor.threshold_tokens == before  # cap above the ratio trigger: no effect


def test_config_values_are_validated_not_coerced():
    """Independent-review witnesses: YAML ``true`` -> int 1 (a one-token trigger) and ``"200k"`` -> silently
    disabled. Both are ignored with a warning; the child keeps the ratio trigger."""
    for bad in (True, "200k", 5, 15_999, -1, 1.5):
        assert _child_compression_cap_tokens(bad) is None, bad
    for off in (None, 0, False):
        assert _child_compression_cap_tokens(off) is None
    assert _child_compression_cap_tokens(16_000) == 16_000
    assert _child_compression_cap_tokens(300_000.0) == 300_000
    child = _child()
    _apply_child_compression_cap(child, {"compression_threshold_tokens": True})
    assert child.context_compressor.threshold_tokens == 500_000


def test_real_child_cap_routes_profile_usage_and_preserves_parent_and_recent_evidence(tmp_path, monkeypatch):
    """A→B→A uses real config and preflight; only the summary network is replaced.

    The synthetic summary proves wiring and protected-tail preservation, not the
    semantic quality of information compressed out of the middle.
    """
    import copy
    import json
    from pathlib import Path
    import socket

    from agent.secret_scope import is_multiplex_active, set_multiplex_active
    from agent.turn_preflight import compress_after_tool_results
    from agent.turn_usage import record_response_usage
    import agent.context_compressor as compressor_module
    from gateway.run import _profile_runtime_scope
    from run_agent import AIAgent
    from tools.delegate_tool import _build_child_agent

    home_a = tmp_path / ".hermes"
    home_b = home_a / "profiles" / "baseline"
    home_b.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home_a))
    child_cap, parent_cap = 96_000, 256_000
    model, endpoint = "gpt-5.6-sol", "http://127.0.0.1:9/v1"
    for home, cap in ((home_a, child_cap), (home_b, 0)):
        (home / "config.yaml").write_text(json.dumps({
            "model": {"default": model, "provider": "openrouter", "base_url": endpoint,
                      "context_length": 1_000_000},
            "compression": {"enabled": True, "threshold": 0.5, "threshold_tokens": parent_cap},
            "delegation": {"compression_threshold_tokens": cap},
            "terminal": {"backend": "local", "cwd": str(tmp_path)},
            "auxiliary": {"compression": {"provider": "auto", "context_length": 1_000_000}},
        }), encoding="utf-8")

    def deny_network(*args, **kwargs):
        raise AssertionError("offline child-cap test forbids network connections")

    monkeypatch.setattr(socket.socket, "connect", deny_network)
    monkeypatch.setattr(socket.socket, "connect_ex", deny_network)
    summary_calls = []

    def summary_only(**kwargs):
        assert kwargs["task"] == "compression"
        summary_calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(
            message=SimpleNamespace(content="Historical work summarized for an offline wiring test.",
                                    reasoning_content=None), finish_reason="stop")])

    monkeypatch.setattr(compressor_module, "call_llm", summary_only)
    was_multiplexed = is_multiplex_active()
    set_multiplex_active(True)
    try:
        for home, expected in ((home_a, child_cap), (home_b, parent_cap), (home_a, child_cap)):
            with _profile_runtime_scope(home):
                parent = AIAgent(api_key="offline-placeholder", base_url=endpoint, provider="openrouter",
                                 api_mode="chat_completions", model=model, platform="cli", quiet_mode=True,
                                 skip_context_files=True, skip_memory=True, save_trajectories=False,
                                 enabled_toolsets=["file"])
                child = None
                try:
                    parent_before = (parent.context_compressor.threshold_tokens,
                                     parent.context_compressor.last_prompt_tokens, parent.session_api_calls)
                    assert parent_before == (parent_cap, 0, 0)
                    child = _build_child_agent(task_index=0, goal="Review evidence without changing files",
                                               context=None, toolsets=["file"], model=None, max_iterations=4,
                                               task_count=1, parent_agent=parent)
                    compressor = child.context_compressor
                    assert compressor.threshold_tokens == expected
                    compressor.update_model(model=model, context_length=1_000_000, base_url=endpoint,
                                            api_key=child.api_key, provider=child.provider, api_mode=child.api_mode)
                    assert compressor.threshold_tokens == expected
                    task = "Inspect every source and preserve unverified claims as uncertain."
                    messages = [{"role": "user", "content": task}]
                    for index in range(18):
                        call_id = f"read-{index}"
                        messages.extend([
                            {"role": "assistant", "content": None, "tool_calls": [
                                {"id": call_id, "type": "function", "function": {
                                    "name": "read_file", "arguments": json.dumps({"path": f"source-{index}.py"})}}]},
                            {"role": "tool", "tool_call_id": call_id, "name": "read_file",
                             "content": "historical source evidence " * 1300},
                        ])
                    messages[-1]["content"] = "Critical recent evidence: the opaque helper does not establish a defect."
                    before = copy.deepcopy(messages)
                    calls_before = len(summary_calls)
                    for usage, should_compress in ((child_cap - 5000, False),
                                                   (child_cap + 5000, expected == child_cap)):
                        response = SimpleNamespace(usage={
                            "prompt_tokens": usage, "completion_tokens": 100, "total_tokens": usage + 100,
                            "prompt_tokens_details": {"cached_tokens": usage // 2},
                        })
                        record_response_usage(child, response, messages=messages, api_call_count=1,
                                              api_duration=0.01, compression_attempts=0, max_compression_attempts=3)
                        assert compressor.last_prompt_tokens == usage
                        verdict = compress_after_tool_results(
                            child, messages=messages, system_message=None, user_message=task,
                            active_system_prompt="evidence-only", conversation_history=None,
                            compression_attempts=0, max_compression_attempts=3, effective_task_id="cap-contract",
                            final_response=None, turn_exit_reason=None)
                        assert verdict.compression_attempts == int(should_compress)
                        assert len(summary_calls) == calls_before + int(should_compress)
                        if should_compress:
                            assert len(verdict.messages) < len(messages)
                            assert any(m.get("role") == "user" and task in str(m.get("content"))
                                       for m in verdict.messages)
                            assert any(m.get("content") == before[-1]["content"] for m in verdict.messages)
                            assert any(tc["id"] == "read-17" for m in verdict.messages for tc in m.get("tool_calls", []))
                        else:
                            assert verdict.messages is messages
                        assert messages == before
                    assert (parent.context_compressor.threshold_tokens,
                            parent.context_compressor.last_prompt_tokens, parent.session_api_calls) == parent_before
                    assert getattr(parent, "_usage_anchor", None) is None
                finally:
                    if child is not None:
                        child.close()
                    parent.close()
    finally:
        set_multiplex_active(was_multiplexed)

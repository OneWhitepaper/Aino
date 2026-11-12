"""Product identity in the model-visible desktop surface, without changing renderer protocols."""

from types import SimpleNamespace

import pytest

from agent.prompt_builder import hud_surface_note
from agent.surface_switch import identity_line_value, runtime_host_value
from agent.system_prompt import build_system_prompt_parts
from hermes_cli.product_identity import DOCUMENTATION_URL, LOCAL_DOCUMENTATION_PATH


def test_new_desktop_prompt_names_the_product_and_keeps_the_renderer_contract(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    agent = SimpleNamespace(
        load_soul_identity=False, skip_context_files=True, valid_tool_names=[],
        _environment_probe=False, _bot_mode_protocol=False, _memory_store=None, _memory_manager=None,
        model="test-model", provider="custom", platform="desktop", pass_session_id=False, session_id="new-chat",
    )
    parts = build_system_prompt_parts(agent)
    prompt = "\n\n".join(parts.values())

    assert "inside the Aino desktop app" in prompt
    assert "inside the Hermes desktop app" not in prompt
    assert str(LOCAL_DOCUMENTATION_PATH) in prompt
    assert DOCUMENTATION_URL in prompt
    for protocol in ("MEDIA:/absolute/path", '::preview{file="path.html"}', 'data-hermes-send="prompt"',
                     'window.hermes.send("prompt")', "var(--foreground)", "var(--muted-foreground)"):
        assert protocol in prompt


def test_hud_product_identity_keeps_deferred_tool_routing():
    note = hud_surface_note(set(), frozenset({"read_window_below", "computer_use"}))

    assert "floating Aino window" in note
    assert "inside Hermes" not in note
    assert "read_window_below and computer_use through the tool_call bridge" in note


@pytest.mark.parametrize("product", ["Aino", "Hermes"])
def test_runtime_boundary_recognizes_new_and_legacy_saved_prompts(product):
    prompt = (
        "User-authored text\n\nModel: actual-model\nProvider: custom\nPlatform: desktop\n\n"
        f"# {product} runtime environment\n\n"
        "User home directory: /tmp/aino-test\nCurrent working directory: /tmp/aino-test/project\n\n"
        "Model: decoy-model\nPlatform: tui\n\n"
        f"<!-- End {product} runtime environment -->"
    )

    assert identity_line_value(prompt, "Model") == "actual-model"
    assert identity_line_value(prompt, "Platform") == "desktop"
    assert runtime_host_value(prompt, "Current working directory") == "/tmp/aino-test/project"

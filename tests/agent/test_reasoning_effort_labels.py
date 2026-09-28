"""#61634: ``ultra`` is Hermes-internal and every wire clamps it; the display label used by the
effort pickers and ``/reasoning`` status must say what the route really sends, and that
``ultra`` runs as multi-agent collaboration."""
from agent.reasoning_effort import effort_display_label


def test_clamped_level_label_names_the_wire_level():
    assert effort_display_label("max", "openai-codex", "gpt-5.5") == "max (sends xhigh on this route)"
    assert effort_display_label("ultra", "openai-codex", "gpt-5.6-sol") == "ultra (multi-agent, sends max on this route)"
    assert effort_display_label("ultra", "openai-codex", "gpt-5.5") == "ultra (multi-agent, sends xhigh on this route)"
    assert (
        effort_display_label("ultra", "openrouter", "anthropic/claude-opus-4.5")
        == "ultra (multi-agent, sends max on this route)"
    )


def test_supported_level_label_is_the_level_itself():
    assert effort_display_label("max", "openai-codex", "gpt-5.6-sol") == "max"
    assert effort_display_label("high", None, None) == "high"
    assert effort_display_label("", None, None) == ""

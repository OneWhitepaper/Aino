"""#61634: ``ultra`` is Hermes-internal and every wire clamps it; the display label used by the
effort pickers and ``/reasoning`` status must say what the route really sends, and that
``ultra`` runs as multi-agent collaboration."""
import pytest

from agent.reasoning_effort import clamp_effort, effort_display_label, route_supported_efforts


@pytest.mark.parametrize(
    ("requested", "provider", "model"),
    [
        ("max", "openai-codex", "gpt-5.5"),
        ("ultra", "openai-codex", "gpt-5.6-sol"),
        ("ultra", "openai-codex", "gpt-5.5"),
        ("ultra", "openrouter", "anthropic/claude-opus-4.5"),
    ],
)
def test_clamped_label_discloses_wire_effort_and_ultra_mode(requested, provider, model):
    wire_effort = clamp_effort(requested, route_supported_efforts(provider, model))
    assert wire_effort != requested

    label = effort_display_label(requested, provider, model)

    assert label.startswith(requested)
    assert f"sends {wire_effort}" in label
    assert ("multi-agent" in label) == (requested == "ultra")


def test_supported_level_label_is_the_level_itself():
    assert effort_display_label("max", "openai-codex", "gpt-5.6-sol") == "max"
    assert effort_display_label("high", None, None) == "high"
    assert effort_display_label("", None, None) == ""

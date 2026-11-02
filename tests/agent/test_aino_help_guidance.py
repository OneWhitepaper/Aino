"""New Aino conversations use product-owned help without dangling skill tools."""

import pytest

from tests.agent.test_system_prompt import _make_agent, _prompt_parts


@pytest.mark.parametrize("skill_tools", [False, True])
def test_new_conversation_help_uses_aino_docs_with_available_skill_pointer(monkeypatch, skill_tools):
    from agent import system_prompt

    monkeypatch.setattr(system_prompt, "_skills_prompt", lambda _agent: "- hermes-agent: Runtime help")
    tools = ["skill_view"] if skill_tools else []
    stable = _prompt_parts(_make_agent(valid_tool_names=tools))["stable"]

    assert "https://github.com/OneWhitepaper/Aino/tree/main/website/docs" in stable
    assert "local checkout" in stable
    assert "https://hermes-agent.nousresearch.com/docs" not in stable
    assert ("skill_view(name='hermes-agent')" in stable) is skill_tools

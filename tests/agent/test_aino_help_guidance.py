"""New Aino conversations use product-owned help without dangling skill tools."""

import pytest

from tests.agent.test_system_prompt import _make_agent, _prompt_parts


@pytest.mark.parametrize("skill_tools", [False, True])
def test_new_conversation_help_uses_aino_docs_with_available_skill_pointer(monkeypatch, skill_tools):
    from agent import system_prompt
    from hermes_cli.product_identity import DOCUMENTATION_URL, LOCAL_DOCUMENTATION_PATH

    monkeypatch.setattr(system_prompt, "_skills_prompt", lambda _agent: "- hermes-agent: Runtime help")
    tools = ["skill_view"] if skill_tools else []
    stable = _prompt_parts(_make_agent(valid_tool_names=tools))["stable"]

    assert DOCUMENTATION_URL in stable
    assert str(LOCAL_DOCUMENTATION_PATH) in stable
    assert (LOCAL_DOCUMENTATION_PATH / "README.md").is_file()
    assert "https://hermes-agent.nousresearch.com/docs" not in stable
    assert ("skill_view(name='hermes-agent')" in stable) is skill_tools

"""Aino connection cards and tool availability honor the selected ConfigBackend."""

import pytest

from tests.plugins.config_backends.test_remote_backend import plane

__all__ = ["plane"]


def test_remote_config_change_reprobes_future_tool_assemblies(plane):
    from hermes_cli.config import read_raw_config
    from hermes_cli.config_backend import get_config_backend
    from tools.registry import ToolRegistry

    plane.profile("default").update(values={"sample_enabled": False}, version=1)
    probes = []

    def available():
        probes.append(True)
        return read_raw_config().get("sample_enabled") is True

    registry = ToolRegistry()
    registry.register(name="remote_sample", toolset="sample", schema={"name": "remote_sample"},
                      handler=lambda args: "{}", check_fn=available)
    prior = registry.get_definitions({"remote_sample"}, quiet=True)
    assert prior == []
    assert registry.get_definitions({"remote_sample"}, quiet=True) == []
    assert len(probes) == 1

    plane.profile("default").update(values={"sample_enabled": True}, version=2)
    backend = get_config_backend()
    assert backend.poll_one(backend._state(plane.home))
    current = registry.get_definitions({"remote_sample"}, quiet=True)

    assert current[0]["function"]["name"] == "remote_sample"
    assert len(probes) == 2 and prior == []
    assert not (plane.home / "config.yaml").exists()


@pytest.mark.parametrize("locked", [False, True])
def test_custom_mcp_install_uses_remote_config_and_restores_secrets_on_refusal(plane, locked):
    from hermes_cli.config import get_env_value
    from hermes_cli.config_backend import ConfigLockedError
    from tools.connectors.custom_mcp import _persist_install

    plane.profile("default").update(values={"mcp_servers": {"existing": {"command": "existing-mcp"}}}, version=1)
    if locked:
        plane.upper_locks = [{"path": "mcp_servers.docs", "level": "tenant"}]
    env_path = plane.home / ".env"
    env_path.write_text("# preserve me\nEXISTING_TOKEN=original\n", encoding="utf-8")
    before = env_path.read_bytes()
    config = {"command": "docs-mcp", "env": {"CUSTOM_DOCS_TOKEN": "${CUSTOM_DOCS_TOKEN}"}}
    secrets = {"CUSTOM_DOCS_TOKEN": "approved-card-secret"}

    if locked:
        with pytest.raises(ConfigLockedError):
            _persist_install("docs", config, secrets)
        assert env_path.read_bytes() == before
        assert get_env_value("CUSTOM_DOCS_TOKEN") is None
        assert plane.patches() == []
        assert "docs" not in plane.profile("default")["values"]["mcp_servers"]
    else:
        _persist_install("docs", config, secrets)
        stored = plane.profile("default")["values"]["mcp_servers"]
        assert stored == {"existing": {"command": "existing-mcp"}, "docs": config}
        assert get_env_value("CUSTOM_DOCS_TOKEN") == secrets["CUSTOM_DOCS_TOKEN"]
        assert len(plane.patches()) == 1
    assert not (plane.home / "config.yaml").exists()

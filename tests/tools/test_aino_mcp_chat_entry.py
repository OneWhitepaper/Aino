"""Aino MCP proposals stay independent of hosted account eligibility."""

import json

import pytest

from tools.connectors.tool import manage_connections
from tools.registry import registry


def test_local_management_tool_survives_hosted_account_unavailability(monkeypatch):
    from tools.registry import invalidate_check_fn_cache

    monkeypatch.setattr("tools.connectors.gateway.config.connectors_available", lambda: False)
    invalidate_check_fn_cache()
    try:
        names = {item["function"]["name"] for item in registry.get_definitions(["manage_connections"])}
        assert "manage_connections" in names
        result = json.loads(registry.dispatch("manage_connections", {"action": "status"}))
        assert "not available" in result["error"]
    finally:
        invalidate_check_fn_cache()


def test_custom_remote_proposal_reaches_existing_approval_without_hosted_lookup(monkeypatch):
    from tools.connectors import tool

    calls = []
    config = {"url": "https://example.test/mcp", "auth": "oauth", "timeout": 1200}
    monkeypatch.setattr(tool, "run_mcp_operation", lambda names, action, **kw: calls.append(
        (names, action, kw.get("server_configs"))) or json.dumps({"status": "pending"}))
    result = json.loads(manage_connections({
        "action": "install",
        "connectors": [{"name": "example", "mcp": True, "config": config}],
    }, connection_callback=lambda _: None))
    assert result == {"status": "pending"}
    assert calls == [(["example"], "install", {"example": config})]


def test_custom_config_cannot_be_smuggled_into_hosted_action():
    result = json.loads(manage_connections({
        "action": "connect",
        "connectors": [{"name": "example", "config": {"url": "https://example.test/mcp"}}],
    }))
    assert "mcp" in result["error"].lower()


def test_repeated_name_cannot_replace_the_config_shown_on_the_card():
    result = json.loads(manage_connections({
        "action": "install",
        "connectors": [
            {"name": "example", "mcp": True, "config": {"url": "https://one.test/mcp"}},
            {"name": "example", "mcp": True, "config": {"url": "https://two.test/mcp"}},
        ],
    }))
    assert "duplicate" in result["error"].lower()

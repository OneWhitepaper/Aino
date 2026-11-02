"""Account image models use the existing profile-scoped tool configuration API."""

import json

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from agent.image_gen_registry import register_provider
    from hermes_cli.web_routers import tools
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from plugins.image_gen.aino import AinoImageGenProvider

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "config.yaml").write_text(json.dumps({"image_gen": {"provider": "aino"}}))
    register_provider(AinoImageGenProvider())
    row = AinoImageGenProvider().get_setup_schema()
    monkeypatch.setattr(tools, "_category_providers", lambda *_a: [row])
    test = TestClient(app)
    test.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return test


def test_remote_account_catalog_selection_is_saved_and_read_back(client):
    selected = client.put("/api/tools/toolsets/image_gen/model", json={
        "provider": "Aino", "model": "allowed-image-catalog-id"})
    assert selected.status_code == 200, selected.text
    listed = client.get("/api/tools/toolsets/image_gen/models?provider=Aino")
    assert listed.status_code == 200, listed.text
    assert listed.json()["current"] == "allowed-image-catalog-id"
    invalid = client.put("/api/tools/toolsets/image_gen/model", json={
        "provider": "Aino", "model": "not/a/catalog-id"})
    assert invalid.status_code == 400


def test_provider_matrix_exposes_stable_plugin_identity(client, monkeypatch):
    from hermes_cli import tools_config
    from plugins.image_gen.aino import AinoImageGenProvider

    monkeypatch.setattr(tools_config, "_visible_providers", lambda *_a, **_k: [AinoImageGenProvider().get_setup_schema()])
    matrix = client.get("/api/tools/toolsets/image_gen/config")
    assert matrix.status_code == 200, matrix.text
    assert matrix.json()["providers"][0]["image_gen_plugin_name"] == "aino"

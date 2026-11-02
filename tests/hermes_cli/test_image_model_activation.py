"""Selecting an image model can explicitly activate its provider in one profile write."""

from copy import deepcopy
import json
from pathlib import Path

import hermes_yaml as yaml
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(params=["default", "work"])
def image_settings(request, tmp_path, monkeypatch):
    from agent.image_gen_registry import register_provider
    from hermes_cli import config, tools_config_providers
    from hermes_cli.web_routers import tools
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN, app
    from plugins.image_gen.aino import AinoImageGenProvider

    default = tmp_path / ".hermes"
    work = default / "profiles" / "work"
    work.mkdir(parents=True)
    homes = {"default": default, "work": work}
    for name, home in homes.items():
        (home / "config.yaml").write_text(json.dumps({
            "model": {"default": f"{name}-chat"},
            "image_gen": {"provider": "nous", "model": "previous-image", "use_gateway": True}}))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(homes[request.param]))
    from agent import secret_scope
    from tui_gateway import launch_profile_policy
    monkeypatch.setattr(secret_scope, "_MULTIPLEX_ACTIVE", False)
    monkeypatch.setattr(launch_profile_policy, "_snapshot", None)
    provider = AinoImageGenProvider()
    register_provider(provider)
    rows = [provider.get_setup_schema()]
    monkeypatch.setattr(tools, "_category_providers", lambda *_a: rows)
    monkeypatch.setattr(tools_config_providers, "_visible_providers", lambda *_a, **_kw: rows)
    writes = []

    def save(document):
        writes.append(deepcopy(document))
        config.save_config(document)

    monkeypatch.setattr(tools, "save_config", save)
    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return client, homes, writes


def test_explicit_activation_commits_provider_and_model_once_in_the_selected_profile(image_settings):
    client, homes, writes = image_settings
    before = (homes["default"] / "config.yaml").read_text()
    response = client.put("/api/tools/toolsets/image_gen/model?profile=work", json={
        "provider": "Aino", "model": "selected-image", "activate": True})

    assert response.status_code == 200, response.text
    image = yaml.safe_load((homes["work"] / "config.yaml").read_text())["image_gen"]
    assert image["provider"] == "aino"
    assert image["model"] == "selected-image"
    assert "use_gateway" not in image
    assert len(writes) == 1
    assert writes[0]["image_gen"] == image
    assert writes[0]["model"]["default"] == "work-chat"
    assert (homes["default"] / "config.yaml").read_text() == before


@pytest.mark.parametrize("activate", [None, False])
def test_legacy_model_selection_does_not_activate_a_provider(image_settings, activate):
    client, homes, writes = image_settings
    body = {"provider": "Aino", "model": "selected-image"}
    if activate is not None:
        body["activate"] = activate
    response = client.put("/api/tools/toolsets/image_gen/model?profile=work", json=body)

    assert response.status_code == 200, response.text
    image = yaml.safe_load((homes["work"] / "config.yaml").read_text())["image_gen"]
    assert image == {"provider": "nous", "model": "selected-image", "use_gateway": True}
    assert len(writes) == 1


@pytest.mark.parametrize("body", [
    {"provider": "Aino", "model": "invalid/catalog/id", "activate": True},
    {"provider": "Unknown", "model": "selected-image", "activate": True},
    {"model": "selected-image", "activate": True},
])
def test_failed_activation_never_writes_either_selection(image_settings, body):
    client, homes, writes = image_settings
    path = homes["work"] / "config.yaml"
    document = yaml.safe_load(path.read_text())
    document["image_gen"]["provider"] = "aino"
    path.write_text(json.dumps(document))
    before = {name: (home / "config.yaml").read_text() for name, home in homes.items()}

    response = client.put("/api/tools/toolsets/image_gen/model?profile=work", json=body)

    assert response.status_code == 400, response.text
    assert writes == []
    assert {name: (home / "config.yaml").read_text() for name, home in homes.items()} == before

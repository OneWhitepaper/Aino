"""Catalog discovery and local installation state belong to the requested profile."""

from pathlib import Path

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient


@pytest.fixture
def catalog_client(tmp_path, monkeypatch):
    from hermes_cli import plugins_cmd_catalog
    from hermes_constants import get_hermes_home

    launch_home = tmp_path / ".hermes"
    named_home = launch_home / "profiles" / "worker"
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(launch_home))
    for home in (launch_home, named_home):
        plugin = home / "plugins" / "profile-owned"
        plugin.mkdir(parents=True)
        (home / "config.yaml").write_text("{}\n", encoding="utf-8")
        (plugin / "plugin.yaml").write_text(
            "name: profile-owned\nversion: '1.0'\ndescription: Profile fixture\n",
            encoding="utf-8",
        )

    def catalog_state(installed):
        return {
            "home": str(get_hermes_home()),
            "plugin_dir": installed["profile-owned"]["dir"],
        }

    monkeypatch.setattr(plugins_cmd_catalog, "installed_catalog_state", catalog_state)
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return client, launch_home, named_home


def test_catalog_discovery_uses_requested_profile_and_restores_launch_home(catalog_client):
    client, launch_home, named_home = catalog_client

    for params, home in (({}, launch_home), ({"profile": "worker"}, named_home), ({}, launch_home)):
        response = client.get("/api/dashboard/plugins/catalog", params=params)

        assert response.status_code == 200, response.text
        assert response.json() == {
            "home": str(home),
            "plugin_dir": str(home / "plugins" / "profile-owned"),
        }


def test_catalog_unknown_profile_preserves_scope_404(catalog_client):
    client, _, _ = catalog_client

    response = client.get("/api/dashboard/plugins/catalog", params={"profile": "missing"})

    assert response.status_code == 404, response.text
    assert "missing" in response.json()["detail"]

"""Explicit model routes remain authoritative while default catalogs stay available."""

import json


def _configure(raw):
    from hermes_constants import get_hermes_home

    (get_hermes_home() / "config.yaml").write_text(json.dumps(raw), encoding="utf-8")


def test_custom_catalog_failure_never_falls_back_to_upstream(monkeypatch):
    from hermes_cli import model_catalog

    custom = "https://models.example.test/catalog.json"
    _configure({"model_catalog": {"url": custom}})
    requests = []

    def failed(url, _timeout):
        requests.append(url)

    monkeypatch.setattr(model_catalog, "_fetch_manifest", failed)
    assert model_catalog.get_catalog(force_refresh=True) == {}
    assert requests == [custom]


def test_configured_nous_inference_keeps_its_explicit_route():
    from hermes_cli.runtime_provider import resolve_runtime_provider

    _configure({"model": {"provider": "nous"}})
    runtime = resolve_runtime_provider(
        requested="nous", explicit_api_key="user-provided-key",
        explicit_base_url="https://inference.example.test/v1", target_model="example/model",
    )
    assert runtime["provider"] == "nous"
    assert runtime["api_key"] == "user-provided-key"
    assert runtime["base_url"] == "https://inference.example.test/v1"


def test_explicit_portal_recommendations_preserve_provider_route(monkeypatch):
    from hermes_cli import models

    requests = []
    expected = {"paidRecommendedModel": {"modelName": "example/model"}}

    def fetch(url, **_kwargs):
        requests.append(url)
        return expected

    monkeypatch.setattr(models, "_get_json", fetch)
    assert models.fetch_nous_recommended_models("https://portal.example.test", force_refresh=True) == expected
    assert requests == ["https://portal.example.test/api/nous/recommended-models"]

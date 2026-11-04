"""Aino telemetry consent reaches non-file ConfigBackends as one atomic answer."""

import pytest

from tests.plugins.config_backends.test_remote_backend import _tui_server, plane

__all__ = ["plane"]


def test_remote_consent_records_aino_recipient_and_destination(plane, monkeypatch):
    from hermes_cli.observability.shared_metrics_consent import consent_state
    from hermes_cli.observability.shared_metrics_send_config import DEFAULT_ENDPOINT

    plane.profile("default").update(values={"telemetry": {"shared_metrics": {
        "enabled": True, "send": True, "recipient": "nous", "endpoint": "https://old.example/metrics"}}}, version=1)
    server = _tui_server(monkeypatch, plane.home)
    recorded = []
    monkeypatch.setattr("hermes_cli.setup._record_send_consent_change", lambda **kw: recorded.append(kw))

    answer = server._methods["shared_metrics.set"](1, {"enabled": True, "send": True, "recipient": "aino"})

    stored = plane.profile("default")["values"]
    assert answer["result"] == consent_state(stored)
    assert answer["result"]["send"] is True and answer["result"]["decided"] is True
    assert stored["telemetry"]["shared_metrics"]["recipient"] == "aino"
    assert stored["telemetry"]["shared_metrics"]["endpoint"] == DEFAULT_ENDPOINT
    assert len(plane.patches()) == 1 and recorded == [{"enabled": True}]
    assert not (plane.home / "config.yaml").exists()


@pytest.mark.parametrize("locked", ["recipient", "endpoint"])
def test_remote_locked_aino_destination_refuses_the_entire_opt_in(plane, monkeypatch, locked):
    plane.upper = {"telemetry": {"shared_metrics": {"enabled": False, "send": False}}}
    plane.upper_locks = [{"path": f"telemetry.shared_metrics.{locked}", "level": "tenant"}]
    server = _tui_server(monkeypatch, plane.home)
    recorded = []
    monkeypatch.setattr("hermes_cli.setup._record_send_consent_change", lambda **kw: recorded.append(kw))

    answer = server._methods["shared_metrics.set"](1, {"enabled": True, "send": True, "recipient": "aino"})

    assert answer["error"]["code"] == 4002
    assert plane.patches() == [] and recorded == []
    assert plane.profile("default")["values"] == {}

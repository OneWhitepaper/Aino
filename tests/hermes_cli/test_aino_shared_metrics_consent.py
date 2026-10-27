"""A recipient change requires fresh consent; Nous consent never authorizes Aino."""

from hermes_cli.observability.shared_metrics_consent import consent_state, set_answer
from hermes_cli.observability.shared_metrics_send_config import resolve_send_config


def test_nous_opt_in_cannot_send_to_aino_before_a_new_answer():
    config = {"telemetry": {"shared_metrics": {
        "enabled": True, "send": True, "offer_version": 2,
        "endpoint": "https://telemetry.nousresearch.com/v1/telemetry",
    }}}
    assert resolve_send_config(config).send is False
    state = consent_state(config)
    assert state["send"] is False
    assert state["decided"] is False
    assert state["reask"] is True


def test_new_aino_answer_retargets_the_legacy_default_and_leaves_opt_out_off():
    config = {"telemetry": {"shared_metrics": {
        "enabled": True, "send": True, "offer_version": 2,
        "endpoint": "https://telemetry.nousresearch.com/v1/telemetry",
    }}}
    set_answer(config, True, True)
    resolved = resolve_send_config(config)
    assert resolved.send is True
    assert resolved.endpoint == "https://api.agentera.com.cn/api/v1/desktop/shared-metrics"
    assert consent_state(config)["recipient"] == "aino"
    set_answer(config, False, False)
    assert resolve_send_config(config).send is False
    assert consent_state(config)["decided"] is True


def test_aino_consent_cannot_authorize_an_unrelated_remote_destination():
    config = {"telemetry": {"shared_metrics": {
        "enabled": True, "send": True, "recipient": "aino", "offer_version": 2,
        "endpoint": "https://unrelated.example/metrics",
    }}}
    assert resolve_send_config(config).send is False
    assert consent_state(config)["send"] is False
    set_answer(config, True, True)
    assert resolve_send_config(config).send is True
    assert resolve_send_config(config).endpoint == "https://api.agentera.com.cn/api/v1/desktop/shared-metrics"


def test_an_old_recipient_window_does_not_qualify_an_install_receipt(tmp_path, monkeypatch):
    from hermes_cli.observability.shared_metrics import SharedMetricsStore
    from hermes_cli.observability.shared_metrics_install_run import consented_day

    monkeypatch.setattr("hermes_cli.config.read_raw_config_readonly", lambda: {
        "telemetry": {"shared_metrics": {"enabled": True, "send": True, "recipient": "aino"}},
    })
    root = tmp_path / "telemetry" / "shared_metrics"
    store = SharedMetricsStore(root / "metrics.sqlite3", root / "outbox")
    with store._connection() as db:
        db.execute("INSERT INTO send_consent_windows(opened_at,last_confirmed_at) VALUES(?,?)",
                   ("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"))
    assert consented_day(tmp_path) is False


def test_legacy_send_windows_never_release_history_to_the_new_recipient(tmp_path):
    from datetime import UTC, datetime

    from hermes_cli.observability.shared_metrics import SharedMetricsStore
    from hermes_cli.observability.shared_metrics_sender import CONSENT_GATE_SQL, reconcile_send_consent

    store = SharedMetricsStore(tmp_path / "metrics.sqlite3", tmp_path / "outbox")
    with store._connection() as db:
        # A real pre-Aino store has no recipient on its still-open interval.
        db.execute("INSERT INTO send_consent_windows(opened_at,last_confirmed_at) VALUES(?,?)",
                   ("2026-10-01T00:00:00Z", "2026-10-10T00:00:00Z"))
        db.execute("INSERT INTO package_outbox(package_id,period_start,period_end,payload_json,created_at) VALUES(?,?,?,?,?)",
                   ("old", "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z", "{}", "2026-10-03T00:00:00Z"))
        reconcile_send_consent(db, True, now=datetime(2026, 10, 27, tzinfo=UTC))
        released = db.execute("SELECT package_id FROM package_outbox WHERE " + CONSENT_GATE_SQL).fetchall()
        assert released == []
        windows = db.execute("SELECT recipient,closed_at FROM send_consent_windows ORDER BY rowid").fetchall()
        assert windows[0][0] is None and windows[0][1] is not None
        assert windows[1][0] == "aino" and windows[1][1] is None

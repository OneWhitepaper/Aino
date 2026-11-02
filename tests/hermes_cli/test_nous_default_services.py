"""Default service availability follows the existing guest and entitlement contracts."""

import json


def test_default_guest_is_available_and_explicit_guest_opt_out_still_wins(monkeypatch, tmp_path):
    from hermes_cli import anon_auth
    from hermes_constants import get_hermes_home
    from tests.hermes_cli.anon_portal import install_portal

    portal = install_portal(monkeypatch, tmp_path)
    config_path = get_hermes_home() / "config.yaml"
    config_path.write_text("{}\n", encoding="utf-8")

    assert anon_auth.guest_allowed()
    assert anon_auth.is_guest_state(anon_auth.ensure_portal_identity(explicit=True))
    assert portal.creates() == 1
    config_path.write_text(json.dumps({"nous": {"guest": False}}), encoding="utf-8")
    assert not anon_auth.guest_allowed()
    assert anon_auth.ensure_portal_identity(explicit=True) is None
    assert portal.creates() == 1


def test_managed_service_availability_tracks_actual_account_entitlement(monkeypatch):
    from hermes_cli.nous_account import NousPortalAccountInfo
    from tools.tool_backend_helpers import managed_nous_tools_enabled

    def account(entitled):
        return NousPortalAccountInfo(
            logged_in=True, source="account_api", fresh=True, paid_service_access=entitled,
        )

    monkeypatch.setattr("hermes_cli.nous_account.get_nous_portal_account_info", lambda: account(True))
    assert managed_nous_tools_enabled()
    monkeypatch.setattr("hermes_cli.nous_account.get_nous_portal_account_info", lambda: account(False))
    assert not managed_nous_tools_enabled()

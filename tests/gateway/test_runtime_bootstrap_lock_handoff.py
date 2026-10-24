"""Boot retries a reservation freed between the failed acquire and its holder probe."""
from types import SimpleNamespace

import pytest

import gateway.run_bootstrap as bootstrap
from gateway.runtime_ownership import OwnershipConflict, ProfileOwnership
from hermes_state_reconcile import BROWSE_RECONCILE_PURPOSE


def test_boot_reserves_a_profile_freed_before_the_conflicting_holder_probe(tmp_path, monkeypatch):
    home = tmp_path / "profile"
    holder = ProfileOwnership()
    booting = ProfileOwnership()
    probe = bootstrap._conflicting_homes
    holder.reserve([home], purpose=BROWSE_RECONCILE_PURPOSE)

    def release_before_probe(homes):
        holder.close()
        return probe(homes)

    monkeypatch.setattr(bootstrap, "_conflicting_homes", release_before_probe)
    try:
        bootstrap._reserve_waiting_out_browse_reconcile(booting, [home])
        assert booting.owns(home)
    finally:
        holder.close()
        booting.close()


def test_boot_still_obeys_its_deadline_when_conflicts_keep_disappearing(tmp_path, monkeypatch):
    clock = SimpleNamespace(now=0.0)

    class RacyOwnership:
        def reserve(self, homes):
            assert clock.now < 3.0, "reservation kept retrying after its deadline"
            clock.now += 0.75
            raise OwnershipConflict("holder changed during reservation")

    monkeypatch.setattr(bootstrap.time, "monotonic", lambda: clock.now)
    monkeypatch.setattr(bootstrap, "_conflicting_homes", lambda homes: [])
    with pytest.raises(OwnershipConflict):
        bootstrap._reserve_waiting_out_browse_reconcile(RacyOwnership(), [tmp_path / "profile"], wait_s=1.0)
    assert clock.now >= 1.0

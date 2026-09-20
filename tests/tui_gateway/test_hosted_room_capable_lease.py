"""A process without a live participant must not reserve another owner's queue."""
import time

from gateway import hosted_room_driver as state
from tests.tui_gateway.test_hosted_room_driver_runtime import (
    BINDING, FakeSessionRPC, _admit, _identity, _runtime, db,
)


class OwnerUnavailableRPC(FakeSessionRPC):
    def check_available(self):
        raise RuntimeError('participant runtime requires its owner to reconnect')


def test_unavailable_process_cannot_hold_idle_or_queued_room_from_capable_owner(db):
    unavailable = _runtime(db, OwnerUnavailableRPC(), lease_ttl_seconds=60)
    capable_rpc = FakeSessionRPC()
    capable = _runtime(db, capable_rpc, lease_ttl_seconds=60)
    unavailable._process_room(BINDING)
    identity = _identity()
    _admit(db, identity)
    unavailable._process_room(BINDING)
    assert state.get_task(db, identity)['status'] == 'queued'
    capable._process_room(BINDING)
    assert state.get_task(db, identity)['status'] == 'settled'
    assert len([call for call in capable_rpc.calls if call[0] == 'submit']) == 1
    assert not unavailable.rpc.calls


def test_owner_reconnect_releases_unavailable_lease_then_can_execute_again(db):
    unavailable = _runtime(db, OwnerUnavailableRPC(), lease_ttl_seconds=60)
    capable = _runtime(db, FakeSessionRPC(), lease_ttl_seconds=60)
    # A previously capable process may already hold a valid idle lease when its owner leaves.
    unavailable._ensure_lease(BINDING)
    identity = _identity()
    _admit(db, identity)
    unavailable._process_room(BINDING)
    capable._process_room(BINDING)
    assert state.get_task(db, identity)['status'] == 'settled'
    capable._process_room(BINDING)
    unavailable.rpc = FakeSessionRPC()
    # Advance the injected driver clock past availability backoff, not the live lease TTL.
    unavailable.clock = lambda: time.time() + 2
    next_identity = _identity('after-reconnect')
    _admit(db, next_identity)
    unavailable._process_room(BINDING)
    assert state.get_task(db, next_identity)['status'] == 'settled'

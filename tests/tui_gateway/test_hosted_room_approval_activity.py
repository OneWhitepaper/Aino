"""Pending room approvals display only for their durable current attempt."""
from pathlib import Path
import time

import pytest

from gateway import hosted_room_driver as driver, hosted_rooms
from gateway.hosted_room_peer import GatewayRoomCatalog, catalog_mapping
from tui_gateway.hosted_room_peer_transport import PeerMemberRoute
from tui_gateway.hosted_room_service import HostedRoomService
from tests.tui_gateway.test_hosted_room_service import _server, _FakeRPC, _ApprovalPeerClient


def _start_approval_attempt(service, identity, *, member, profile, generation=1):
    """An approval belongs to a durable live attempt, including replacement generations."""
    db = service.db_path
    binding = next(b for b in service.bindings() if b.room_id == identity.room_id)
    driver.admit_task(db, identity, payload={'target_member_id': member, 'target_profile': profile,
                      'source_event_seq': 1, 'prompt': 'approval fixture'}, clock=time.time)
    lease = driver.acquire_lease(db, room_id=identity.room_id, gateway_id=binding.gateway_id,
        authority_epoch=binding.authority_epoch, process_generation='approval-test',
        ttl_seconds=30, clock=time.time)
    for index in range(generation):
        attempt = driver.start_task(db, identity, lease, expected_cancel_generation=0, clock=time.time)
        if index + 1 < generation:
            driver.requeue_not_admitted_task(db, attempt, clock=time.time)


def test_peer_approval_is_scoped_visible_and_resolvable(tmp_path: Path):
    db = tmp_path / "state.db"
    catalog = GatewayRoomCatalog.from_mapping(
        catalog_mapping(target_profile="default", installation_id="install-peer", persistent_process=True)
    )
    route = PeerMemberRoute(
        home_install_id=hosted_rooms.local_authority_gateway_id(),
        member_id="member-peer",
        target_install_id="install-peer",
        target_profile="reviewer",
        capability_digest=catalog.catalog_digest,
        cancellation_scope_id="cancel-room-1",
        trace_id="trace-room-1",
        grant="signed.room.grant",
    )
    peer = _ApprovalPeerClient()
    service = HostedRoomService(_server(), db_path=db)
    service.register_peer_route(
        room_id="room-1",
        member_id="member-peer",
        route=route,
        client=peer,
        target_url="https://peer.example.test",
        catalog=catalog,
    )
    service.create_room(
        room_id="room-1",
        name="Peer room",
        members=[
            {
                "member_id": "default",
                "profile": "default",
                "handle": "hermes",
            },
            {
                "member_id": "member-peer",
                "profile": "reviewer",
                "handle": "reviewer",
                "target": {
                    "kind": "peer",
                    "peer_id": "peer-review",
                    "installation_id": "install-peer",
                    "profile": "reviewer",
                    "capability_digest": catalog.catalog_digest,
                },
            }
        ],
    )
    identity = driver.TaskIdentity("room-1", "task-1", "thread-1", "turn-1")
    _start_approval_attempt(service, identity, member='member-peer', profile='reviewer', generation=2)
    transport = service._resolve_member_transport(
        service.bindings()[0],
        {
            "identity": identity,
            "execution_generation": 2,
            "payload": {
                "target_member_id": "member-peer",
                "target_profile": "reviewer",
                "source_event_seq": 1,
            },
        },
    )

    status = transport.info(
        profile="reviewer",
        session_id="peer-group-session",
        source="bot_room",
    )
    assert status["status"] == "waiting_for_approval"
    service._set_pending_action(
        "room-1",
        "member-peer",
        {
            "kind": "approval",
            "task_id": status["task_id"],
            "execution_generation": status["execution_generation"],
            "run_id": status["run_id"],
            "session_id": "peer-group-session",
            "request_id": "req-peer-1",
            "approval": status["approval"],
        },
    )
    pending = service.status("room-1")["pending_actions"]
    assert pending == [
        {
            "kind": "approval",
            "task_id": "task-1",
            "execution_generation": 2,
            "run_id": "run-peer-1",
            "session_id": "peer-group-session",
            "request_id": "req-peer-1",
            "approval": {
                "description": "Run the focused tests",
                "command": "pytest -q tests/focused",
                "choices": ["once", "deny"],
            },
            "member_id": "member-peer",
        }
    ]

    assert service.approve_room_task(
        "room-1",
        member_id="member-peer",
        task_id="task-1",
        execution_generation=2,
        choice="once",
        request_id="req-peer-1",
    ) == {"resolved": 1}
    assert peer.approvals == [
        {
            "task_id": "task-1",
            "execution_generation": 2,
            "request_id": "req-peer-1",
            "choice": "once",
            "grant": "signed.room.grant",
        }
    ]
    assert service.status("room-1")["pending_actions"] == []


def test_stale_local_approval_cannot_resolve_replacement_request(tmp_path: Path):
    service = HostedRoomService(_server(), db_path=tmp_path / "state.db")
    service.local_profiles = lambda: ('default', 'other')
    rpc = _FakeRPC()
    service.rpc = rpc
    service.runtime.rpc = rpc
    service.create_room(room_id='room-1', name='Room', members=[
        {'member_id': 'local', 'profile': 'default', 'handle': 'local'},
        {'member_id': 'other', 'profile': 'other', 'handle': 'other'}])
    _start_approval_attempt(service, driver.TaskIdentity('room-1', 'task-local-1', 'thread', 'turn'),
                            member='local', profile='default')
    action = {
        "kind": "approval",
        "task_id": "task-local-1",
        "execution_generation": 1,
        "session_id": "local-session",
        "approval": {"choices": ["once", "deny"]},
    }
    service._set_pending_action(
        "room-1", "local", {**action, "request_id": "approval-A"}
    )
    service._set_pending_action(
        "room-1", "local", {**action, "request_id": "approval-B"}
    )

    with pytest.raises(RuntimeError, match="no longer pending"):
        service.approve_room_task(
            "room-1",
            member_id="local",
            task_id="task-local-1",
            execution_generation=1,
            choice="once",
            request_id="approval-A",
        )

    assert rpc.approvals == []
    assert service.status("room-1")["pending_actions"][0]["request_id"] == (
        "approval-B"
    )

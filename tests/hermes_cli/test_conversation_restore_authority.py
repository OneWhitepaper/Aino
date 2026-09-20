"""Restoring a shared DB preserves discussion history, never its old authority."""
import time
from types import SimpleNamespace

import pytest

from gateway import hosted_rooms, hosted_room_driver as driver
from gateway.hosted_room_links import make_stored_link, save_room_link, load_room_links
from gateway.hosted_room_peer import GatewayRoomCatalog, catalog_mapping, issue_room_grant
from gateway.platforms import api_server_room_grants as room_grants
from hermes_cli.conversation_backup import create_conversation_snapshot
from hermes_cli.conversation_restore import restore_conversation_snapshot
from tests.hermes_cli.test_conversation_backup import _history


def test_restore_revokes_discussion_leases_and_peer_grants(tmp_path, monkeypatch):
    source, _, _, _ = _history(tmp_path, monkeypatch)
    path = source / "shared-state.db"
    now = time.time()
    hosted_rooms.create_room(path, room_id="discussion", name="Discussion",
        members=[{"profile": "writer", "handle": "writer"}], authority_gateway_id="local")
    identity = driver.TaskIdentity("discussion", "task", "thread", "turn")
    driver.admit_task(path, identity, payload={"target_profile": "writer", "prompt": "Previous request", "source_event_seq": 1}, clock=time.time)
    lease = driver.acquire_lease(path, room_id="discussion", gateway_id="local", authority_epoch=1,
        process_generation="old-process", ttl_seconds=30, clock=time.time)
    claims = {"room_id": "remote-discussion", "member_id": "remote", "target_profile": "writer",
              "authority_gateway_id": "peer", "authority_epoch": 1,
              "home_install_id": "peer-install", "target_install_id": hosted_rooms.local_authority_gateway_id()}
    secret = b"isolated-restore-test-signing-key"
    token = issue_room_grant(secret, **claims, grant_id="prior-grant", issued_at=now, ttl_seconds=300)
    adapter = SimpleNamespace(_room_grant_token=room_grants._room_grant_token, _room_grant_secret=lambda: secret)
    request = SimpleNamespace(headers={"Authorization": "HermesRoom " + token})
    hosted_rooms.reserve_peer_room(path, claims=claims, expires_at=now + 300)
    assert hosted_rooms.peer_room_grant_is_current(path, claims=claims)
    assert room_grants._room_grant_claims(adapter, request, permission="status")["room_id"] == claims["room_id"]
    save_room_link(path, make_stored_link(room_id="discussion", member_id="remote",
        target_url="https://peer.example.test", target_profile="writer", grant=token,
        catalog=GatewayRoomCatalog.from_mapping(catalog_mapping(installation_id="peer", persistent_process=True)),
        cancellation_scope_id="cancel", trace_id="trace"))
    snapshot, target = tmp_path / "snapshot", tmp_path / "restored"
    create_conversation_snapshot(source, snapshot)
    restore_conversation_snapshot(snapshot, target)
    restored = target / "shared-state.db"
    monkeypatch.setenv("HERMES_HOME", str(target))
    assert not hosted_rooms.peer_room_grant_is_current(restored, claims=claims)
    with pytest.raises(room_grants.RoomGrantReauthorizationRequired):
        room_grants._room_grant_claims(adapter, request, permission="status")
    link = load_room_links(restored)[0]
    assert link.status == "needs_reauthorization" and link.grant == ""
    task = driver.get_task(restored, identity)
    assert task["status"] == "indeterminate" and task["execution_generation"] > 0
    assert all(task[key] is None for key in ("run_gateway_id", "run_process_generation", "run_lease_generation"))
    assert driver.list_tasks(path, room_id="discussion")[0]["status"] == "queued"

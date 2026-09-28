"""A delegation copy the gateway drops must hand its in-memory offer back.

``sweep_orphaned_completions`` skips any row whose offer is still registered, so a copy discarded
without handing the offer back strands that row for the rest of the process's life: no other
consumer can be handed it again. The gateway drains the same process-global completion queue as the
TUI poller and runs its own sweep, so the handback matters on this side too.

Three shapes drop a copy without requeueing it: nothing renders, this lifecycle already delivered
(or is delivering) the identity, and a sibling another consumer owns. Requeued copies must NOT be
handed back — they still have a live copy, and the sweep's SQL only excludes rows under a live
claim, so handing those back would offer a second copy of one result.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from gateway.config import Platform
from gateway.run import GatewayRunner
from tools import async_delegation
from tools.process_registry import ProcessRegistry

HOME_KEY = "gateway-offer-test"


def _runner():
    runner = object.__new__(GatewayRunner)
    runner._running = True
    runner.adapters = {Platform.TELEGRAM: AsyncMock()}
    runner.session_store = SimpleNamespace(_ensure_loaded=lambda: None, _entries={})
    runner._session_source_cache = {}
    delimiter = __import__("threading").Lock()
    runner._completion_delivery_lock = delimiter
    runner._completion_deliveries_inflight = set()
    runner._completion_deliveries_delivered = OrderedDict()
    runner._completion_delivery_retention = 2048
    runner._background_tasks = set()
    return runner


def _delegation(delegation_id: str) -> dict:
    return {
        "type": "async_delegation",
        "delegation_id": delegation_id,
        "session_key": "agent:main:telegram:dm:12345:678",
        "goal": "Investigate flaky test",
        "status": "completed",
        "summary": "Found it",
        "api_calls": 1,
        "duration_seconds": 12.0,
    }


@pytest.fixture()
def offered(monkeypatch):
    """Register a live offer the way ``_replay_pending`` does, so ``return_completion_offer`` clears it."""
    monkeypatch.setattr(async_delegation, "get_hermes_home", lambda: HOME_KEY)
    with async_delegation._orphan_lock:
        async_delegation._offered.clear()
    monkeypatch.setattr("gateway.run._format_gateway_process_notification", lambda evt: "rendered text")

    def register(delegation_id: str) -> None:
        with async_delegation._orphan_lock:
            async_delegation._offered.add((HOME_KEY, delegation_id))

    def is_offered(delegation_id: str) -> bool:
        with async_delegation._orphan_lock:
            return any(key[1] == delegation_id for key in async_delegation._offered)

    yield SimpleNamespace(register=register, is_offered=is_offered)
    with async_delegation._orphan_lock:
        async_delegation._offered.clear()


def test_an_already_delivered_identity_hands_its_offer_back(offered):
    """This lifecycle already delivered it, so the copy here is gone — the sweep must be free to reoffer."""
    event = _delegation("deleg_delivered_here")
    offered.register(event["delegation_id"])
    runner = _runner()
    runner._completion_deliveries_delivered[runner._completion_delivery_identity(event)] = True

    result = asyncio.run(runner._deliver_async_delegation_group([event]))

    assert result is None
    assert not offered.is_offered(event["delegation_id"])


def test_an_unrenderable_delegation_hands_its_offer_back(offered, monkeypatch):
    """No text means no delivery and this branch never requeues, so nothing keeps the copy alive."""
    event = _delegation("deleg_unrenderable")
    offered.register(event["delegation_id"])
    monkeypatch.setattr("gateway.run._format_gateway_process_notification", lambda evt: "")
    runner = _runner()

    result = asyncio.run(runner._deliver_async_delegation_group([event]))

    assert result is None
    assert not offered.is_offered(event["delegation_id"])


def test_an_api_delivery_origin_hands_back_the_offers_it_cannot_render(offered, monkeypatch):
    """The API-origin branch returns True without requeueing, so an unrendered copy is dropped there too."""
    event = _delegation("deleg_api_unrendered")
    event["origin_session_id"] = "opaque-client-session"
    offered.register(event["delegation_id"])
    monkeypatch.setattr("gateway.run._format_gateway_process_notification", lambda evt: "")
    runner = _runner()

    result = asyncio.run(runner._deliver_async_delegation_group([event]))

    assert result is True
    assert not offered.is_offered(event["delegation_id"])

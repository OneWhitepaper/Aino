"""Rejected legacy batches recover durably without reidentifying offline operations."""
import copy
import uuid

import pytest

from hermes_state import SessionDB
from hermes_state_cloud_sync import get_meta, put_meta
from hermes_cli.cloud_sync_engine import STATE_KEY
from tests.hermes_cli.test_cloud_sync import call, seed, Cloud


def legacy_batch(home):
    for i in range(3):
        with seed(home, sid=f'offline-{i}'):
            pass
    prepared = call(home, 'prepare', request_id=str(uuid.uuid4()))
    # Persist the preparation shape written by the previous 16-operation release.
    with SessionDB(home / 'state.db') as db:
        def legacy(conn):
            state = get_meta(conn, STATE_KEY)
            state['preparation']['exchange']['operations'] = copy.deepcopy(state['outbox'])
            put_meta(conn, STATE_KEY, state)
            return state['preparation']
        prepared = db._execute_write(legacy)
    assert len(prepared['exchange']['operations']) == 3
    return prepared


def test_legacy_batch_recovery_keeps_operation_ids_payloads_and_rejects_stale_response(tmp_path):
    home = tmp_path / 'device'
    legacy = legacy_batch(home)
    expected = legacy['exchange']['operations']
    recovered = call(home, 'rebatch', request_id=legacy['request_id'])
    assert recovered['request_id'] != legacy['request_id']
    assert recovered['exchange']['operations'] == expected[:1]
    # Every call opens a fresh SessionDB; simulate losing the recovery response before restart.
    assert call(home, 'rebatch', request_id=legacy['request_id']) == recovered
    assert call(home, 'prepare', request_id=str(uuid.uuid4())) == recovered
    cloud = Cloud()
    with pytest.raises(ValueError, match='preparation'):
        call(home, 'apply', request_id=legacy['request_id'], response=cloud.exchange(legacy['exchange']))
    seen = []
    for operation in expected:
        prepared = call(home, 'prepare', request_id=str(uuid.uuid4()))
        assert prepared['exchange']['operations'] == [operation]
        response = cloud.exchange(prepared['exchange'])
        seen.extend(r['operation_id'] for r in response['results'])
        result = call(home, 'apply', request_id=prepared['request_id'], response=response)
        assert not result['status']['issues']
    assert seen == [op['operation_id'] for op in expected]
    assert result['status']['pending'] == 0


def test_rebatch_never_discards_a_persisted_response(tmp_path):
    home = tmp_path / 'device'
    legacy = legacy_batch(home)
    response = Cloud().exchange(legacy['exchange'])
    # A prior apply with a blocked record retains the exact response.
    with SessionDB(home / 'state.db') as db:
        def retain(conn):
            state = get_meta(conn, STATE_KEY)
            state['preparation']['response'] = response
            put_meta(conn, STATE_KEY, state)
        db._execute_write(retain)
    with pytest.raises(ValueError):
        call(home, 'rebatch', request_id=legacy['request_id'])
    assert call(home, 'prepare', request_id=str(uuid.uuid4()))['pending_response'] == response

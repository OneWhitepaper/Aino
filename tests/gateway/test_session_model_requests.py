"""Conversation model discovery reaches the owning native catalog without exposing credentials."""
import asyncio
import json

import pytest

from tests.gateway.test_session_group_models import OWNER, _connection, _gateway, _members, _prepare, _request
from tests.waiting import wait_until

ROW = {'model_id': 'catalog-deepseek', 'model_source': 'aino', 'provider': 'aino',
       'name': 'DeepSeek Flash', 'owner': OWNER}


async def _start(connection, **params):
    return asyncio.create_task(connection.dispatch({'id': 'discover', 'method': 'model.session', 'params': params}))


async def _finish(task):
    return await task


def _pending(call, viewer, task):
    observed = []

    def find():
        value = _request(call, viewer, 'groups.state', room_id='room')
        observed[:] = value.get('result', {}).get('model_requests', [])
        return bool(observed) or task.done()

    wait_until(find, timeout=5, what='the member catalog request appears on its room')
    assert observed, call(_finish(task))
    return observed[0]


def _group(runner, call):
    viewer = _connection(runner.session_authority)
    made = _request(call, viewer, 'groups.create', room_id='room', name='Room', members=_members('default', 'helper'))
    assert 'result' in made, made
    prepared = _prepare(call, viewer)
    assert 'result' in prepared, prepared
    return viewer, prepared['result']['session_id']


def test_gui_selection_read_is_empty_until_a_native_selection_is_scheduled(tmp_path, monkeypatch):
    with _gateway(tmp_path, monkeypatch, served=()) as (runner, _homes, call):
        viewer = _connection(runner.session_authority)
        created = _request(call, viewer, 'session.create', request_id='gui', source='gui', cwd=str(tmp_path),
                           toolsets=[], model_source='aino', model_id='catalog-one')
        assert 'result' in created, created
        got = _request(call, viewer, 'model.session', session_id=created['result']['session_id'], action='selection')
        assert got.get('result') == {'selection': None}, got
        call(viewer.close())


def test_group_model_select_uses_native_catalog_and_saves_only_conversation_selection(tmp_path, monkeypatch):
    from hermes_state_local import local_receipt
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer, sid = _group(runner, call)
        authority = runner.session_authorities.for_home(homes['helper'])
        cli = _connection(authority, scope='profile')
        original = local_receipt(authority.db, sid)
        configs = {name: (home / 'config.yaml').read_bytes() for name, home in homes.items()}
        task = call(_start(cli, session_id=sid, action='select', query='deepseek flash'))
        request = _pending(call, viewer, task)
        assert request['session_id'] == sid and request['member_id'] == 'helper'
        assert request['profile'] == 'helper' and request['query'] == 'deepseek flash'
        assert set(request) == {'request_id', 'session_id', 'profile', 'room_id', 'member_id', 'action', 'query'}
        answered = _request(call, viewer, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                            result={'status': 'selected', 'selection': ROW})
        assert answered.get('result') == {'accepted': True}, answered
        chosen = call(_finish(task))
        assert chosen.get('result') == {'status': 'scheduled', 'effective': 'next_message', 'selection': ROW}, chosen
        current = _request(call, cli, 'model.session', session_id=sid, action='selection')
        assert current.get('result') == {'selection': ROW}, current
        assert local_receipt(authority.db, sid) == original, 'the in-flight policy must stay untouched'
        assert {name: (home / 'config.yaml').read_bytes() for name, home in homes.items()} == configs
        state = _request(call, viewer, 'groups.state', room_id='room')['result']
        assert not state.get('model_requests')
        for connection in (viewer, cli):
            call(connection.close())


@pytest.mark.parametrize('foreign', ['other_socket', 'other_owner'])
def test_only_original_room_viewer_can_answer_catalog_request(tmp_path, monkeypatch, foreign):
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer, sid = _group(runner, call)
        target = runner.session_authorities.for_home(homes['helper'])
        cli = _connection(target, scope='profile')
        task = call(_start(cli, session_id=sid, action='list'))
        request = _pending(call, viewer, task)
        other = _connection(runner.session_authority, user='foreign' if foreign == 'other_owner' else 'desktop')
        denied = _request(call, other, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                          result={'status': 'available', 'models': [ROW]})
        assert 'error' in denied, denied
        answered = _request(call, viewer, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                            result={'status': 'available', 'models': [ROW]})
        assert answered.get('result') == {'accepted': True}, answered
        assert call(_finish(task)).get('result') == {'status': 'available', 'models': [ROW]}
        for connection in (viewer, cli, other):
            call(connection.close())


@pytest.mark.parametrize('corruption', ['api_key', 'owner', 'member', 'epoch'])
def test_native_model_result_rejects_secrets_and_stale_room_authority(tmp_path, monkeypatch, corruption):
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer, sid = _group(runner, call)
        target = runner.session_authorities.for_home(homes['helper'])
        cli = _connection(target, scope='profile')
        task = call(_start(cli, session_id=sid, action='select', query='DeepSeek'))
        request = _pending(call, viewer, task)
        authority = runner.session_authority
        row = dict(ROW)
        if corruption == 'api_key':
            row['api_key'] = 'never-expose-secret'
        elif corruption == 'owner':
            authority.db._execute_write(lambda conn: conn.execute('UPDATE state_meta SET value=? WHERE key=?',
                ('someone-else', 'gateway.hosted.owner.v1:room')))
        elif corruption == 'epoch':
            authority.db._execute_write(lambda conn: conn.execute(
                'UPDATE hosted_rooms SET authority_epoch=authority_epoch+1 WHERE room_id=?', ('room',)))
        else:
            authority.db._execute_write(lambda conn: conn.execute('UPDATE hosted_rooms SET members_json=? WHERE room_id=?',
                (json.dumps(_members('default')), 'room')))
        refused = _request(call, viewer, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                           result={'status': 'selected', 'selection': row})
        assert 'error' in refused, refused
        assert 'never-expose-secret' not in json.dumps(refused)
        if corruption == 'api_key':
            # The closed wire contract rejects it before the handler; the rightful viewer can answer again.
            clean = _request(call, viewer, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                             result={'status': 'unavailable'})
            assert clean.get('result') == {'accepted': True}, clean
        answer = call(_finish(task))
        assert answer.get('result', {}).get('status') == 'unavailable' or 'error' in answer, answer
        with target.db._read_ctx() as conn:
            config = json.loads(conn.execute('SELECT model_config FROM sessions WHERE id=?', (sid,)).fetchone()[0] or '{}')
        assert not config.get('conversation_model_selection')
        for connection in (viewer, cli):
            call(connection.close())


@pytest.mark.parametrize('profile', ['default', 'helper'])
def test_profile_qualified_model_selection_routes_to_the_exact_served_gui_session(tmp_path, monkeypatch, profile):
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, _homes, call):
        viewer = _connection(runner.session_authority)
        created = _request(call, viewer, 'session.create', profile=profile, request_id='gui', source='gui',
                           cwd=str(tmp_path), toolsets=[], model_source='aino', model_id='catalog-one')['result']
        got = _request(call, viewer, 'model.session', profile=profile,
                       session_id=created['session_id'], action='selection')
        assert got.get('result') == {'selection': None}, got
        call(viewer.close())


def test_physical_session_segment_resolves_only_its_exact_canonical_conversation(tmp_path, monkeypatch):
    from gateway.session_contract import SessionRef
    from hermes_state_local import local_receipt
    with _gateway(tmp_path, monkeypatch, served=()) as (runner, _homes, call):
        authority = runner.session_authority
        viewer = _connection(authority)
        made = _request(call, viewer, 'session.create', request_id='gui', source='gui', cwd=str(tmp_path),
                        toolsets=[], model_source='aino', model_id='catalog-one')['result']
        sid = made['session_id']
        handle = authority._handle(SessionRef(authority.profile_id, sid))
        reset = _request(call, viewer, 'session.mutate', session_id=sid, operation='reset', payload={},
                         request_id='reset', expected_revision=handle.revision,
                         expected_generation=handle.execution_generation)
        assert 'result' in reset, reset
        segment = local_receipt(authority.db, sid)['entry']['session_id']
        assert segment != sid
        got = _request(call, viewer, 'model.session', session_id=segment, action='selection')
        assert got.get('result') == {'selection': None}, got
        call(viewer.close())


def _gui(call, authority, tmp_path):
    viewer = _connection(authority)
    viewer.transport.frames = []

    def write(frame):
        viewer.transport.frames.append(frame)
        return True
    viewer.transport.write = write
    viewer.transport.close = lambda: None
    created = _request(call, viewer, 'session.create', request_id='native-gui', source='gui', cwd=str(tmp_path),
                       toolsets=[], model_source='aino', model_id='catalog-one')['result']
    sid = created['session_id']
    assert 'result' in _request(call, viewer, 'session.resume', session_id=sid)
    return viewer, sid


def _gui_request(call, viewer, task):
    wait_until(lambda: any(frame.get('method') == 'model.session' for frame in viewer.transport.frames) or task.done(),
               timeout=5, what='the native viewer receives its own session catalog request')
    frames = [frame for frame in viewer.transport.frames if frame.get('method') == 'model.session']
    assert frames, call(_finish(task))
    return frames[-1]


def test_gui_native_selection_is_scheduled_without_changing_inflight_route(tmp_path, monkeypatch):
    from hermes_state_local import local_receipt
    with _gateway(tmp_path, monkeypatch, served=()) as (runner, _homes, call):
        authority = runner.session_authority
        viewer, sid = _gui(call, authority, tmp_path)
        cli = _connection(authority, scope='profile')
        before = local_receipt(authority.db, sid)
        task = call(_start(cli, session_id=sid, action='select', query='deepseek flash'))
        frame = _gui_request(call, viewer, task)
        assert frame['params']['session_id'] == sid
        assert frame['params']['profile'] == 'default'
        call(viewer.dispatch({'id': frame['id'], 'result': {'status': 'selected', 'selection': ROW}}))
        answer = call(_finish(task))
        assert answer.get('result') == {'status': 'scheduled', 'effective': 'next_message', 'selection': ROW}, answer
        assert local_receipt(authority.db, sid) == before
        saved = _request(call, cli, 'model.session', session_id=sid, action='selection')
        assert saved.get('result') == {'selection': ROW}, saved
        for connection in (viewer, cli):
            call(connection.close())


def test_newer_manual_gui_model_commit_wins_over_older_native_answer(tmp_path, monkeypatch):
    from gateway.session_contract import SessionRef
    from hermes_state_local import local_receipt
    with _gateway(tmp_path, monkeypatch, served=()) as (runner, _homes, call):
        authority = runner.session_authority
        viewer, sid = _gui(call, authority, tmp_path)
        cli = _connection(authority, scope='profile')
        task = call(_start(cli, session_id=sid, action='select', query='deepseek'))
        frame = _gui_request(call, viewer, task)
        handle = authority._handle(SessionRef(authority.profile_id, sid))
        picked = _request(call, viewer, 'session.mutate', session_id=sid, operation='model',
                          payload={'model': 'catalog-manual', 'model_source': 'aino'},
                          request_id='manual-newer', expected_revision=handle.revision,
                          expected_generation=handle.execution_generation)
        assert 'result' in picked, picked
        call(viewer.dispatch({'id': frame['id'], 'result': {'status': 'selected', 'selection': ROW}}))
        answer = call(_finish(task))
        assert answer.get('error', {}).get('data', {}).get('reason') == 'model_request_expired', answer
        assert local_receipt(authority.db, sid)['policy']['model'] == 'catalog-manual'
        assert _request(call, cli, 'model.session', session_id=sid, action='selection').get('result') == {'selection': None}
        for connection in (viewer, cli):
            call(connection.close())


def test_group_response_from_replaced_viewer_cannot_persist_old_selection(tmp_path, monkeypatch):
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer, sid = _group(runner, call)
        target = runner.session_authorities.for_home(homes['helper'])
        cli = _connection(target, scope='profile')
        task = call(_start(cli, session_id=sid, action='select', query='deepseek'))
        request = _pending(call, viewer, task)
        replacement = _connection(runner.session_authority)
        assert 'result' in _prepare(call, replacement)
        response = _request(call, viewer, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                            result={'status': 'selected', 'selection': ROW})
        # A retired viewer cannot cause a selection to be committed even if its metadata answer arrives.
        assert 'error' in response or response.get('result') == {'accepted': True}, response
        result = call(_finish(task))
        assert result.get('error', {}).get('data', {}).get('reason') == 'model_request_expired', result
        for connection in (viewer, cli, replacement):
            call(connection.close())


def test_group_pending_catalog_request_cancels_when_its_terminal_disconnects(tmp_path, monkeypatch):
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer, sid = _group(runner, call)
        target = runner.session_authorities.for_home(homes['helper'])
        cli = _connection(target, scope='profile')
        task = call(_start(cli, session_id=sid, action='select', query='deepseek'))
        request = _pending(call, viewer, task)
        call(cli.close())
        assert call(_finish(task)).get('result') == {'status': 'unavailable'}
        response = _request(call, viewer, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                            result={'status': 'selected', 'selection': ROW})
        assert response.get('result') == {'accepted': False}, response
        call(viewer.close())


def test_catalog_request_expiry_does_not_save_a_selection(tmp_path, monkeypatch):
    from gateway import session_model_requests
    monkeypatch.setattr(session_model_requests, '_TIMEOUT', 0)
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer, sid = _group(runner, call)
        target = runner.session_authorities.for_home(homes['helper'])
        cli = _connection(target, scope='profile')
        response = _request(call, cli, 'model.session', session_id=sid, action='select', query='deepseek')
        assert response.get('result') == {'status': 'unavailable'}, response
        assert _request(call, viewer, 'groups.state', room_id='room')['result'].get('model_requests') == []
        assert _request(call, cli, 'model.session', session_id=sid, action='selection').get('result') == {'selection': None}
        for connection in (viewer, cli):
            call(connection.close())


def test_a_conversation_has_at_most_one_native_catalog_request(tmp_path, monkeypatch):
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer, sid = _group(runner, call)
        target = runner.session_authorities.for_home(homes['helper'])
        cli = _connection(target, scope='profile')
        task = call(_start(cli, session_id=sid, action='list'))
        request = _pending(call, viewer, task)
        second = _request(call, cli, 'model.session', session_id=sid, action='list')
        assert second.get('error', {}).get('data', {}).get('reason') == 'session_busy', second
        assert _request(call, viewer, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                        result={'status': 'available', 'models': [ROW]}).get('result') == {'accepted': True}
        assert call(_finish(task)).get('result') == {'status': 'available', 'models': [ROW]}
        for connection in (viewer, cli):
            call(connection.close())


def test_native_answer_after_stop_does_not_schedule_a_model_change(tmp_path, monkeypatch):
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer, sid = _group(runner, call)
        target = runner.session_authorities.for_home(homes['helper'])
        cli = _connection(target, scope='profile')
        task = call(_start(cli, session_id=sid, action='select', query='deepseek'))
        request = _pending(call, viewer, task)
        generation = target.db.get_session(sid)['runtime_generation']
        target.delivered_stops[sid] = generation
        assert call(_finish(task)).get('result') == {'status': 'unavailable'}
        assert _request(call, viewer, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                        result={'status': 'selected', 'selection': ROW}).get('result') == {'accepted': False}
        assert _request(call, cli, 'model.session', session_id=sid, action='selection').get('result') == {'selection': None}
        for connection in (viewer, cli):
            call(connection.close())


@pytest.mark.parametrize('change', ['owner', 'member', 'epoch'])
def test_saved_group_selection_refuses_stale_scope_instead_of_using_profile_default(tmp_path, monkeypatch, change):
    from gateway.session_model_requests import selection_for_session
    from hermes_state_runtime import RuntimeStoreError
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        viewer, sid = _group(runner, call)
        target = runner.session_authorities.for_home(homes['helper'])
        cli = _connection(target, scope='profile')
        task = call(_start(cli, session_id=sid, action='select', query='deepseek'))
        request = _pending(call, viewer, task)
        assert _request(call, viewer, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                        result={'status': 'selected', 'selection': ROW}).get('result') == {'accepted': True}
        assert call(_finish(task)).get('result', {}).get('status') == 'scheduled'
        assert selection_for_session(target, sid) == ROW
        source = runner.session_authority
        if change == 'owner':
            source.db._execute_write(lambda conn: conn.execute('UPDATE state_meta SET value=? WHERE key=?',
                ('new-owner', 'gateway.hosted.owner.v1:room')))
        elif change == 'member':
            source.db._execute_write(lambda conn: conn.execute('UPDATE hosted_rooms SET members_json=? WHERE room_id=?',
                (json.dumps(_members('default')), 'room')))
        else:
            source.db._execute_write(lambda conn: conn.execute(
                'UPDATE hosted_rooms SET authority_epoch=authority_epoch+1 WHERE room_id=?', ('room',)))
        with pytest.raises(RuntimeStoreError):
            selection_for_session(target, sid)
        for connection in (viewer, cli):
            call(connection.close())


def test_external_member_discovers_native_models_on_first_turn_without_eager_session_creation(tmp_path, monkeypatch):
    from tui_gateway.hosted_room_driver import HostedRoomBinding
    with _gateway(tmp_path, monkeypatch, served=('helper',)) as (runner, homes, call):
        source = runner.session_authority
        target = runner.session_authorities.for_home(homes['helper'])
        viewer = _connection(source)
        created = _request(call, viewer, 'groups.create', room_id='room', name='Room', members=_members('default', 'helper'))
        assert 'result' in created, created
        inspected = _request(call, viewer, 'groups.prepare_model', room_id='room', member_id='helper', inspect_selection=True)
        assert 'result' in inspected, inspected
        sid = inspected['result']['session_id']
        assert target.db.get_session(sid) is None, 'a catalog grant must preserve lazy profile creation'
        binding = HostedRoomBinding('room', created['result']['room']['authority_gateway_id'], 1)
        rpc = source.hosted_room_service._resolve_member_transport(binding,
            {'payload': {'target_member_id': 'helper', 'target_profile': 'helper'}})
        assert rpc.create(profile='helper', source='bot_room', title='Group: room')['session_id'] == sid
        cli = _connection(target, scope='profile')
        task = call(_start(cli, session_id=sid, action='list'))
        request = _pending(call, viewer, task)
        assert _request(call, viewer, 'groups.model_respond', room_id='room', request_id=request['request_id'],
                        result={'status': 'available', 'models': [ROW]}).get('result') == {'accepted': True}
        assert call(_finish(task)).get('result') == {'status': 'available', 'models': [ROW]}
        for connection in (viewer, cli):
            call(connection.close())

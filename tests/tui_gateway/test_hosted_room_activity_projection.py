"""The existing driver info poll carries only the exact current attempt's redacted activity."""
from pathlib import Path
import threading
from types import SimpleNamespace

from tests.waiting import wait_until
from tui_gateway.hosted_room_service import HostedRoomService


class _ActivityRPC:
    def __init__(self):
        self.sessions = {}
        self.started = threading.Event()
        self.current = {}
        self.on_terminal = None

    def resolve_exact(self, *, profile, title, source):
        return self.sessions.get((profile, title))

    def create(self, *, profile, title, source):
        self.sessions[(profile, title)] = {'session_id': profile + '-session', 'title': title}
        return self.sessions[(profile, title)]

    def resume(self, *, profile, session_id, source):
        return {'session_id': session_id}

    def submit(self, *, task, execution_generation, on_terminal, **kwargs):
        self.on_terminal = on_terminal
        self.current = {'active': True, 'status': 'started', 'task_id': task.task_id,
                        'execution_generation': execution_generation, 'activity': 'reading',
                        'args': {'path': 'private-do-not-publish'}}
        self.started.set()
        return {'accepted': True}

    def history(self, **kwargs):
        return []

    def info(self, **kwargs):
        return dict(self.current)

    def interrupt(self, **kwargs):
        self.current = {'active': False, 'status': 'idle'}
        return {'interrupted': True}


def test_driver_projects_current_activity_and_refuses_mismatched_attempt(tmp_path: Path):
    service = HostedRoomService(SimpleNamespace(_methods={}, _sessions={}, _sessions_lock=threading.Lock()), db_path=tmp_path/'state.db')
    service.rpc = service.runtime.rpc = _ActivityRPC()
    service.local_profiles = lambda: ('default', 'ops')
    service.create_room(room_id='room', name='Room', members=[
        {'member_id': 'default', 'profile': 'default', 'handle': 'default'},
        {'member_id': 'ops', 'profile': 'ops', 'handle': 'ops'}])
    service.start()
    try:
        service.send(room_id='room', event_id='input', payload={'text': '@ops inspect', 'thread_id': 'thread'})
        assert service.rpc.started.wait(5)
        def activities():
            return service.status('room')['member_activity']
        wait_until(lambda: any(x.get('activity') == 'reading' for x in activities()), timeout=5)
        current, = activities()
        assert current['member_id'] == 'ops'
        assert current['task_id'] == service.rpc.current['task_id']
        assert current['execution_generation'] == service.rpc.current['execution_generation']
        assert 'private' not in repr(activities())
        exact_action = {'kind': 'approval', 'member_id': 'ops', 'task_id': current['task_id'],
                        'execution_generation': current['execution_generation']}
        service._set_pending_action('room', 'ops', {**exact_action, 'execution_generation': current['execution_generation'] + 1})
        assert service.status('room')['pending_actions'] == []
        service._set_pending_action('room', 'ops', exact_action)
        assert service.status('room')['pending_actions'][0]['task_id'] == current['task_id']
        exact = dict(service.rpc.current)
        service.rpc.current = {**exact, 'activity': 'editing', 'execution_generation': exact['execution_generation'] + 1}
        wait_until(lambda: all('activity' not in x for x in activities()), timeout=5)
        service.rpc.current = {**exact, 'activity': 'running_command'}
        wait_until(lambda: any(x.get('activity') == 'running_command' for x in activities()), timeout=5)
        service.rpc.on_terminal({'status': 'settled', 'text': 'done'})
        wait_until(lambda: activities() == [], timeout=5)
        assert service.status('room')['working'] is False
        assert service.status('room')['pending_actions'] == []
    finally:
        service.rpc.current = {'active': False, 'status': 'idle'}
        assert service.stop(timeout=5)

"""Shared identities retain exact Profile registrations through real RPC and source DBs."""
from dataclasses import asdict

from tests.tui_gateway.test_conversation_session_binding import runtime_env


def test_shared_project_sources_route_mutations_and_validate_conversations(runtime_env):
    server, _, install, home, root = runtime_env
    from hermes_cli import projects_db
    from tui_gateway.projects_shared import register
    from tui_gateway.conversation_service import ConversationService
    register(server)
    directory = root / 'checkout'
    directory.mkdir()
    def call(method, **params):
        reply = server._methods['projects.shared.' + method]('test', params)
        assert 'error' not in reply, reply
        return reply['result']
    a = call('register', registration_profile='writer', name='Writer project', canonical_path=str(directory))['project']
    b = call('register', registration_profile='reviewer', name='Reviewer project', canonical_path=str(directory))['project']
    assert a['id'] == b['id']
    listed = call('list')['projects']
    assert len(listed) == 1 and {s['registration_profile'] for s in listed[0]['sources']} == {'writer', 'reviewer'}
    source = next(s for s in b['sources'] if s['registration_profile'] == 'writer')
    call('update', shared_project_id=a['id'], source=source, name='Renamed')
    for s in b['sources']:
        with projects_db.connect_closing(home / 'profiles' / s['registration_profile'] / 'projects.db') as conn:
            assert projects_db.get_project(conn, s['project_id']).name == ('Renamed' if s == source else 'Reviewer project')
    assert asdict(ConversationService(server, db_path=home / 'shared-state.db')._project(source)) == source
    forged = {**source, 'install_id': 'foreign-install'}
    assert 'error' in server._methods['projects.shared.update']('bad', {'shared_project_id':a['id'], 'source':forged, 'name':'Forged'})
    assert 'error' in server._methods['projects.shared.register']('bad', {'registration_profile':'writer','name':'Remote','canonical_path':str(directory),'environment_id':'ssh'})
    remaining = call('delete', shared_project_id=a['id'], source=source)['project']
    assert [s['registration_profile'] for s in remaining['sources']] == ['reviewer']
    assert directory.is_dir()
    import pytest
    with pytest.raises(ValueError, match='unavailable'):
        ConversationService(server, db_path=home / 'shared-state.db')._project(source)

    from tui_gateway.transport import bind_transport, reset_transport
    class Viewer:
        auth_identity = {'provider': 'test', 'user_id': 'creator', 'read_only': True}
    token = bind_transport(Viewer())
    try:
        assert 'error' in server._methods['projects.shared.delete']('readonly', {
            'shared_project_id': remaining['id'], 'source': remaining['sources'][0]})
    finally:
        reset_transport(token)
    assert call('resolve', shared_project_id=remaining['id'])['project']['sources'] == remaining['sources']


def test_shared_project_history_filter_keeps_sources_and_pagination(runtime_env):
    server, store, install, home, root = runtime_env
    from gateway.hosted_room_conversation_types import ParticipantRef, ProjectRef
    from tui_gateway.conversation_authority import request_owner_key
    from tui_gateway.conversation_service import ConversationService
    from tui_gateway.projects_shared import SharedProjects
    directory = root / 'history-project'
    directory.mkdir()
    projects = SharedProjects(server)
    first = projects.register('writer', 'Writer', str(directory))['project']['sources'][0]
    indexed = projects.register('reviewer', 'Reviewer', str(directory))['project']
    second = next(s for s in indexed['sources'] if s['registration_profile'] == 'reviewer')
    general = ParticipantRef('general', install, 'default', 'General', True)
    owner = request_owner_key(server)
    for name, source in [('a', first), ('b', second), ('c', {**first, 'install_id': 'other'}),
                         ('d', {**first, 'execution_environment_id': 'ssh'})]:
        store.create(name, name, general, ProjectRef(**source), owner_key=owner)
    service = ConversationService(server, db_path=home / 'shared-state.db')
    page = service.list(project_ref=first, limit=1)
    assert [row['conversation_id'] for row in page['conversations']] == ['a']
    assert page['has_more']
    page = service.list(project_ref=first, limit=1, cursor=page['cursor'])
    assert [row['conversation_id'] for row in page['conversations']] == ['b']
    assert not page['has_more']
    assert page['conversations'][0]['project'] == second

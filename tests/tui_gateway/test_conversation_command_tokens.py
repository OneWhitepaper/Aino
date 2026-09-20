"""Selected Profile expansions remain private and admission consumes exact command proofs."""
import json
import threading
from http.server import HTTPServer

import pytest
import yaml

from tests.tui_gateway.test_conversation_session_binding import runtime_env  # noqa: F401
from tests.tui_gateway.test_conversation_attachments import service_rpc
from tests.tui_gateway.test_conversation_authority import Peer, caller


def _skills(home):
    for profile in ('writer', 'reviewer'):
        root = home / 'profiles' / profile
        skill = root / 'skills' / 'shared-command' / 'SKILL.md'
        skill.parent.mkdir(parents=True)
        skill.write_text(f'---\nname: shared-command\ndescription: Profile-specific method\n---\nPRIVATE-{profile}-BODY\n')
        bundles = root / 'skill-bundles'
        bundles.mkdir()
        (bundles / 'shared-bundle.yaml').write_text('name: shared-bundle\nskills: [shared-command]\n')


def _setup(server, store, home, monkeypatch):
    _skills(home)
    hosted, rpc = service_rpc(server, store, monkeypatch)
    catalog = hosted.conversations.catalog()
    ids = {r['participant']['profile']: r['participant']['participant_id'] for r in catalog}
    for profile in ('writer', 'reviewer'):
        hosted.conversations.create(profile, profile, ids['default'])
        hosted.conversations.prepare(profile, ids[profile])
    return hosted, rpc, ids


def test_resolution_is_profile_scoped_and_token_admission_is_atomic_and_exact(runtime_env, monkeypatch):
    from gateway import hosted_room_driver as driver
    server, store, _install, home, _root = runtime_env
    hosted, rpc, ids = _setup(server, store, home, monkeypatch)
    def resolve(profile, command='/shared-command do work'):
        generation = next(b.session_generation for b in store.participants(profile) if b.participant.participant_id == ids[profile])
        return rpc('command', conversation_id=profile, participant_id=ids[profile], expected_generation=generation,
                   expected_revision=store.get(profile).revision, command=command)['result']
    selected = {p: resolve(p, '/shared-bundle do work') for p in ('writer', 'reviewer')}
    for p, result in selected.items():
        assert result['type'] == 'send' and result['display'] == '/shared-bundle do work'
        assert 'PRIVATE-' not in json.dumps(result)
    current = resolve('writer')
    args = dict(conversation_id='writer', participant_id=ids['writer'], turn_id='t', input_id='i',
                text=current['display'], expected_revision=current['conversation_revision'],
                command_token=current['command_token'])
    for changes in ({'command_token': selected['writer']['command_token']},
                    {'command_token': selected['reviewer']['command_token']}, {'text': 'edited'},
                    {'expected_revision': args['expected_revision'] + 1}):
        assert 'error' in rpc('send', **{**args, **changes})
    with caller(Peer('stranger')):
        assert 'error' in rpc('send', **args)
    original = driver._admit_task_locked
    def reject(*a, **kw):
        raise driver.DriverValidationError('injected admission failure')
    monkeypatch.setattr(driver, '_admit_task_locked', reject)
    assert 'error' in rpc('send', **args)
    assert not store.events('writer').events
    monkeypatch.setattr(driver, '_admit_task_locked', original)
    skill = home / 'profiles' / 'writer' / 'skills' / 'shared-command' / 'SKILL.md'
    skill.write_text(skill.read_text().replace('PRIVATE-writer-BODY', 'CHANGED-BODY'))
    admitted = rpc('send', **args)['result']['admission']
    envelope = store.prepared_input('writer', 'i')
    assert 'PRIVATE-writer-BODY' in envelope.text and 'CHANGED-BODY' not in envelope.text
    assert 'PRIVATE-reviewer-BODY' not in envelope.text
    assert 'PRIVATE-' not in json.dumps(store.events('writer').events)
    assert rpc('send', **args)['result']['admission']['event_id'] == admitted['event_id']
    assert 'error' in rpc('send', **{**args, 'command_token': selected['reviewer']['command_token']})
    assert 'error' in rpc('send', **{**args, 'command_token': None})
    assert 'error' in rpc('send', **{**args, 'input_id': 'other', 'turn_id': 'other'})
    assert store.prepared_input('writer', 'i') == envelope
    retired = selected['reviewer']
    hosted.conversations.refresh('reviewer', ids['reviewer'], 1)
    assert 'error' in rpc('send', conversation_id='reviewer', participant_id=ids['reviewer'], turn_id='r', input_id='r',
        text=retired['display'], expected_revision=retired['conversation_revision'], command_token=retired['command_token'])
    reviewer = resolve('reviewer', '/shared-bundle do work')
    assert 'result' in rpc('send', conversation_id='reviewer', participant_id=ids['reviewer'], turn_id='r', input_id='r',
        text=reviewer['display'], expected_revision=reviewer['conversation_revision'], command_token=reviewer['command_token'])
    assert 'PRIVATE-reviewer-BODY' in store.prepared_input('reviewer', 'r').text
    assert 'PRIVATE-writer-BODY' not in store.prepared_input('reviewer', 'r').text
    # A token cannot retroactively turn an already-admitted literal slash into an expansion.
    hosted.conversations.create('literal', 'literal', ids['default'])
    hosted.conversations.prepare('literal', ids['writer'])
    literal = dict(conversation_id='literal', participant_id=ids['writer'], turn_id='literal', input_id='literal',
                   text='/shared-command do work', expected_revision=store.get('literal').revision)
    assert 'result' in rpc('send', **literal)
    resolved = rpc('command', conversation_id='literal', participant_id=ids['writer'], expected_generation=1,
                   expected_revision=store.get('literal').revision, command=literal['text'])['result']
    assert 'error' in rpc('send', **{**literal, 'expected_revision': resolved['conversation_revision'],
                                    'command_token': resolved['command_token']})


def test_private_skill_body_reaches_only_selected_profile_as_one_cached_user_turn(runtime_env, monkeypatch):
    from tests.agent.test_api_content_sidecar import _MockHandler
    from gateway import hosted_room_driver as driver
    server, store, _install, home, _root = runtime_env
    _MockHandler.captured_requests, _MockHandler.response_queue = [], []
    http = HTTPServer(('127.0.0.1', 0), _MockHandler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    for profile in ('default', 'writer', 'reviewer'):
        path = (home if profile == 'default' else home / 'profiles' / profile) / 'config.yaml'
        cfg = yaml.safe_load(path.read_text())
        cfg['providers']['test']['api'] = f'http://127.0.0.1:{http.server_port}/v1'
        cfg['compression'] = {'enabled': False}
        path.write_text(yaml.safe_dump(cfg))
    hosted, rpc, ids = _setup(server, store, home, monkeypatch)
    try:
        for i, profile in enumerate(('writer', 'reviewer', 'writer')):
            hosted.conversations.prepare('writer', ids[profile])
            revision = store.get('writer').revision
            args = dict(conversation_id='writer', participant_id=ids[profile], turn_id=f't{i}', input_id=f'i{i}',
                        text='Continue', expected_revision=revision)
            if i == 0:
                resolved = rpc('command', conversation_id='writer', participant_id=ids['writer'],
                    expected_generation=1, expected_revision=revision, command='/shared-command execute')['result']
                args.update(text=resolved['display'], command_token=resolved['command_token'])
            assert 'result' in rpc('send', **args)
            hosted.runtime.turn_timeout_seconds = 20
            room = next(b for b in hosted.conversations.bindings() if b.room_id == 'writer')
            hosted.runtime._process_room(room)
            task = next(t for t in driver.list_tasks(store.db_path, room_id='writer') if t['identity'].turn_id == f't{i}')
            assert task['status'] == 'settled', task
            # Settlement precedes callback publication. Reconcile its public
            # event before preparing the next participant against this revision.
            hosted.conversations.prepare_room(room)
            responses = [e for e in store.events('writer').events
                         if e['kind'] == 'conversation.response' and e['payload']['turn_id'] == f't{i}']
            assert len(responses) == 1
            frozen = store.input_for_task(task)
            sid = hosted.conversations._runtime_id(frozen)
            receipt = server._sessions[sid]['agent']._session_db.get_conversation_input_receipt(f'i{i}')
            assert receipt.input_digest == store.prepared_input('writer', f'i{i}').input_digest
        requests = [r for r in _MockHandler.captured_requests if r.get('stream') is True and '<conversation_turn_envelope' in json.dumps(r)]
        assert len(requests) == 3
        assert 'PRIVATE-writer-BODY' in json.dumps(requests[0]['messages'][-1])
        assert 'PRIVATE-writer-BODY' not in json.dumps(requests[1])
        assert requests[0]['messages'][0] == requests[2]['messages'][0]
        assert 'PRIVATE-' not in json.dumps(store.events('writer').events)
    finally:
        http.shutdown()
        thread.join(timeout=3)
        http.server_close()


@pytest.mark.parametrize('pause_at', ['replay', 'admit_turn'])
@pytest.mark.parametrize('proof_kind', ['replaced_token', 'missing_token', 'same_token'])
def test_concurrent_admission_replays_only_its_original_command_proof(runtime_env, monkeypatch, pause_at, proof_kind):
    from gateway import hosted_rooms
    from gateway.hosted_room_conversation_types import TurnSubmission
    from tui_gateway.conversation_commands import ConversationCommands
    from tui_gateway.conversation_service import ConversationService

    server, store, _install, home, _root = runtime_env
    hosted, _rpc, ids = _setup(server, store, home, monkeypatch)
    sender, contender = hosted.conversations, ConversationService(server, db_path=store.db_path)
    coordinates = dict(conversation_id='writer', participant_id=ids['writer'], expected_generation=1,
                       expected_revision=store.get('writer').revision, command='/shared-command do work')
    original = ConversationCommands(sender).execute(**coordinates)
    request = dict(conversation_id='writer', participant_id=ids['writer'], turn_id='race', input_id='race',
                   text=original['display'], expected_revision=original['conversation_revision'],
                   command_token=None if proof_kind == 'missing_token' else original['command_token'])
    winner = []
    proceed = getattr(sender.store, pause_at)

    def interleave(*args, **kwargs):
        if not winner:
            selected = original
            if proof_kind != 'same_token':
                skill = home / 'profiles' / 'writer' / 'skills' / 'shared-command' / 'SKILL.md'
                skill.write_text(skill.read_text().replace('PRIVATE-writer-BODY', 'WINNER-BODY'))
                selected = ConversationCommands(contender).execute(**coordinates)
            winner.append(contender.send(**{**request, 'command_token': selected['command_token']}))
        return proceed(*args, **kwargs)

    monkeypatch.setattr(sender.store, pause_at, interleave)
    if proof_kind == 'same_token':
        replay = sender.send(**request)
        assert replay['admission']['idempotent']
        assert replay['admission']['event_id'] == winner[0]['admission']['event_id']
    else:
        with pytest.raises(hosted_rooms.RoomConflictError):
            sender.send(**request)
        assert 'WINNER-BODY' in store.prepared_input('writer', 'race').text
    assert len(store.events('writer').events) == 1
    with pytest.raises(hosted_rooms.RoomConflictError):
        store.append_input('writer', TurnSubmission('race', 'race', ids['writer'], original['display']))
    # Authenticated reconciliation selects the immutable stored proof, never re-expands it.
    assert contender.retry('writer', 'race', 'race', 0)['admission']['idempotent']

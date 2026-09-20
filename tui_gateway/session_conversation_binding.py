"""Profile-owned sessions for ordinary conversations, with fenced internal submissions.

The shared binding owns identity; Profile SessionDB owns transcript and prompt bytes.
Only the current local backend is supported. No transport-supplied marker grants authority.
"""
from __future__ import annotations

import contextlib
import contextvars
import hashlib
import json
import os
import threading
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from gateway import hosted_room_driver as driver, hosted_rooms
from gateway.hosted_room_conversation_bindings import ConversationBindingError, ConversationBindings
from gateway.hosted_room_conversation_types import ParticipantBinding, ProjectRef

_MARKER = 'conversation_binding'
_pending_creation = contextvars.ContextVar('conversation_session_creation', default=None)
_resolution_lock = threading.RLock()


@dataclass(frozen=True)
class RuntimeBinding:
    conversation_id: str
    participant_id: str
    session_generation: int
    lineage_id: str
    runtime_id: str
    profile: str
    source: str
    model_snapshot: dict[str, Any]


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=False).encode()).hexdigest()


def _prompt_digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _store(server) -> ConversationBindings:
    # The service may serve a non-default authority DB (including an isolated test install).
    explicit = getattr(server, '_conversation_db_path', None)
    service = server.get_hosted_room_service() if not explicit and hasattr(server, 'get_hosted_room_service') else None
    return ConversationBindings(Path(explicit or (service.db_path if service else hosted_rooms.default_db_path())))


def _home(server, session: dict) -> str:
    return str(Path(session.get('profile_home') or server._hermes_home).resolve())


def conversation_metadata(session: dict) -> dict | None:
    value = session.get('_conversation_binding')
    return value if isinstance(value, dict) else None


def attach_pending_conversation(session: dict) -> None:
    pending = _pending_creation.get()
    if pending is not None:
        session['_conversation_binding'] = dict(pending)


def conversation_row_marker(session: dict) -> dict | None:
    if record := conversation_metadata(session):
        return {key: record[key] for key in ('conversation_id', 'participant_id', 'session_generation')}
    return None


def restore_conversation_session(server, session: dict, row: dict | None) -> None:
    marker = server._parse_model_config((row or {}).get('model_config'), quiet=True).get(_MARKER)
    if marker is None:
        return
    if not isinstance(marker, dict):
        raise ConversationBindingError('invalid conversation session marker')
    stored = _store(server).for_session(_home(server, session), str(session['session_key']), marker)
    if stored is None or any(stored.get(k) != marker.get(k) for k in (
            'conversation_id', 'participant_id', 'session_generation')):
        raise ConversationBindingError('conversation generation binding unavailable')
    from .conversation_authority import require_conversation_owner
    from gateway.hosted_room_conversation_owners import ConversationOwnershipError, owner_key
    try:
        caller = require_conversation_owner(server, _store(server).db_path, stored['conversation_id'])
        if caller != owner_key(stored.get('auth_user_id')):
            raise ConversationOwnershipError('participant owner differs from the conversation owner')
    except ConversationOwnershipError as exc:
        raise ConversationBindingError('conversation session belongs to another authenticated user') from exc
    with server._session_db(session) as db:
        if db is None or session['session_key'] not in db.get_compression_chain(stored['lineage_id']):
            raise ConversationBindingError('session is not in the bound compression lineage')
    session['_conversation_binding'] = stored
    session.update(cwd=stored['cwd'], explicit_cwd=True, source=stored['source'],
                   auth_user_id=stored.get('auth_user_id'))
    _restore_model(server, session, stored)
    if session.get('agent') is not None:
        prepare_conversation_agent(server, session, session['agent'])


def _restore_model(server, session, stored):
    snapshot = json.loads(stored['model_snapshot'])
    if not stored.get('capability_digest') and session.get('managed_model_params'):
        # The ticket registry can enrich a draft with its authenticated platform owner.
        # A preparation retry must not erase that live authority with the earlier selection.
        snapshot.update(session['managed_model_params'])
    # Ordinary runtime restoration retains managed-model authorization and resolves credentials afresh.
    overrides = server._stored_session_runtime_overrides({'model': snapshot.get('model'), 'model_config': snapshot})
    session['model_override'] = overrides.get('model_override')
    session['resume_runtime_overrides'] = overrides
    session['managed_model_params'] = overrides.get('managed_model_params')


def _capabilities(agent) -> str:
    return _digest({'tools': getattr(agent, 'tools', None),
                    'ephemeral_system_prompt': getattr(agent, 'ephemeral_system_prompt', None)})


def _model_snapshot(server, agent) -> dict:
    snapshot = server._runtime_model_config(agent)
    snapshot.pop(_MARKER, None)
    # An explicit ordinary tier must not turn into the Profile's current priority on resume.
    snapshot['service_tier'] = getattr(agent, 'service_tier', None) or 'normal'
    return snapshot


def _validate_environment(server, profile_home, project: ProjectRef | None, install_id: str) -> None:
    if install_id != hosted_rooms.local_authority_gateway_id():
        raise ConversationBindingError('participant is unavailable on this backend')
    if project is not None and (project.install_id != install_id or project.execution_environment_id != 'local'):
        raise ConversationBindingError('project execution environment is unavailable on this backend')
    with server._profile_build_scope(profile_home):
        # Use the session's terminal scope, never a Profile-private cwd or a host-only path test for SSH.
        from tools.terminal_scope import terminal_env
        backend = str(terminal_env('TERMINAL_ENV') or server._workdir_terminal_cfg('backend') or 'local').lower()
        if backend != 'local':
            raise ConversationBindingError('conversation sessions require a verified local terminal environment')
        candidate = {'profile_home': str(profile_home) if profile_home else None,
                     'source': 'desktop', 'agent_ready': threading.Event()}
        if server._session_uses_compute_host(candidate, server._load_dashboard_process_isolation_config()):
            raise ConversationBindingError('conversation sessions are unavailable with isolated compute workers')


def _cwd(store, conversation_id: str, project: ProjectRef | None) -> str:
    if project is None:
        # A conversation owns this neutral directory; no participant lends its private workspace.
        path = store.db_path.parent / 'conversation-workspaces' / hashlib.sha256(conversation_id.encode()).hexdigest()
        path.mkdir(parents=True, exist_ok=True)
    else:
        path = Path(project.cwd).expanduser()
        if not path.is_absolute():
            raise ConversationBindingError('project cwd must be absolute')
    path = path.resolve()
    if not path.is_dir() or not os.access(path, os.R_OK | os.W_OK | os.X_OK):
        raise ConversationBindingError('conversation project directory is inaccessible')
    return str(path)


def _call(server, method: str, params: dict) -> dict:
    from tui_gateway.hosted_room_server_rpc import HostedRoomServerRPC
    return HostedRoomServerRPC(server)._call(method, params)


def _model_selection(model_source: str | None, model_id: str | None) -> dict:
    if model_source not in (None, 'aino', 'byok') or (model_source == 'aino' and not model_id):
        raise ConversationBindingError('invalid participant model selection')
    if model_id is not None and (not isinstance(model_id, str) or not model_id.strip() or len(model_id) > 128):
        raise ConversationBindingError('invalid participant model selection')
    return {k: v for k, v in {'model_source': model_source, 'model_id': model_id}.items() if v is not None}


def prepare_conversation_session(server, *, binding: ParticipantBinding,
                                 project: ProjectRef | None, source: str,
                                 model_source: str | None = None, model_id: str | None = None) -> dict:
    """Reserve a durable Profile draft before the owner obtains its managed-model ticket.

    Preparation does not build an agent or claim a persisted system prompt. The ordinary
    authenticated session handlers retain ownership; neither selection nor stored identity
    can manufacture a transport or a model credential.
    """
    if source != 'desktop':
        raise ConversationBindingError('conversation sessions currently require the desktop surface')
    selection = _model_selection(model_source, model_id)
    with _resolution_lock:
        store = _store(server)
        from .conversation_authority import require_conversation_owner
        require_conversation_owner(server, store.db_path, binding.conversation_id, write=True, claim_unowned=True)
        stored = store.resolve(binding, project)
        profile = binding.participant.profile
        profile_home = server._profile_home(profile)
        _validate_environment(server, profile_home, project, binding.participant.install_id)
        cwd = _cwd(store, binding.conversation_id, project)
        if stored:
            if (stored['cwd'], stored['profile_home'], stored['source']) != (
                    cwd, str(Path(profile_home or server._hermes_home).resolve()), source):
                raise ConversationBindingError('generation environment changed; explicitly start a new generation')
            if selection and selection != json.loads(stored.get('selection_json') or '{}'):
                raise ConversationBindingError('participant model selection is fixed; explicitly refresh its generation')
            result = _call(server, 'session.resume', {'session_id': stored['lineage_id'],
                'profile': profile, 'source': source, 'omit_messages': True})
        else:
            marker = {'conversation_id': binding.conversation_id,
                      'participant_id': binding.participant.participant_id,
                      'session_generation': binding.session_generation}
            token = _pending_creation.set(marker)
            try:
                params = {'profile': profile, 'source': source, 'cwd': cwd, 'hidden': True,
                          'title': 'Conversation participant', 'close_on_disconnect': False, **selection}
                if model_id and model_source != 'aino':
                    params['model'] = model_id
                result = _call(server, 'session.create', params)
            finally:
                _pending_creation.reset(token)
        sid = result['session_id']
        with server._sessions_lock:
            session = server._sessions[sid]
        with server._profile_build_scope(profile_home):
            if server._ensure_session_db_row(session) is False:
                raise ConversationBindingError('participant session could not be persisted')
        with server._session_db(session) as db:
            row = db.get_session(session['session_key']) if db else None
            if row is None or row.get('source') != source or row.get('cwd') != cwd:
                raise ConversationBindingError('participant session row is not durable in its Profile')
        if stored is None:
            initial = server._parse_model_config(row.get('model_config'))
            if initial.pop(_MARKER, None) != marker:
                raise ConversationBindingError('participant management marker did not persist')
            if row.get('model'):
                initial.setdefault('model', row['model'])
            stored = store.publish(binding, project, {
                **marker, 'lineage_id': session['session_key'], 'profile': profile,
                'profile_home': _home(server, session), 'cwd': cwd, 'source': source,
                'auth_user_id': server._session_auth_user_id(session),
                'model_snapshot': json.dumps(initial, sort_keys=True), 'capability_digest': '',
                'system_prompt_digest': None, 'selection_json': json.dumps(selection, sort_keys=True)})
            session['_conversation_binding'] = stored
            _restore_model(server, session, stored)
        from .managed_session import model_status
        managed = model_status(session, sid)
        config = json.loads(stored['model_snapshot'])
        if managed:
            config.update({k: v for k, v in managed.items() if k != 'model_status'})
        return {'session_id': sid, 'stored_session_id': stored['lineage_id'], 'profile': profile,
                'session_generation': binding.session_generation,
                'model_status': managed.get('model_status', 'ready' if session.get('agent') else 'prepared'),
                'model_config': config}


def resolve_conversation_session(server, *, binding: ParticipantBinding,
                                 project: ProjectRef | None, source: str) -> RuntimeBinding:
    """Build exactly the reserved draft after its real owner completes credential binding."""
    with _resolution_lock:
        prepared = prepare_conversation_session(server, binding=binding, project=project, source=source)
        sid = prepared['session_id']
        with server._sessions_lock:
            session = server._sessions[sid]
        stored = conversation_metadata(session)
        from .managed_session import submit_refusal
        if reason := submit_refusal(sid, session):
            raise ConversationBindingError(f'participant model authorization unavailable: {reason}')
        server._start_agent_build(sid, session)
        error = server._wait_agent(session, 'conversation-resolve', timeout=120.0)
        if error or session.get('agent') is None:
            raise ConversationBindingError(str(error or 'participant agent is unavailable'))
        agent = session['agent']
        if not stored['capability_digest']:
            with server._profile_build_scope(session.get('profile_home')):
                snapshot = _model_snapshot(server, agent)
            complete = {**stored, 'model_snapshot': json.dumps(snapshot, sort_keys=True),
                        'capability_digest': _capabilities(agent)}
            with server._session_db(session) as db:
                marker = conversation_row_marker(session)
                db.update_session_meta(session['session_key'], json.dumps({**snapshot, _MARKER: marker}),
                                       snapshot.get('model'))
                durable = db.get_session(session['session_key'])
                if server._parse_model_config(durable.get('model_config')) != {**snapshot, _MARKER: marker}:
                    raise ConversationBindingError('participant runtime snapshot did not persist')
            stored = _store(server).complete(binding, project, complete)
        session['_conversation_binding'] = stored
        _restore_model(server, session, stored)
        prepare_conversation_agent(server, session, agent)
        return RuntimeBinding(binding.conversation_id, binding.participant.participant_id,
                              binding.session_generation, stored['lineage_id'], sid,
                              binding.participant.profile, source, json.loads(stored['model_snapshot']))


def refresh_conversation_preparation(server, *, binding: ParticipantBinding,
                                     project: ProjectRef | None, source: str,
                                     model_source: str | None = None, model_id: str | None = None) -> dict:
    """Explicitly advance, then reserve the new generation for its owner's credential rendezvous."""
    if source != 'desktop':
        raise ConversationBindingError('conversation sessions currently require the desktop surface')
    selection = _model_selection(model_source, model_id)
    with _resolution_lock:
        from .conversation_authority import require_conversation_owner
        require_conversation_owner(server, _store(server).db_path, binding.conversation_id, write=True)
        _validate_environment(server, server._profile_home(binding.participant.profile),
                              project, binding.participant.install_id)
        store = _store(server)
        stored = store.resolve(binding, project)
        if not selection and stored:
            selection = json.loads(stored.get('selection_json') or '{}')
            if not selection:
                snapshot = json.loads(stored['model_snapshot'])
                if snapshot.get('model_source') == 'aino':
                    selection = {'model_source': 'aino', 'model_id': snapshot['model_id']}
        _cwd(store, binding.conversation_id, project)
        updated = store.advance(binding, project)
        return prepare_conversation_session(server, binding=updated, project=project, source=source, **selection)


def refresh_conversation_session(server, *, binding: ParticipantBinding,
                                 project: ProjectRef | None, source: str) -> RuntimeBinding:
    """Internal synchronous refresh; desktop uses the preparation rendezvous before resolution."""
    with _resolution_lock:
        prepared = refresh_conversation_preparation(server, binding=binding, project=project, source=source)
        updated = replace(binding, session_generation=prepared['session_generation'],
                          lineage_id=prepared['stored_session_id'])
        return resolve_conversation_session(server, binding=updated, project=project, source=source)


def prepare_conversation_agent(server, session: dict, agent) -> None:
    stored = conversation_metadata(session)
    if stored is None or not stored.get('capability_digest'):
        return  # Internal create has not published its first runtime snapshot yet.
    with server._profile_build_scope(session.get('profile_home')):
        current = _model_snapshot(server, agent)
    if current != json.loads(stored['model_snapshot']) or _capabilities(agent) != stored['capability_digest']:
        raise ConversationBindingError('model or capability snapshot changed; explicitly start a new generation')
    if stored.get('system_prompt_digest'):
        with server._session_db(session) as db:
            row = db.get_session(session['session_key']) if db else None
        prompt = (row or {}).get('system_prompt')
        if not isinstance(prompt, str) or _prompt_digest(prompt) != stored['system_prompt_digest']:
            raise ConversationBindingError('durable conversation system prompt is unavailable')
        agent._cached_system_prompt = prompt
    # The core invokes this after its real prompt write and before calling the model.
    agent._session_init_model_config = {**getattr(agent, '_session_init_model_config', {}),
                                        _MARKER: conversation_row_marker(session)}
    agent._conversation_snapshot_guard = lambda active: _verify_snapshot(server, session, active)
    agent._conversation_compression_committed = lambda active: _compression_committed(server, session, active)


def _compression_committed(server, session: dict, agent) -> None:
    try:
        _verify_snapshot(server, session, agent)
    except Exception as exc:
        session['_conversation_snapshot_error'] = str(exc)
        raise


def _verify_snapshot(server, session: dict, agent) -> None:
    if failure := session.get('_conversation_snapshot_error'):
        raise ConversationBindingError(failure)
    stored = conversation_metadata(session)
    if not stored or not stored.get('capability_digest'):
        raise ConversationBindingError('conversation runtime has not been published')
    if _capabilities(agent) != stored['capability_digest']:
        raise ConversationBindingError('capability snapshot changed; explicitly start a new generation')
    with server._profile_build_scope(session.get('profile_home')):
        if _model_snapshot(server, agent) != json.loads(stored['model_snapshot']):
            raise ConversationBindingError('resolved model changed; explicitly start a new generation')
    with server._session_db(session) as db:
        active_id = getattr(agent, 'session_id', None)
        if db is None or active_id not in db.get_compression_chain(stored['lineage_id']):
            raise ConversationBindingError('active session left its bound compression lineage')
        row = db.get_session(active_id)
    actual = getattr(agent, '_cached_system_prompt', None)
    if not isinstance(actual, str) or not actual or (row or {}).get('system_prompt') != actual:
        raise ConversationBindingError('system prompt has not been durably persisted')
    digest = _prompt_digest(actual)
    if stored.get('system_prompt_digest') != digest:
        _store(server).record_prompt(stored, digest)
        stored['system_prompt_digest'] = digest
    if attempt := session.get('_conversation_attempt'):
        _validate_attempt(_store(server), stored, attempt)


def verify_conversation_prompt_snapshot(agent) -> None:
    guard = getattr(agent, '_conversation_snapshot_guard', None)
    if guard is not None:
        guard(agent)


class _SubmissionProof:
    __slots__ = ('session', 'attempt', 'store', 'active', 'image_paths')

    def __init__(self, session, attempt, store, image_paths=()):
        self.session, self.attempt, self.store, self.active = session, attempt, store, True
        self.image_paths = tuple(image_paths)


def _validate_attempt(store, stored, attempt: driver.TaskAttempt) -> None:
    if not isinstance(attempt, driver.TaskAttempt) or attempt.identity.room_id != stored['conversation_id']:
        raise ConversationBindingError('submission task belongs to a different conversation')
    try:
        with driver._transaction(store.db_path) as conn:
            driver._require_active_lease(conn, attempt.lease, now=time.time())
            row = driver._load_task(conn, attempt.identity)
            if (row['status'] != 'running' or row['execution_generation'] != attempt.execution_generation
                    or row['cancel_generation'] != attempt.cancel_generation
                    or (row['run_gateway_id'], row['run_process_generation'], row['run_lease_generation'])
                    != driver._run_fence(attempt.lease)):
                raise ConversationBindingError('submission execution lease is stale')
            payload = json.loads(row['payload_json'])
            if (payload['target_profile'], payload.get('target_member_id')) != (
                    stored['profile'], stored['participant_id']):
                raise ConversationBindingError('submission task targets another participant')
            generation = conn.execute("""SELECT p.session_generation, p.lineage_id
                FROM hosted_room_conversation_participants p
                JOIN hosted_room_conversations c USING(conversation_id)
                WHERE p.conversation_id=? AND p.participant_id=? AND c.archived_at IS NULL""",
                (stored['conversation_id'], stored['participant_id'])).fetchone()
            if generation is None or tuple(generation) != (stored['session_generation'], stored['lineage_id']):
                raise ConversationBindingError('submission generation is no longer current')
    except driver.DriverStateError as exc:
        raise ConversationBindingError(str(exc)) from exc


@contextlib.contextmanager
def issue_conversation_submission(server, runtime: RuntimeBinding, *, attempt: driver.TaskAttempt, image_paths=()):
    """Yield an in-process proof for the exact running task/lease, revoked after admission.

    A5 passes this object as ``_conversation_proof`` to the installed prompt.submit.
    The task payload must identify ``target_member_id`` as the participant id.
    """
    with server._sessions_lock:
        session = server._sessions.get(runtime.runtime_id)
    stored = conversation_metadata(session or {})
    if not stored or (stored['conversation_id'], stored['participant_id'], stored['session_generation'],
                      stored['lineage_id'], stored['profile'], session.get('source')) != (
            runtime.conversation_id, runtime.participant_id, runtime.session_generation,
            runtime.lineage_id, runtime.profile, runtime.source):
        raise ConversationBindingError('runtime binding does not own the current session')
    store = _store(server)
    _validate_attempt(store, stored, attempt)
    proof = _SubmissionProof(session, attempt, store, image_paths)
    try:
        yield proof
    finally:
        proof.active = False


def require_conversation_submission(session: dict, proof: object | None) -> tuple[str, ...] | None:
    stored = conversation_metadata(session)
    if stored is None:
        if proof is not None:
            raise ConversationBindingError('conversation proof cannot authorize an ordinary session')
        return
    if type(proof) is not _SubmissionProof or not proof.active or proof.session is not session:
        raise ConversationBindingError('conversation sessions accept only driver-owned submissions')
    _validate_attempt(proof.store, stored, proof.attempt)
    session['_conversation_attempt'] = proof.attempt
    return proof.image_paths


def require_conversation_mutation_allowed(session: dict | None) -> None:
    if session and conversation_metadata(session):
        raise ConversationBindingError(
            'This session is managed by its conversation. Send through the conversation or explicitly refresh its participant.')

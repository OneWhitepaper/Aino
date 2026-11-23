"""Project portable launch choices, never another home's execution authority or credentials."""
from __future__ import annotations

import json

from gateway.session_platform_model import selection_from_policy_data
from hermes_state_local import POLICY_PREFIX, local_lineage_owner
from hermes_state_sessions import _parse_model_config


def project_execution(db, sessions):
    """Read only the private source snapshot. The target importer mints its own ownership."""
    with db._read_ctx() as conn:
        for session in sessions:
            owner = local_lineage_owner(conn, session['id'])
            row = conn.execute('SELECT value FROM state_meta WHERE key=?', (POLICY_PREFIX + owner,)).fetchone()
            if row is None:
                continue
            receipt = json.loads(row[0])
            policy = receipt['policy']
            # Hosted rooms, automation and messaging must remain read-only history.
            if policy.get('source') not in ('gui', 'cli', 'tui', 'acp', 'tool', 'oneshot'):
                continue
            _project_session(session, policy)
    return sessions


def _project_session(session, policy):
    config = _parse_model_config(session.get('model_config'))
    effective = json.loads(policy['config_json'])
    model = effective.get('model') or {}
    request = json.loads(policy['request_json'])
    mode = policy.get('execution_mode', 'work')
    if mode not in ('work', 'code'):
        raise ValueError('invalid historical execution mode')
    config.update(execution_mode=mode, cwd=policy['cwd'], cwd_explicit=True)
    config['row_cwd'] = request.get('row_cwd', session.get('cwd') or '')
    # Keep the chosen source (and hence billing channel), not the old API key or credential ref.
    route = {key: model[key] for key in ('provider', 'base_url', 'api_mode') if model.get(key)}
    if route:
        config['gateway_runtime'] = route
    selection = selection_from_policy_data(model, request) or model
    for key in ('model_source', 'model_id'):
        if selection.get(key):
            config[key] = selection[key]
    agent = effective.get('agent') or {}
    if agent.get('reasoning_effort'):
        config['reasoning_config'] = agent['reasoning_effort']
    if agent.get('service_tier'):
        config['service_tier'] = agent['service_tier']
    session.update(session_key=None, chat_id=None, origin_json=None)
    session.update(source=policy['source'], user_id=None, model=policy.get('model') or session.get('model'),
                   model_config=config)

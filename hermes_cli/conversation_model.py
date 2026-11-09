"""The existing model command's noninteractive, conversation-owned desktop path."""
import asyncio
import json
import os


def guard_conversation_model_write(key):
    """A running desktop agent selects a route through its owner, never by editing defaults."""
    route_keys = {'model', 'model.provider', 'model.default', 'model.name', 'model.model_id',
                  'model.model_source', 'model.base_url', 'model.api_base', 'model.api_key', 'model.api_mode'}
    normalized = key.strip().lower()
    route = any(normalized == field or normalized.startswith(field + '.') for field in route_keys if field != 'model')
    if ((normalized == 'model' or route) and os.environ.get('HERMES_SESSION_ID')
            and os.environ.get('HERMES_SESSION_PLATFORM') in {'local', 'bot_room'}):
        print('Model changes in a desktop conversation must use `hermes model --list --json`, '
              'then `hermes model --set <exact-model-id> --provider <listed-provider> --json`. '
              'This uses available Aino/account or configured models for this conversation, '
              'effective from the next message. Profile defaults were not changed.')
        raise SystemExit(1)


async def _request_model(session_id, action, *, query=None, provider=None):
    from hermes_constants import get_hermes_home
    from hermes_cli.gateway_client import GatewayClientError, connect_gateway
    from hermes_cli.gateway_runtime import discover_gateway_endpoint, gateway_profile_home
    discovery = await asyncio.to_thread(discover_gateway_endpoint, gateway_profile_home(get_hermes_home()))
    if discovery.state != 'ready' or discovery.endpoint is None:
        raise GatewayClientError('current_gateway_unavailable')
    async with connect_gateway(endpoint=discovery.endpoint) as client:
        return await client.rpc('model.session', session_id=session_id, action=action,
                                **({'query': query} if query is not None else {}),
                                **({'provider': provider} if provider else {}), _timeout=45)


def _print_result(result, as_json):
    if as_json:
        print(json.dumps(result, ensure_ascii=False))
        return
    for row in result.get('models') or []:
        print(f"{row.get('model_id', '')}\t{row.get('provider') or row.get('model_source', '')}\t{row.get('name') or ''}")
    selected = result.get('selection')
    if result.get('status') == 'scheduled' and selected:
        print(f"Selected {selected['model_id']} for this conversation, effective from your next message.")
    elif result.get('status') not in {'available', 'selected'}:
        print(result.get('error') or result.get('status') or 'model_request_failed')


def conversation_model_command(args):
    """Never create a new session or owner, modify profile defaults, or guess a provider."""
    from hermes_cli.gateway_client import GatewayClientError
    as_json = bool(getattr(args, 'json', False))
    session_id = os.environ.get('HERMES_SESSION_ID', '').strip()
    if not session_id:
        _print_result({'status': 'unavailable', 'error': 'no_current_session'}, as_json)
        raise SystemExit(1)
    action = 'list' if getattr(args, 'list_models', False) else 'select'
    query = getattr(args, 'set_model', None)
    if action == 'select' and (not isinstance(query, str) or not query.strip()):
        _print_result({'status': 'unavailable', 'error': 'missing_model'}, as_json)
        raise SystemExit(1)
    try:
        result = asyncio.run(_request_model(session_id, action, query=query, provider=getattr(args, 'provider', None)))
    except (GatewayClientError, TimeoutError, OSError):
        result = {'status': 'unavailable', 'error': 'conversation_model_bridge_unavailable'}
    _print_result(result, as_json)
    if result.get('status') not in {'available', 'scheduled', 'selected'}:
        raise SystemExit(2 if result.get('status') == 'ambiguous' else 1)

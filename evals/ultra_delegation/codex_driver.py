"""Test-only Codex CLI driver; reuses acceptance fixtures, managed auth and billing.

Local scripted responses are transport probes, never model-quality evidence.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import secrets
import signal
import subprocess
import threading
import time
from datetime import datetime, timezone
from uuid import uuid4, uuid5, NAMESPACE_OID


def budget_reason(requests, cumulative_input, output, seconds, *, max_seconds=1200):
    if requests >= 64:
        return 'request_cap'
    if cumulative_input >= 2_000_000:
        return 'input_cap'
    if output >= 60_000:
        return 'output_cap'
    if seconds >= max_seconds:
        return 'timeout'
    return None


def run_codex(ctx):
    import httpx
    import uvicorn
    from starlette.applications import Starlette
    from starlette.responses import JSONResponse, StreamingResponse
    from starlette.routing import Route
    from agent.auxiliary_billing_scope import BillingScope, ManagedCredential
    from agent.model_metadata import estimate_request_tokens_rough

    args, run, workspace = ctx['args'], ctx['run'], ctx['workspace']
    record, progress, hashes = ctx['record'], ctx['progress'], ctx['hashes']
    lease = ctx['lease']
    started_at = time.monotonic()
    stopped = threading.Event()
    reasons = []
    requests, responses, raw_events = [], [], []
    scopes = {}
    tally = {'requests': 0, 'input': 0, 'output': 0}
    token = secrets.token_urlsafe(32)
    billing_id = str(uuid4())
    lock = threading.RLock()
    child = None
    root_thread = None
    probe = {'auth_rejected': False, 'model_rejected': False, 'budget_boundaries': False}
    # New run identity: never attach comparison charges to an old desktop turn.
    fake_key = 'local-codex-probe-no-credential'
    if not lease:
        lease = {'api_key': fake_key, 'user_id': 'local-fixture-user',
                 'base_url': 'http://127.0.0.1:1/v1',
                 'model': {'model': 'gpt-5.6-sol', 'api_mode': 'responses'},
                 'expires_at': '2099-01-01T00:00:00+00:00'}
    if lease['model']['api_mode'] != 'responses':
        raise ValueError('Codex comparison requires a Responses lease')
    expected_model = lease['model']['model']
    upstream_secret = lease['api_key']
    expiry = datetime.fromisoformat(lease['expires_at'].replace('Z', '+00:00')).timestamp()

    def stop(reason):
        with lock:
            if reason not in reasons:
                reasons.append(reason)
        stopped.set()

    signal.signal(signal.SIGTERM, lambda *_: stop('external_observed_budget_or_watchdog'))

    def metadata(body, headers):
        raw = headers.get('x-codex-turn-metadata')
        if not raw:
            raw = (body.get('client_metadata') or {}).get('x-codex-turn-metadata')
        try:
            data = json.loads(raw) if isinstance(raw, str) else (raw or {})
        except (TypeError, ValueError):
            data = {}
        if not isinstance(data, dict):
            data = {}
        thread = str(data.get('thread_id') or headers.get('thread-id') or 'root')
        turn = str(data.get('turn_id') or 'single-exec-turn')
        purpose = ('compression' if data.get('request_kind') == 'compaction' else
                   'delegation' if data.get('parent_thread_id') or headers.get('x-openai-subagent') == 'collab_spawn'
                   else 'chat')
        scope_key = (thread, turn, purpose)
        if scope_key not in scopes:
            scopes[scope_key] = BillingScope('aino', str(lease['user_id']), billing_id,
                                           str(uuid5(NAMESPACE_OID, billing_id + ':' + thread + ':' + turn)), purpose)
        return thread, scopes[scope_key], data

    def tool_names(body):
        names = []
        available = list(body.get('tools') or [])
        for item in body.get('input') or []:
            if item.get('type') == 'additional_tools':
                available.extend(item.get('tools') or [])
        for tool in available:
            if tool.get('type') == 'namespace':
                names.extend(str(tool.get('name')) + '.' + str(fn.get('name')) for fn in tool.get('tools') or [])
            elif tool.get('name'):
                names.append(tool['name'])
            else:
                names.append('type:' + str(tool.get('type')))
        return names

    def scripted_packets(body, agent_name):
        inputs = body.get('input') or []
        complete = any(item.get('type') in ('function_call_output', 'custom_tool_call_output') for item in inputs)
        ident = uuid4().hex
        delegation_probe = args.codex_dry_case.startswith('delegation')
        text_input = json.dumps(inputs, ensure_ascii=False)
        is_child = agent_name not in (None, '/root')
        if delegation_probe and not is_child:
            if 'collab spawn failed' in text_input:
                final_text = 'LOCAL_CODEX_SPAWN_FAILED: observed the real CLI spawn error.'
            elif 'LOCAL_CODEX_CHILD_FINAL: real shell read completed.' in text_input:
                final_text = 'LOCAL_CODEX_DELEGATION_FINAL: child tool result and final delivered to parent.'
            else:
                spawned = any(item.get('type') == 'function_call_output' for item in inputs)
                name = 'wait_agent' if spawned else 'spawn_agent'
                arguments = {'timeout_ms': 10000} if spawned else {
                    'task_name': 'transport_child', 'fork_turns': 'all',
                    'message': 'LOCAL_CODEX_CHILD_PROBE: Read agent/compaction_display.py using the real shell tool; return LOCAL_CODEX_CHILD_FINAL.'}
                item = {'id': 'fc_' + ident, 'type': 'function_call', 'call_id': 'call_' + ident,
                        'namespace': 'collaboration', 'name': name, 'arguments': json.dumps(arguments), 'status': 'completed'}
                final_text = None
            if final_text:
                item = {'id': 'msg_' + ident, 'type': 'message', 'role': 'assistant', 'phase': 'final_answer',
                        'status': 'completed', 'content': [{'type': 'output_text', 'text': final_text, 'annotations': []}]}
        elif complete and (not delegation_probe or any(item.get('type') == 'custom_tool_call_output' for item in inputs)):
            final_text = 'LOCAL_CODEX_CHILD_FINAL: real shell read completed.' if delegation_probe else 'LOCAL_CODEX_FINAL: real CLI tool result received.'
            item = {'id': 'msg_' + ident, 'type': 'message', 'role': 'assistant', 'phase': 'final_answer',
                    'status': 'completed', 'content': [{'type': 'output_text', 'text': final_text, 'annotations': []}]}
        else:
            names = tool_names(body)
            if 'functions.exec' in names:
                javascript = 'text(await tools.exec_command(' + json.dumps({'cmd': "sed -n '1,8p' agent/compaction_display.py", 'workdir': str(workspace), 'max_output_tokens': 500, 'login': delegation_probe}) + '));'
                item = {'id': 'ct_' + ident, 'type': 'custom_tool_call', 'call_id': 'call_' + ident,
                        'namespace': 'functions', 'name': 'exec', 'input': javascript, 'status': 'completed'}
            else:
                raise ValueError('Unsupported native Codex tool surface: ' + str(names))
        usage = {'input_tokens': 100, 'output_tokens': 60000 if args.codex_dry_case == 'output-cap' else 20,
                 'total_tokens': 60100 if args.codex_dry_case == 'output-cap' else 120}
        final = {'id': 'resp_' + ident, 'object': 'response', 'model': expected_model,
                 'status': 'completed', 'output': [item], 'usage': usage}
        packets = [{'type': 'response.created', 'response': {**final, 'status': 'in_progress', 'output': []}},
                   {'type': 'response.output_item.added', 'output_index': 0, 'item': item}]
        if item['type'] == 'message':
            packets.append({'type': 'response.output_text.delta', 'item_id': item['id'], 'output_index': 0,
                            'content_index': 0, 'delta': item['content'][0]['text']})
        packets.extend([{'type': 'response.output_item.done', 'output_index': 0, 'item': item},
                        {'type': 'response.completed', 'response': final}])
        newline = '\r\n' if complete or args.codex_dry_case == 'output-cap' else '\n'
        return [('event: ' + p['type'] + newline + 'data: ' + json.dumps(p) + newline * 2).encode() for p in packets]

    async def endpoint(req):
        nonlocal root_thread
        if not secrets.compare_digest(req.headers.get('authorization', ''), 'Bearer ' + token):
            return JSONResponse({'error': 'invalid_local_proxy_token'}, status_code=401)
        try:
            body = await req.json()
        except ValueError:
            return JSONResponse({'error': 'invalid_json'}, status_code=400)
        if not isinstance(body, dict) or body.get('model') != expected_model:
            return JSONResponse({'error': 'managed_model_identity_mismatch'}, status_code=400)
        if body.get('stream') is not True:
            return JSONResponse({'error': 'streaming_required'}, status_code=400)
        if datetime.now(timezone.utc).timestamp() >= expiry:
            stop('lease_expired')
            return JSONResponse({'error': 'lease_expired'}, status_code=401)
        thread, scope, wire_meta = metadata(body, req.headers)
        if args.live and not args.codex_native_comparison and 'collaboration.spawn_agent' in tool_names(body):
            # The actual model selects V2 despite the V1 preference; max_depth
            # is ignored there. Refuse a paid run that would misstate parity.
            stop('unsupported_native_delegation_depth_bound')
            return JSONResponse({'error': 'native_v2_depth_limit_not_aligned'}, status_code=409)
        estimate = estimate_request_tokens_rough(body.get('input') or [], system_prompt=body.get('instructions') or '', tools=body.get('tools') or [])
        with lock:
            current_stop = budget_reason(tally['requests'], tally['input'], tally['output'], time.monotonic() - started_at, max_seconds=args.budget)
            if stopped.is_set() or current_stop:
                stop(current_stop or 'already_stopped')
                return JSONResponse({'error': 'acceptance_budget_reached'}, status_code=429)
            tally['requests'] += 1
            tally['input'] += estimate
        if scope.purpose == 'chat' and root_thread is None:
            root_thread = thread
        key = ManagedCredential(lambda: upstream_secret, str(lease['user_id']), billing_id,
                                expected_model, lease['base_url'], 'codex_responses', False, scope=scope)
        # Reuse the production authority checks and fresh HTTP-attempt correlation IDs.
        upstream_request = httpx.Request('POST', lease['base_url'].rstrip('/') + '/responses',
                                        headers={'Content-Type': 'application/json', 'Accept': 'text/event-stream'},
                                        json=body)
        key.prepare_request(upstream_request)
        request_id = upstream_request.headers['X-Aino-Call-Id']
        info = {'session_id': thread, 'api_request_id': request_id, 'turn_id': scope.turn_id,
                'purpose': scope.purpose, 'model': body['model'], 'wire_reasoning': body.get('reasoning'),
                'approx_input_tokens': estimate, 'tool_names': tool_names(body),
                'system_hash': hashlib.sha256(json.dumps([body.get('instructions', ''),
                    *[item.get('content') for item in body.get('input') or [] if item.get('role') in ('system','developer') and item.get('type') != 'additional_tools']], sort_keys=True).encode()).hexdigest(),
                'wire_metadata': wire_meta}
        requests.append(info)
        record('codex_request', **info)
        why = budget_reason(tally['requests'], tally['input'], tally['output'], time.monotonic()-started_at, max_seconds=args.budget)
        if why:
            # Same observation semantics as the Aino hook: interrupt promptly
            # on the threshold-crossing dispatch, including in-flight work.
            stop(why)
        # Captured model-facing content contains no lease or local proxy token.
        (run / ('request-%03d.json' % len(requests))).write_text(ctx['safe'](body))
        start = time.monotonic()
        client = upstream_response = None
        if args.live:
            from agent.auxiliary_client import _openai_http_client_kwargs
            from hermes_cli.timeouts import get_provider_request_timeout
            # Reuse the isolated profile's existing proxy/TLS/timeout policy.
            client = _openai_http_client_kwargs(lease['base_url'], async_mode=True).get('http_client')
            if not isinstance(client, httpx.AsyncClient):
                stop('upstream_client_unavailable')
                record('upstream_error', error_type='ClientFactoryUnavailable')
                return JSONResponse({'error': 'upstream_client_unavailable'}, status_code=503)
            configured_timeout = get_provider_request_timeout('aino', expected_model)
            if configured_timeout is not None:
                client.timeout = httpx.Timeout(configured_timeout)
            try:
                upstream_response = await client.send(upstream_request, stream=True)
            except Exception as exc:
                await client.aclose()
                stop('upstream_transport_error')
                record('upstream_error', error_type=type(exc).__name__)
                return JSONResponse({'error': 'upstream_transport_error'}, status_code=502)
            if upstream_response.status_code != 200:
                status = upstream_response.status_code
                await upstream_response.aclose(); await client.aclose()
                stop('upstream_http_' + str(status))
                return JSONResponse({'error': 'upstream_rejected_request'}, status_code=status)

        async def stream():
            pending = b''
            try:
                if args.live:
                    source = upstream_response.aiter_bytes()
                else:
                    async def local():
                        for chunk in scripted_packets(body, wire_meta.get('agent_name')):
                            yield chunk
                    source = local()
                async for chunk in source:
                    pending += chunk
                    while delimiter := re.search(rb'\r?\n\r?\n', pending):
                        packet, pending = pending[:delimiter.start()], pending[delimiter.end():]
                        for line in packet.splitlines():
                            if not line.startswith(b'data: '):
                                continue
                            try:
                                event = json.loads(line[6:])
                            except ValueError:
                                continue
                            if event.get('type') == 'response.completed':
                                usage = (event.get('response') or {}).get('usage') or {}
                                amount = int(usage.get('output_tokens') or 0)
                                with lock:
                                    tally['output'] += amount
                                response = {'api_request_id': request_id, 'session_id': thread, 'usage': usage,
                                            'api_duration': round(time.monotonic() - start, 3)}
                                responses.append(response); record('codex_response', **response)
                                why = budget_reason(tally['requests'], tally['input'], tally['output'], time.monotonic()-started_at, max_seconds=args.budget)
                                if why:
                                    stop(why)
                    yield chunk
            finally:
                if upstream_response is not None:
                    await upstream_response.aclose()
                if client is not None:
                    await client.aclose()
        return StreamingResponse(stream(), media_type='text/event-stream')

    import socket
    listener = socket.socket(); listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    ready = threading.Event()
    class Server(uvicorn.Server):
        async def startup(self, sockets=None):
            await super().startup(sockets); ready.set()
    server = Server(uvicorn.Config(Starlette(routes=[Route('/v1/responses', endpoint, methods=['POST'])]),
                                   lifespan='off', log_config=None, access_log=False))
    thread = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
    thread.start()
    if not ready.wait(10):
        raise RuntimeError('Codex proxy startup failed')
    base = 'http://127.0.0.1:' + str(port) + '/v1'
    # Public loopback probes do not touch the managed endpoint.
    with httpx.Client(trust_env=False) as local:
        auth_status = local.post(base + '/responses', json={'model': expected_model}).status_code
        model_status = local.post(base + '/responses', headers={'Authorization': 'Bearer ' + token}, json={'model': 'wrong'}).status_code
        probe['auth_rejected'] = auth_status == 401
        probe['model_rejected'] = model_status == 400
        probe['http_statuses'] = [auth_status, model_status]
    assert probe['auth_rejected'] and probe['model_rejected']
    assert budget_reason(63, 1_999_999, 59_999, 1199) is None
    assert [budget_reason(*values) for values in [(64,0,0,0),(0,2_000_000,0,0),(0,0,60_000,0),(0,0,0,1200)]] == ['request_cap','input_cap','output_cap','timeout']
    probe['budget_boundaries'] = True
    if not args.live:
        # Exercise the actual HTTP admission path at both cumulative bounds;
        # this is a fake-transport probe, not a modified live budget.
        statuses = []
        for key, value in [('requests', 64), ('input', 2_000_000)]:
            tally[key] = value
            with httpx.Client(trust_env=False) as local:
                status = local.post(base + '/responses', headers={'Authorization': 'Bearer ' + token},
                                    json={'model': expected_model, 'stream': True, 'input': []}).status_code
            statuses.append(status)
            tally[key] = 0; reasons.clear(); stopped.clear()
        probe['budget_http_statuses'] = statuses
        assert statuses == [429, 429] and not requests

    provider = 'aino_comparison'
    settings = {
        'model_provider': provider, 'model_reasoning_effort': 'max',
        'model_providers.' + provider: {'name': 'Aino comparison loopback', 'base_url': base,
          'env_key': 'AINO_CODEX_PROBE_PROXY_TOKEN', 'wire_api': 'responses', 'requires_openai_auth': False,
          'supports_websockets': False, 'request_max_retries': 0, 'stream_max_retries': 0},
        'cli_auth_credentials_store': 'ephemeral', 'approval_policy': 'never',
        'web_search': 'disabled', 'features.apps': False, 'features.plugins': False,
        'features.plugin_hooks': False, 'features.skip_host_skill_discovery': True,
        'features.memories': False, 'features.external_agent_memory_import': False,
        'features.shell_snapshot': False, 'features.shell_snapshot_v2': False,
        'skills.bundled.enabled': False, 'skills.include_instructions': False,
        'project_doc_max_bytes': 0, 'features.multi_agent': True,
        'features.multi_agent_v2.enabled': True, 'agents.max_concurrent_threads_per_session': 3,
        'features.multi_agent_v2.max_concurrent_threads_per_session': 4,
        'agents.max_depth': 1, 'agents.default_subagent_model': expected_model,
        # Explicit comparator alignment with the Aino fixture, not a Codex default.
        'agents.default_subagent_reasoning_effort': 'high',
        'analytics.enabled': False, 'check_for_update_on_startup': False,
    }
    # Preserve the model's native V2 path. Four slots include the root; V2 does
    # not enforce max_depth. The comparison records this rather than rewriting tools.
    def toml(value):
        if isinstance(value, dict):
            return '{' + ','.join(k+'='+toml(v) for k,v in value.items()) + '}'
        return json.dumps(value, ensure_ascii=False)
    command = [args.codex_bin, 'exec', '--ignore-user-config', '--ignore-rules', '--strict-config',
               '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', str(workspace),
               '--model', expected_model, '--output-last-message', str(run/'final.txt')]
    if not args.live and args.codex_dry_case == 'delegation-ephemeral':
        command.append('--ephemeral')
    for name, value in settings.items():
        command.extend(['-c', name+'='+toml(value)])
    original_prompt = ctx['prompt']
    driver_prompt = original_prompt
    if args.review_skill == 'original':
        # Match full text obligation, not the Hermes skill_view discovery machinery.
        driver_prompt += '\n\n<review-skill>\n' + (ctx['skill_target']/'SKILL.md').read_text() + '\n' + (ctx['skill_target']/'references/evidence-rating.md').read_text() + '\n</review-skill>'
    if not args.matched_comparison:
        driver_prompt += '\n\n可以在存在独立子任务时自主使用子智能体，主任务负责整合最终答案。'
    command.append('-')
    env = dict(os.environ)
    comparison_home = run / 'codex-home'
    comparison_home.mkdir()
    env['CODEX_HOME'] = str(comparison_home)
    env['AINO_CODEX_PROBE_PROXY_TOKEN'] = token
    env['RUST_LOG'] = 'error'
    # The host may have a general outbound proxy; inference here must hit only
    # this authenticated loopback listener before the managed authority check.
    for name in ('NO_PROXY', 'no_proxy'):
        env[name] = ','.join(filter(None, [env.get(name, ''), '127.0.0.1', 'localhost']))
    events_q = queue.Queue()
    report = {'driver': 'codex', 'scenario': 'large', 'live': args.live, 'run_dir': str(run),
              'prompt': original_prompt, 'driver_prompt': driver_prompt, 'settings': settings,
              'matched_comparison': ctx['comparison'], 'usage_self_check': ctx['usage_self_check'],
              'codex_home': str(comparison_home),
              'fixture_hashes': ctx['fixture_before'], 'review_skill_hashes': ctx['skill_hashes'],
              'diagnostic': {'review_skill': args.review_skill, 'original_acceptance_eligible': False,
                  'boundary': 'Native Codex CLI comparison; tool schemas, prompt, skill loading and delegation lifecycle differ from Aino. Not a strict one-variable product A/B.'},
              'native_differences': ['Responses Lite additional_tools and functions.exec code-mode',
                  'V2 has four slots including the root, but ignores agents.max_depth=1',
                  'Review skill, when selected, is embedded as full text rather than Hermes skill_view',
                  'Model-facing host skills/plugins are disabled; standard native Codex instructions remain',
                  'Cumulative input estimates differ: Codex includes native tools; Aino preflight uses its message estimator',
                  'Managed endpoint accepted this native wire format in prior runs; quality parity remains unproved'],
              'native_comparison_explicit': args.codex_native_comparison,
              'limits': {'seconds': args.budget, 'requests': 64, 'approx_cumulative_input': 2_000_000,
                         'output_tokens': 60_000, 'observed_spend_target_usd': args.spend_target or 5,
                         'monetary_hard_cap': False},
              'version': subprocess.check_output([args.codex_bin,'--version'], text=True).strip()}
    progress('session_ready', scenario='large', driver='codex', run_dir=str(run), session_id=billing_id)
    progress('billing_identity', session_id=billing_id)
    try:
        child = subprocess.Popen(command, cwd=workspace, env=env, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        def read_pipe(pipe, stream):
            for line in pipe:
                events_q.put((stream, line.rstrip('\n')))
        readers = []
        for pipe, stream in [(child.stdout,'stdout'),(child.stderr,'stderr')]:
            reader = threading.Thread(target=read_pipe, args=(pipe,stream), daemon=True)
            reader.start(); readers.append(reader)
        def record_cli(stream, line):
            if stream == 'stdout':
                try:
                    event = json.loads(line)
                except ValueError:
                    event = {'raw': line}
                raw_events.append(event); record('codex_cli_event', event=event)
            else:
                record('codex_cli_stderr', text=line)
        child.stdin.write(driver_prompt); child.stdin.close()
        while child.poll() is None:
            if time.monotonic() - started_at >= args.budget:
                stop('timeout')
            if stopped.is_set():
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(8)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL); child.wait(5)
                break
            try:
                stream, line = events_q.get(timeout=.1)
            except queue.Empty:
                continue
            record_cli(stream, line)
        for reader in readers:
            reader.join(2)
        while not events_q.empty():
            stream, line = events_q.get()
            record_cli(stream, line)
        final = (run/'final.txt').read_text() if (run/'final.txt').exists() else ''
        report['returncode'] = child.returncode
        report['final_text'] = final
        report['stop_reason'] = reasons[0] if reasons else 'normal_final' if child.returncode == 0 and final else 'cli_failure'
        if not args.live and args.codex_dry_case == 'tools' and report['stop_reason'] == 'normal_final':
            probe['real_tool_succeeded'] = any((e.get('item') or {}).get('type') == 'command_execution'
                and (e.get('item') or {}).get('exit_code') == 0 for e in raw_events)
            assert probe['real_tool_succeeded']
        if not args.live and args.codex_dry_case.startswith('delegation'):
            wire_bodies = [json.loads(p.read_text()) for p in sorted(run.glob('request-*.json'))]
            wire_text = json.dumps(wire_bodies, ensure_ascii=False)
            probe['spawn_error_observed'] = 'collab spawn failed: no thread with id' in wire_text
            probe['child_session_observed'] = any(r['wire_metadata'].get('agent_name') == '/root/transport_child' for r in requests)
            probe['child_tool_returned'] = any(item.get('type') == 'custom_tool_call_output' and 'Client-facing projection helpers' in json.dumps(item)
                for body in wire_bodies for item in body.get('input') or [])
            probe['parent_received_child_final'] = any('LOCAL_CODEX_CHILD_FINAL: real shell read completed.' in json.dumps(body)
                for body, info in zip(wire_bodies, requests) if info['wire_metadata'].get('agent_name') == '/root')
            probe['delegation_lifecycle_passed'] = all(probe[key] for key in ('child_session_observed', 'child_tool_returned', 'parent_received_child_final')) and final.startswith('LOCAL_CODEX_DELEGATION_FINAL')
            expected_failure = args.codex_dry_case == 'delegation-ephemeral'
            probe['expected_failure_reproduced'] = expected_failure and probe['spawn_error_observed'] and not probe['child_session_observed']
            if not (probe['expected_failure_reproduced'] if expected_failure else probe['delegation_lifecycle_passed']):
                report['stop_reason'] = 'delegation_probe_failed'
    finally:
        server.should_exit = True; thread.join(10); listener.close()
        report.update(requests=requests, responses=responses, caps=reasons, tally=tally,
                      elapsed_seconds=round(time.monotonic()-started_at,2), probes=probe, cli_events=raw_events)
        report['observed_usage'] = ctx['summarize_observed_usage'](responses, requests, 'responses_raw')
        report['billing'] = [{'source': 'aino', 'session_id': billing_id, 'turn_id': scope.turn_id,
                              'status': 'pending', **scope.calls.snapshot()} for scope in scopes.values()]
        after = hashes(workspace)
        report['fixture_changed'] = [p for p in set(after)|set(ctx['fixture_before']) if after.get(p)!=ctx['fixture_before'].get(p)]
        report['settlement_note'] = 'The platform runner queries actual settlement by the fresh billing session. Scripted dry usage is synthetic and has no charge.'
        wire = [(json.loads(p.read_text())) for p in sorted(run.glob('request-*.json'))]
        serialized_wire = json.dumps(wire, ensure_ascii=False)
        probe['no_user_skill_plugin_injection'] = all(marker not in serialized_wire for marker in
            ('<skills_instructions>', '<plugins_instructions>', '/.codex/skills', 'plugin://'))
        probe['max_on_wire'] = bool(requests) and all(r['wire_reasoning'].get('effort') == 'max' for r in requests if r['purpose'] == 'chat')
        probe['unique_call_ids'] = len({r['api_request_id'] for r in requests}) == len(requests)
        probe['no_shell_snapshots'] = not list(comparison_home.rglob('shell_snapshots/*.sh'))
        (run/'report.json').write_text(ctx['safe'](report))
        for path in run.rglob('*'):
            if path.is_file():
                contents = path.read_bytes()
                if token.encode() in contents or (args.live and upstream_secret.encode() in contents):
                    progress('credential_leak_detected', path=str(path)); os._exit(3)
        progress('finished', driver='codex', run_dir=str(run), stop_reason=report.get('stop_reason'),
                 requests=tally['requests'], output_tokens=tally['output'], fixture_changed=report['fixture_changed'])
        os._exit(0 if report.get('stop_reason') == 'normal_final' else 2)

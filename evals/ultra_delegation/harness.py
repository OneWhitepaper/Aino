"""Isolated real desktop RPC acceptance. A local scripted model is transport-only dry evidence."""
from __future__ import annotations
import argparse, collections, difflib, hashlib, json, os, queue, re, shutil, signal, socket, sqlite3, subprocess, sys, tempfile, threading, time, uuid
from pathlib import Path
from datetime import datetime, timedelta, timezone

SOURCE_ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.ArgumentDefaultsHelpFormatter)
parser.add_argument('scenario', choices=['simple', 'large', 'no_subagent', 'length', 'replay', 'daily', 'daily_replay'])
parser.add_argument('--live', action='store_true', help='Use a managed lease supplied on stdin; may incur charges. Omit for offline scripted RPC.')
parser.add_argument('--repo', type=Path, default=SOURCE_ROOT.parents[1], help='Checkout providing the production Python imports')
parser.add_argument('--fixtures', type=Path, default=SOURCE_ROOT/'fixtures', help='Frozen large/ and small/ fixture root')
parser.add_argument('--output-root', type=Path, default=Path(tempfile.gettempdir())/'aino-ultra-delegation-runs', help='Local results root outside the checkout by default')
parser.add_argument('--review-skill-path', type=Path, help='External original read-only-source-review directory; never bundled here')
parser.add_argument('--length-source', type=Path, help='External saved report.json for the length scenario')
parser.add_argument('--legacy-replay-source', type=Path, help='External saved run for legacy replay or daily_replay; requires original workspace and profile/state.db')
parser.add_argument('--codex-bin', default='codex', help='Optional native Codex CLI executable')
parser.add_argument('--budget', type=int)
parser.add_argument('--spend-target', type=float)
parser.add_argument('--name')
parser.add_argument('--review-skill', choices=['original', 'none'], default='original', help='none is a diagnostic ablation, never original-task acceptance')
parser.add_argument('--driver', choices=['aino', 'codex'], default='aino')
parser.add_argument('--matched-comparison', action='store_true', help='Same prompt and explicit High children; diagnostic only')
parser.add_argument('--independent-completions', action='store_true', help='Use existing per-unit delivery in a fresh isolated Aino comparison profile')
parser.add_argument('--evidence-contract', action='store_true', help='Ask autonomous delegation to use existing evidence JSON output contracts; parent owns final presentation')
parser.add_argument('--dry-child-results', type=Path, help='Offline batch transport probe: reuse exact child summaries from an existing run directory')
parser.add_argument('--replay-source', type=Path, help='Resume only the parent at the first complete batch notification from this saved run')
parser.add_argument('--replay-dry-redelegate', action='store_true', help='Offline negative probe: attempt a new child spawn and verify replay stops before dispatch')
parser.add_argument('--codex-dry-case', choices=['tools', 'output-cap', 'delegation', 'delegation-ephemeral'], default='tools')
parser.add_argument('--codex-native-comparison', action='store_true', help='Explicitly accept documented native Codex tool/depth differences for a bounded live comparison')
parser.add_argument('--input-cap', type=int, help='DIAGNOSTIC ONLY: replace the scenario cumulative-input ceiling to probe whether headroom alone lets the parent deliver. Never acceptance: the scenario ceiling is part of the recorded budget.')
parser.add_argument('--file-read-max-chars', type=int, help='Set the existing file_read_max_chars option in this isolated Aino profile; task, skill, and aggregate acceptance limits stay unchanged')
parser.add_argument('--child-compression-threshold-tokens', type=int, help='Set existing delegation.compression_threshold_tokens in the isolated profile; compression may discard evidence and must be evaluated')
parser.add_argument('--child-reasoning-effort', choices=['high', 'max'], help='Set existing delegation.reasoning_effort for this isolated profile; explicit task choices still override it and parent Ultra is unchanged')
args = parser.parse_args()
if args.file_read_max_chars is not None:
    if args.file_read_max_chars <= 0 or args.driver != 'aino' or args.scenario in ('replay', 'daily_replay'):
        parser.error('--file-read-max-chars requires a positive value and a fresh Aino task')
if args.child_compression_threshold_tokens is not None:
    if args.child_compression_threshold_tokens < 16000 or args.driver != 'aino' or args.scenario in ('replay', 'daily_replay'):
        parser.error('--child-compression-threshold-tokens requires at least 16000 and a fresh Aino task')
if args.child_reasoning_effort is not None:
    if args.driver != 'aino' or args.scenario in ('replay', 'daily_replay'):
        parser.error('--child-reasoning-effort requires a fresh Aino task')
    if args.matched_comparison and args.child_reasoning_effort != 'high':
        parser.error('Matched comparison fixes child reasoning effort to high')
if os.sep in args.codex_bin:
    args.codex_bin = str(Path(args.codex_bin).expanduser().resolve())
REPO = args.repo.expanduser().resolve()
ORIGINAL = args.fixtures.expanduser().resolve()
ROOT = args.output_root.expanduser().resolve()
for option in ('review_skill_path', 'length_source', 'legacy_replay_source', 'replay_source', 'dry_child_results'):
    value = getattr(args, option)
    if value is not None:
        setattr(args, option, value.expanduser().resolve())
if args.name and Path(args.name).name != args.name:
    parser.error('--name must be a single directory name; use --output-root to choose its parent')
if args.scenario == 'length' and args.length_source is None:
    parser.error('length requires --length-source=/path/to/saved/report.json')
if args.scenario in ('replay', 'daily_replay') and not (args.replay_source or args.legacy_replay_source):
    parser.error('replay requires an explicit local saved run; see --replay-source or --legacy-replay-source')
if args.legacy_replay_source and (args.scenario not in ('replay', 'daily_replay') or args.replay_source):
    parser.error('--legacy-replay-source requires replay or daily_replay without --replay-source')
if not (REPO/'tui_gateway/server.py').is_file():
    parser.error('--repo must be an Aino checkout with tui_gateway/server.py')
if not (ORIGINAL/'large').is_dir() or not (ORIGINAL/'small').is_dir():
    parser.error('--fixtures must contain the frozen large/ and small/ directories')
if args.replay_source and (args.scenario!='replay' or args.driver!='aino' or args.matched_comparison or args.evidence_contract or args.independent_completions or args.review_skill!='original'):
    parser.error('--replay-source requires replay with source-owned prompt and configuration')
if args.replay_dry_redelegate and (args.live or not args.replay_source):
    parser.error('--replay-dry-redelegate requires an offline source replay')
if args.evidence_contract and (not args.matched_comparison or args.driver != 'aino'):
    parser.error('--evidence-contract requires the matched Aino comparison')
if args.dry_child_results and (args.live or not args.evidence_contract or args.independent_completions):
    parser.error('--dry-child-results requires an offline batch evidence-contract comparison')
if args.independent_completions and (not args.matched_comparison or args.driver != 'aino'):
    parser.error('--independent-completions requires the matched Aino comparison')
if args.matched_comparison and (args.scenario != 'large' or args.review_skill != 'none'):
    parser.error('Matched comparison requires large --review-skill=none')
if args.driver == 'codex' and args.scenario != 'large':
    parser.error('--driver=codex currently supports only the original large task')
if args.live and args.codex_dry_case != 'tools':
    parser.error('--codex-dry-case is only a local fake-model probe')
if args.live and args.driver == 'codex' and not args.codex_native_comparison:
    parser.error('Live Codex comparison requires --codex-native-comparison after reviewing native tool/depth differences')
if args.driver == 'codex' and args.budget is None:
    args.budget = 1200
if args.review_skill != 'original' and args.scenario != 'large':
    parser.error('--review-skill=none is only supported for the independent large diagnostic')
if args.budget is None: args.budget = {'simple':300,'no_subagent':600,'large':900,'length':300,'replay':1200,'daily':600,'daily_replay':600}[args.scenario]
request_limit = {'daily': 48, 'replay': 24, 'daily_replay': 24}.get(args.scenario, 64)
is_replay = args.scenario in ('replay', 'daily_replay')
input_limit = 500000 if args.scenario in ('daily', 'daily_replay') else 2000000
if args.input_cap is not None:
    # Diagnostic probe only. The scenario ceiling above is the recorded budget the acceptance
    # record refers to; raising it answers "is delivery merely short of headroom", which cannot
    # be scored as passing the original budget.
    if args.input_cap <= 0:
        parser.error('--input-cap must be positive')
    input_limit = args.input_cap
source_replay_metadata = None
if args.replay_source:
    source_replay_metadata=json.loads((args.replay_source/'report.json').read_text())
    args.review_skill=source_replay_metadata['diagnostic']['review_skill']
    args.matched_comparison=bool(source_replay_metadata.get('matched_comparison'))
    args.evidence_contract=bool(source_replay_metadata.get('evidence_contract',{}).get('enabled'))
    args.independent_completions=bool(source_replay_metadata.get('independent_completions'))
if args.scenario not in ('daily', 'daily_replay') and args.review_skill == 'original' and args.review_skill_path is None:
    parser.error('--review-skill=original requires --review-skill-path=/path/to/read-only-source-review; large --review-skill=none is the portable diagnostic')
os.umask(0o077)
run = ROOT / (args.name or (('live-' if args.live else 'dry-') + ('codex-' if args.driver == 'codex' else '') + args.scenario + '-' + datetime.now().strftime('%H%M%S')))
run.mkdir(parents=True, exist_ok=False)
snapshot = run / 'harness-at-start'; snapshot.mkdir()
for filename in ('harness.py','convergence.py','codex_driver.py','platform-runner.ts','daily_contract.py'):
    shutil.copy2(SOURCE_ROOT/filename, snapshot/filename)
(snapshot/'manifest.json').write_text(json.dumps({p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in snapshot.iterdir() if p.is_file()},indent=2))
profile = run / 'profile'; profile.mkdir()
workspace = run / 'workspace'; workspace.mkdir()
lease = json.load(sys.stdin) if args.live else None
secret = str((lease or {}).get('api_key') or '')
if not args.live:
    # Only process-launch essentials survive. HOME isolation also prevents implicit
    # discovery of user credentials, config, plugins, skills, and shell startup files.
    kept = {key: value for key, value in os.environ.items() if key in
            ('PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'TMPDIR',
             'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT')}
    os.environ.clear()
    os.environ.update(kept)
    offline_home = run/'offline-home'
    offline_home.mkdir()
    os.environ.update(HOME=str(offline_home), USERPROFILE=str(offline_home),
                      XDG_CONFIG_HOME=str(offline_home/'.config'),
                      XDG_DATA_HOME=str(offline_home/'.local/share'),
                      XDG_CACHE_HOME=str(offline_home/'.cache'))
    # Fail before DNS or connection setup if any Python dependency tries egress.
    # The real RPC server and scripted model both use 127.0.0.1.
    def loopback_only(host):
        if isinstance(host, bytes):
            host = host.decode('ascii')
        if host not in (None, 'localhost', '127.0.0.1', '::1'):
            raise OSError('Offline acceptance permits loopback connections only')
    original_getaddrinfo = socket.getaddrinfo
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    def local_getaddrinfo(host, *positional, **keyword):
        loopback_only(host)
        return original_getaddrinfo(host, *positional, **keyword)
    def local_connect(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            loopback_only(address[0])
        return original_connect(sock, address)
    def local_connect_ex(sock, address):
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            loopback_only(address[0])
        return original_connect_ex(sock, address)
    socket.getaddrinfo = local_getaddrinfo
    socket.socket.connect = local_connect
    socket.socket.connect_ex = local_connect_ex
else:
    for key in list(os.environ):
        if key.endswith(('_API_KEY','_TOKEN')) or key.startswith(('HERMES_', 'TERMINAL_', 'DELEGATION_')):
            os.environ.pop(key, None)
os.environ.update(HERMES_HOME=str(profile), TERMINAL_CWD=str(workspace), TOKENIZERS_PARALLELISM='false')
os.chdir(workspace)
sys.path.insert(0, str(REPO))
import yaml
source = ORIGINAL / ('large' if args.scenario in ('large','replay') else 'small')
shutil.copytree(source, workspace, dirs_exist_ok=True)
skill_source = args.review_skill_path
skill_target = profile / 'skills/software-development/read-only-source-review'
if args.scenario not in ('daily', 'daily_replay') and args.review_skill == 'original':
    shutil.copytree(skill_source, skill_target)
def hashes(base):
    return {str(p.relative_to(base)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(base.rglob('*')) if p.is_file()}
fixture_before = hashes(workspace); skill_hashes = hashes(skill_target)
recorded_child_results = None
recorded_child_source = None
if args.dry_child_results:
    recorded_child_source=args.dry_child_results
    recorded_report=json.loads((recorded_child_source/'report.json').read_text())
    assert recorded_report['fixture_hashes']==fixture_before==hashes(recorded_child_source/'workspace')
    source_db=sqlite3.connect(f'file:{recorded_child_source}/profile/state.db?mode=ro',uri=True)
    try:
        recorded_entries=[entry for (raw,) in source_db.execute('SELECT result_json FROM async_delegations')
                          for entry in json.loads(raw)['results']]
    finally:
        source_db.close()
    assert len(recorded_entries)==3 and {r['task_index'] for r in recorded_entries}=={0,1,2}
    assert all(r['exit_reason']=='completed' and r['schema_valid'] and not r.get('truncated')
               and not r.get('summary_truncated') for r in recorded_entries)
    recorded_child_results={r['task_index']:r['summary'] for r in recorded_entries}
large = '请只读审查目录 '+str(workspace)+' 中这三组互相独立的源代码快照：① agent/context_compressor.py 与 agent/compaction_display.py，检查摘要触发、失败恢复和显示状态是否一致；② tools/delegate_tool.py 与 tools/delegate_tool_config.py，检查任务取消、并发上限和模型继承；③ tui_gateway/model_switch.py 与 tui_gateway/session_history.py，检查模型切换和历史恢复的状态一致性。三组都需要结合函数调用与边界分支给出结论，有问题时写出具体触发条件和文件行号；没有充分证据的疑点单列，不要当作确定缺陷。最后汇总最值得优先验证的三个风险及理由。这是选定文件的快照，不需要寻找快照外的依赖，不修改文件、不联网、不安装依赖。每组结论控制在400字以内。'
simple = '只检查当前目录 auth.py 的 authenticate 函数：它是否拒绝了 inactive 用户？给出结论和对应代码位置，不修改文件。'
no_subagent = '审查当前目录 auth.py、billing.py、exports.py，对照 SPEC.md 分别检查访问控制、支付幂等和退款边界、租户导出隔离。给出有充分代码证据的问题和对应位置。请直接独立完成，不调用子智能体。不修改文件、不运行服务、不联网。'
length_source_path = args.length_source
length_source = None
length = ''
if args.scenario == 'length':
    source_report = json.loads(length_source_path.read_text())
    length_source = source_report['final_event']['payload']['text']
    length = ('以下是一份已完成的审查记录。请仅根据给定材料整理为三组中文结论：访问控制、支付与退款、租户导出隔离，每组不超过200字；最后列出最应优先解决的一个风险及理由。'
              '这次只做结果整理，无需重新审查、联网或读文件；请直接完成，不委派子智能体。不要把材料中的证据不足项写成确定缺陷。\n\n'
              '<已完成的审查记录>\n' + length_source + '\n</已完成的审查记录>')
replay_source = args.replay_source or args.legacy_replay_source
replay_data = None
replay_event = None
replay_result = None
replay_prefix = None
seed_tool_ids = set()
replay_stored_id = 'replay_' + uuid.uuid4().hex
replay_fixture_before = None
if is_replay:
    replay_data = json.loads((replay_source/'report.json').read_text())
    boundary = next(i for i,m in enumerate(replay_data['history']) if m.get('display_kind')=='async_delegation_complete')
    replay_prefix = json.loads(json.dumps(replay_data['history'][:boundary]))
    assert boundary>0 and replay_prefix[-1]['role']=='assistant'
    seed_tool_ids={tc['id'] for row in replay_prefix for tc in row.get('tool_calls') or []}
    source_db=sqlite3.connect(f'file:{replay_source}/profile/state.db?mode=ro',uri=True)
    delegation_ids={c['delegation_id'] for c in replay_data['children_finished']}
    assert len(delegation_ids)==1
    event_text,result_text=source_db.execute('select event_json,result_json from async_delegations where delegation_id=?',(next(iter(delegation_ids)),)).fetchone()
    source_db.close()
    replay_event=json.loads(event_text);replay_result=json.loads(result_text)
    assert len(replay_result['results'])==3 and all(r.get('status')=='completed' for r in replay_result['results'])
    if args.replay_source:
        assert replay_event['is_batch'] and {r['task_index'] for r in replay_result['results']}=={0,1,2}
        assert all(r.get('exit_reason')=='completed' and r.get('schema_valid') is True
                   and not r.get('truncated') and not r.get('summary_truncated') for r in replay_result['results'])
    replay_fixture_before=hashes(replay_source/'workspace')
    shutil.copytree(replay_source/'workspace',run/'replay-source-before')
execution_workspace = replay_source/'workspace' if is_replay else workspace
os.environ['TERMINAL_CWD']=str(execution_workspace)
os.chdir(execution_workspace)
daily = '请把当前示例项目修到符合 SPEC.md：检查并修复 auth.py 的认证与管理员授权，billing.py 的支付重试、并发幂等和退款、折扣边界，exports.py 的租户隔离与删除记录过滤。保留现有函数接口，为修复补充能重现问题的自动化测试并运行，最后说明修复内容、测试结果和仍未解决的限制。可以修改当前项目文件；不联网、不安装依赖。测试使用 Python 标准库 unittest。'
prompt = replay_data['prompt'] if is_replay else {'daily':daily,'simple':simple,'large':large,'no_subagent':no_subagent,'length':length}[args.scenario]
comparison = None
evidence_schema = {
    'type':'object', 'required':['findings','limitations'],
    'properties':{
        'findings':{'type':'array','items':{
            'type':'object','required':['claim','status','trigger','evidence'],
            'properties':{
                'claim':{'type':'string'},
                'status':{'type':'string','enum':['confirmed','needs_verification']},
                'trigger':{'type':'string'},
                'evidence':{'type':'array','items':{
                    'type':'object','required':['file','line_start','line_end','reason'],
                    'properties':{'file':{'type':'string'},'line_start':{'type':'integer','minimum':1},
                                  'line_end':{'type':'integer','minimum':1},'reason':{'type':'string'}}}},
            }}},
        'limitations':{'type':'array','items':{'type':'string'}}}}
base_prompt_sha256 = None
if args.matched_comparison and not args.replay_source:
    prompt += chr(10)*2 + '本次运行可以自主委派独立子任务；如委派，所有子任务必须使用同一模型 gpt-5.6-sol 和 High 推理档位。主任务负责核验证据并交付最终答案。'
    base_prompt_sha256=hashlib.sha256(prompt.replace(str(workspace),'<WORKSPACE>').encode()).hexdigest()
    if args.evidence_contract:
        prompt += ('\n\n子任务交付契约：如委派，复用 delegate_task 的 goal/context/output_schema。'
                   '在 goal/context 中明确：子任务只提供可核查的发现、触发条件、文件行号、证据与局限；'
                   '每组400字和最终Top 3仅约束主任务的最终报告，不转交给子任务压缩排版。'
                   '为每个委派任务传入下列 output_schema；子任务交付对应JSON，findings可以为空。'
                   '证据或调用方契约不足的发现标 needs_verification，并在 limitations 说明缺口，不编造证据。'
                   '主任务核验子结果及其完整性后，再统一完成原要求的三组结论和Top 3；格式有效不等于事实已确认。'
                   '\noutput_schema='+json.dumps(evidence_schema,ensure_ascii=False,separators=(',',':')))
    comparison = {'parent_effort':'max','child_effort':'high','model':'gpt-5.6-sol','max_children':3,
        'prompt_sha256_ignoring_workspace':hashlib.sha256(prompt.replace(str(workspace),'<WORKSPACE>').encode()).hexdigest(),
        'accounting':'Completed provider prompt includes cached + uncached input. Raw observations retained. Existing rough-input stop thresholds unchanged; estimator scopes still differ.',
        'strict_single_variable_ab':False}
config = {'model': {'default':'gpt-5.6-sol','provider':'aino'},
    'agent': {'max_turns':24 if args.scenario in ('replay','daily','daily_replay') else 36,'reasoning_effort':'ultra','api_max_retries':1,'auto_recovery_cycles':0},
    'delegation': {'max_concurrent_children':3,'max_iterations':16,'max_spawn_depth':1},
    'terminal': {'backend':'local','cwd':str(execution_workspace)}, 'approvals': {'mode':'smart' if args.live else 'manual'},
    'auxiliary': {'title_generation': {'enabled': args.live}}}
if args.file_read_max_chars is not None:
    config['file_read_max_chars'] = args.file_read_max_chars
if args.child_compression_threshold_tokens is not None:
    config['delegation']['compression_threshold_tokens'] = args.child_compression_threshold_tokens
if args.child_reasoning_effort is not None:
    config['delegation']['reasoning_effort'] = args.child_reasoning_effort
if args.matched_comparison: config['delegation']['reasoning_effort']='high'
if args.independent_completions: config['delegation']['independent_completions']=True
if source_replay_metadata:
    config=json.loads(json.dumps(source_replay_metadata['config']))
    config['terminal']['cwd']=str(execution_workspace)
    if not args.live:
        config['approvals']['mode']='manual'
        config['auxiliary']['title_generation']['enabled']=False
    comparison=json.loads(json.dumps(source_replay_metadata.get('matched_comparison')))
    evidence_schema=json.loads(json.dumps(source_replay_metadata['evidence_contract']['schema']))
    base_prompt_sha256=source_replay_metadata['evidence_contract']['base_prompt_sha256_ignoring_workspace']
(profile / 'config.yaml').write_text(yaml.safe_dump(config,allow_unicode=True))
log_lock = threading.RLock(); t0 = time.monotonic(); events = []; requests = []; responses = []; caps = []
sid = stored_sid = None
out = sys.__stdout__
def safe(value):
    text = json.dumps(value,ensure_ascii=False,default=str)
    return text.replace(secret,'[REDACTED]') if secret else text
def record(kind, **data):
    row = {'time':round(time.monotonic()-t0,3),'kind':kind,**data}
    with log_lock:
        with (run/'events.jsonl').open('a') as f: f.write(safe(row)+'\n')
        events.append(row)
    return row
def progress(stage, **data):
    out.write(safe({'stage':stage,**data})+'\n');out.flush()

from evals.ultra_delegation.convergence import (
    cumulative_input_excluding_cache_reads, normalize_observed_usage, observe_input_ceiling,
)

def summarize_observed_usage(responses, requests, source):
    """Unique matched response usage; distinct from the input-ceiling reservation policy."""
    fields = ('prompt_tokens', 'cache_read_tokens', 'cache_write_tokens', 'uncached_input_tokens',
              'output_tokens', 'reasoning_tokens', 'total_tokens')
    request_ids = {r['api_request_id'] for r in requests
                   if isinstance(r, dict) and isinstance(r.get('api_request_id'), str) and r['api_request_id']}
    grouped = collections.defaultdict(list)
    unkeyed = 0
    for row in responses:
        key = row.get('api_request_id') if isinstance(row, dict) else None
        if not isinstance(key, str) or not key:
            unkeyed += 1
        else:
            grouped[key].append(row)
    valid, missing, invalid, conflicts = {}, [], [], []
    for key in sorted(request_ids & grouped.keys()):
        try:
            values = [normalize_observed_usage(row.get('usage'), source) for row in grouped[key]]
        except ValueError as error:
            invalid.append({'api_request_id':key, 'error':str(error)}); continue
        if any(value != values[0] for value in values[1:]):
            conflicts.append(key)
        elif values[0] is None:
            missing.append(key)
        else:
            valid[key] = values[0]
    coverage = {field:sum(row[field] is not None for row in valid.values()) for field in fields}
    totals = {field:sum(row[field] for row in valid.values())
              if valid and coverage[field] == len(valid) else None for field in fields}
    return {'source':source, 'scope':'unique matched requests with valid completed usage; not final settlement',
            'request_rows':len(requests), 'unique_requested':len(request_ids), 'response_rows':len(responses),
            'observed_usage_requests':len(valid), 'complete_usage_requests':sum(all(v is not None for v in row.values()) for row in valid.values()),
            'duplicate_response_rows':sum(len(rows)-1 for rows in grouped.values()), 'unkeyed_response_rows':unkeyed,
            'unmatched_response_ids':sorted(grouped.keys()-request_ids),
            'missing_response_ids':sorted(request_ids-grouped.keys()), 'missing_usage_ids':missing,
            'invalid_usage':invalid, 'conflicting_response_ids':conflicts,
            'requested_without_valid_usage':sorted(request_ids-valid.keys()),
            'field_observation_counts':coverage, 'totals':totals}

usage_self_check = None
if not args.live:
    raw = {'input_tokens':120, 'output_tokens':50, 'total_tokens':170,
           'input_tokens_details':{'cached_tokens':30, 'cache_write_tokens':10},
           'output_tokens_details':{'reasoning_tokens':20}}
    hook = {'prompt_tokens':120, 'input_tokens':80, 'cache_read_tokens':30, 'cache_write_tokens':10,
            'output_tokens':50, 'reasoning_tokens':20, 'total_tokens':170}
    normalized = normalize_observed_usage(raw, 'responses_raw')
    assert normalized == normalize_observed_usage(hook, 'aino_hook')
    request_rows = [{'api_request_id':'usage-probe'}]
    response_row = {'api_request_id':'usage-probe', 'usage':raw}
    duplicate = summarize_observed_usage([response_row, response_row], request_rows, 'responses_raw')
    assert duplicate['totals'] == normalized and duplicate['duplicate_response_rows'] == 1
    bad = {**raw, 'input_tokens':20, 'total_tokens':70}
    rejected = summarize_observed_usage([{**response_row, 'usage':bad}], request_rows, 'responses_raw')
    assert rejected['observed_usage_requests'] == 0 and len(rejected['invalid_usage']) == 1
    conflict = summarize_observed_usage([response_row, {**response_row, 'usage':{**raw, 'output_tokens':51, 'total_tokens':171}}], request_rows, 'responses_raw')
    assert conflict['observed_usage_requests'] == 0 and conflict['conflicting_response_ids'] == ['usage-probe']
    missing = summarize_observed_usage([{**response_row, 'usage':None}], request_rows, 'responses_raw')
    assert missing['missing_usage_ids'] == ['usage-probe'] and missing['totals']['prompt_tokens'] is None
    incomplete = normalize_observed_usage({'input_tokens':120, 'output_tokens':50}, 'responses_raw')
    assert incomplete['cache_read_tokens'] is None and incomplete['uncached_input_tokens'] is None
    usage_self_check = {'normalized_equivalence':True, 'cache_write_accounted':True,
                        'duplicates_not_counted':True, 'invalid_excluded':True,
                        'conflicting_duplicates_excluded':True, 'missing_not_zeroed':True}
    progress('usage_self_check', **usage_self_check)

if args.driver == 'codex':
    from codex_driver import run_codex
    run_codex(globals())
    raise SystemExit('Codex driver returned unexpectedly')

wire_attempts = []
wire_transports = []
wire_observer_self_check = None
wire_httpx_version = None

def install_wire_observer(credential_type, attempts, transports, recorder):
    """Harness-only observation at HTTPX's real attempt boundary; restore after fake probes."""
    import httpx
    import weakref
    prepared = weakref.WeakKeyDictionary()
    original_prepare = credential_type.prepare_request
    original_sync = httpx.Client._send_single_request
    original_async = httpx.AsyncClient._send_single_request

    def structure(value):
        values = value if isinstance(value, list) else [value]
        rows = []
        for index, entry in enumerate(values):
            encoded = json.dumps(entry, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
            row = {'index':index, 'json_kind':type(entry).__name__,
                   'canonical_json_bytes':len(encoded), 'canonical_sha256':hashlib.sha256(encoded).hexdigest()}
            if isinstance(entry, dict):
                row.update({key:entry.get(key) for key in ('type','role','id','call_id')
                            if isinstance(entry.get(key), str)})
            rows.append(row)
        return {'json_kind':type(value).__name__, 'item_count':len(values), 'items':rows}

    def observe_prepare(credential, request):
        before = request.content
        result = original_prepare(credential, request)
        if request.method == 'POST':
            body = json.loads(before)
            item = {'observation_id':str(uuid.uuid4()),
                    'http_call_id':request.headers.get('X-Aino-Call-Id'),
                    'billing_session_id':request.headers.get('X-Aino-Session-Id'),
                    'turn_id':request.headers.get('X-Aino-Turn-Id'),
                    'purpose':request.headers.get('X-Aino-Purpose'),
                    'model':body.get('model'), 'wire_reasoning':body.get('reasoning'),
                    'wire_reasoning_effort':body.get('reasoning_effort'),
                    'body_bytes':len(before), 'body_sha256':hashlib.sha256(before).hexdigest(),
                    'body_unchanged':request.content == before,
                    'input_structure':{key:structure(body[key]) for key in ('input','messages') if key in body}}
            with log_lock:
                attempts.append(item)
                prepared[request] = item
            recorder('managed_wire_request', **item)
        return result

    class Observation:
        def __init__(self, item, mode):
            self.started = time.monotonic()
            self.row = {'observation_id':item['observation_id'], 'http_call_id':item['http_call_id'],
                        'mode':mode, 'dispatch_at_seconds':round(self.started-t0,6), 'received_bytes':0,
                        'chunk_count':0, 'eof_observed':False, 'close_observed':False,
                        'iterator_advance_seconds':0.0, 'consumer_pause_seconds':0.0}
            self.iterator_advance_seconds = self.consumer_pause_seconds = 0.0
            self.consumer_paused_at = None
            self.line_prefix = bytearray()
            self.first_output = False
            self.sse = False
            with log_lock: transports.append(self.row)
            self.emit('send_start')

        def emit(self, stage, **fields):
            elapsed = round(time.monotonic()-self.started,6)
            self.row[stage+'_seconds'] = elapsed
            self.row.update(fields)
            recorder('managed_http_transport', observation_id=self.row['observation_id'],
                     http_call_id=self.row['http_call_id'], mode=self.row['mode'], stage=stage,
                     since_dispatch_seconds=elapsed, received_bytes=self.row['received_bytes'],
                     iterator_advance_seconds=self.row['iterator_advance_seconds'],
                     consumer_pause_seconds=self.row['consumer_pause_seconds'], **fields)

        def advanced(self, started):
            self.iterator_advance_seconds += time.monotonic()-started
            self.row['iterator_advance_seconds'] = round(self.iterator_advance_seconds,6)

        def pause_consumer(self):
            self.consumer_paused_at = time.monotonic()

        def resume_consumer(self):
            if self.consumer_paused_at is not None:
                self.consumer_pause_seconds += time.monotonic()-self.consumer_paused_at
                self.row['consumer_pause_seconds'] = round(self.consumer_pause_seconds,6)
                self.consumer_paused_at = None

        def headers(self, response):
            self.sse = 'text/event-stream' in response.headers.get('content-type','').lower()
            # iter_raw receives encoded bytes. Do not decompress/rewrite solely for observation.
            self.parse_sse = self.sse and response.headers.get('content-encoding','identity').lower() == 'identity'
            self.emit('headers_received', status_code=response.status_code, is_sse=self.sse,
                      sse_parser_enabled=self.parse_sse)

        def chunk(self, chunk):
            self.row['chunk_count'] += 1
            self.row['received_bytes'] += len(chunk)
            if chunk and 'first_body_chunk_seconds' not in self.row:
                self.emit('first_body_chunk')
            if not self.parse_sse or self.first_output:
                return
            # Only retain at most a 4 KiB line prefix, never the output body or an SSE event.
            # Standard event: fields and data with a leading top-level type are recognized.
            start = 0
            while start < len(chunk) and not self.first_output:
                stop = chunk.find(b'\n', start)
                end = len(chunk) if stop < 0 else stop
                remaining = 4096-len(self.line_prefix)
                if remaining > 0: self.line_prefix.extend(chunk[start:min(end,start+remaining)])
                if stop < 0: break
                line = bytes(self.line_prefix).rstrip(b'\r')
                self.line_prefix.clear()
                match = re.match(rb'event:\s*([A-Za-z0-9_.-]+)\s*$', line)
                if match is None:
                    match = re.match(rb'data:\s*\{\s*"type"\s*:\s*"([A-Za-z0-9_.-]+)"', line)
                if match:
                    event_type = match.group(1).decode('ascii')
                    if event_type.startswith(('response.output_', 'response.content_part.',
                                              'response.reasoning_', 'response.function_call_arguments.',
                                              'response.refusal.')):
                        self.first_output = True
                        self.emit('first_output_sse_event', first_output_sse_type=event_type)
                start = stop+1

    class SyncObservedStream(httpx.SyncByteStream):
        def __init__(self, stream, observation):
            self.stream, self.observation = stream, observation
        def __iter__(self):
            try:
                iterator = iter(self.stream)
                while True:
                    started = time.monotonic()
                    try:
                        chunk = next(iterator)
                    except StopIteration:
                        break
                    finally:
                        self.observation.advanced(started)
                    self.observation.chunk(chunk)
                    self.observation.pause_consumer()
                    try:
                        yield chunk
                    finally:
                        self.observation.resume_consumer()
            except GeneratorExit:
                raise
            except BaseException as error:
                self.observation.emit('stream_error', stream_error_type=type(error).__name__)
                raise
            else:
                self.observation.emit('stream_end', eof_observed=True)
        def close(self):
            # Explicit response.close() need not resume a suspended iterator.
            self.observation.resume_consumer()
            try:
                self.stream.close()
            except BaseException as error:
                self.observation.emit('close_error', close_error_type=type(error).__name__)
                raise
            else:
                self.observation.emit('stream_close', close_observed=True)

    class AsyncObservedStream(httpx.AsyncByteStream):
        def __init__(self, stream, observation):
            self.stream, self.observation = stream, observation
        async def __aiter__(self):
            try:
                iterator = self.stream.__aiter__()
                while True:
                    started = time.monotonic()
                    try:
                        chunk = await anext(iterator)
                    except StopAsyncIteration:
                        break
                    finally:
                        self.observation.advanced(started)
                    self.observation.chunk(chunk)
                    self.observation.pause_consumer()
                    try:
                        yield chunk
                    finally:
                        self.observation.resume_consumer()
            except GeneratorExit:
                raise
            except BaseException as error:
                self.observation.emit('stream_error', stream_error_type=type(error).__name__)
                raise
            else:
                self.observation.emit('stream_end', eof_observed=True)
        async def aclose(self):
            self.observation.resume_consumer()
            try:
                await self.stream.aclose()
            except BaseException as error:
                self.observation.emit('close_error', close_error_type=type(error).__name__)
                raise
            else:
                self.observation.emit('stream_close', close_observed=True)

    def observe_sync(client, request):
        with log_lock: item = prepared.get(request)
        if item is None: return original_sync(client, request)
        observation = Observation(item, 'sync')
        try:
            response = original_sync(client, request)
        except BaseException as error:
            observation.emit('send_error', send_error_type=type(error).__name__)
            raise
        observation.headers(response)
        response.stream = SyncObservedStream(response.stream, observation)
        return response

    async def observe_async(client, request):
        with log_lock: item = prepared.get(request)
        if item is None: return await original_async(client, request)
        observation = Observation(item, 'async')
        try:
            response = await original_async(client, request)
        except BaseException as error:
            observation.emit('send_error', send_error_type=type(error).__name__)
            raise
        observation.headers(response)
        response.stream = AsyncObservedStream(response.stream, observation)
        return response

    credential_type.prepare_request = observe_prepare
    httpx.Client._send_single_request = observe_sync
    httpx.AsyncClient._send_single_request = observe_async
    def restore():
        credential_type.prepare_request = original_prepare
        httpx.Client._send_single_request = original_sync
        httpx.AsyncClient._send_single_request = original_async
    return restore

def check_wire_observer():
    """No sockets or credentials: run the installed wrappers through HTTPX MockTransport."""
    import asyncio
    import httpx
    from unittest.mock import patch
    observed, timings, logs = [], [], []
    class Clock:
        value = t0
        def __call__(self): return self.value
        def advance(self, seconds): self.value += seconds
    clock = Clock()
    body = {'model':'fake-observer', 'input':[{'type':'message','role':'user','id':'item-1','content':'DO_NOT_LOG_BODY'},
            {'type':'function_call_output','call_id':'call-1','output':'DO_NOT_LOG_OUTPUT'}]}
    chunks = [b': heartbeat\n\n', b'event: response.out', b'put_item.added\n', b'data: {"type":"response.output_item.added"}\n\n']
    class FakeCredential:
        def prepare_request(self, request):
            request.headers['X-Aino-Call-Id'] = 'fake-call-'+str(len(observed))
    credential = FakeCredential()
    def capture(kind, **fields): logs.append({'kind':kind, **fields})
    restore = install_wire_observer(FakeCredential, observed, timings, capture)
    clock_patch = patch.object(time, 'monotonic', clock)
    clock_patch.start()
    class SyncStream(httpx.SyncByteStream):
        def __init__(self, values, error=None, close_error=None):
            self.values, self.error, self.close_error, self.closed = values, error, close_error, False
        def __iter__(self):
            for chunk in self.values:
                clock.advance(2)
                yield chunk
            clock.advance(3)
            if self.error: raise self.error
        def close(self):
            clock.advance(7)
            self.closed = True
            if self.close_error: raise self.close_error
    class AsyncStream(httpx.AsyncByteStream):
        def __init__(self, values, error=None, close_error=None):
            self.values, self.error, self.close_error, self.closed = values, error, close_error, False
        async def __aiter__(self):
            for chunk in self.values:
                clock.advance(2)
                yield chunk
            clock.advance(3)
            if self.error: raise self.error
        async def aclose(self):
            clock.advance(7)
            self.closed = True
            if self.close_error: raise self.close_error
    def verify(before, stream, values, error, close_error, sse, early=False, timing=(7,0)):
        row = timings[-1]
        assert len(timings) == before+1 and stream.closed
        assert row['received_bytes'] == sum(map(len,values)) and row['eof_observed'] == (error is None and not early)
        assert row['close_observed'] == (close_error is None)
        assert row['headers_received_seconds'] <= row.get('first_body_chunk_seconds',float('inf'))
        assert ('first_output_sse_event_seconds' in row) == sse
        if sse:
            assert row['first_body_chunk_seconds'] <= row['first_output_sse_event_seconds']
            assert row['first_output_sse_type'] == 'response.output_item.added'
        if error: assert row['stream_error_type'] == type(error).__name__
        if close_error: assert row['close_error_type'] == type(close_error).__name__
        # Literal totals include the last EOF/error pull, exclude close work, and
        # settle early-close consumer time once even if the iterator closes later.
        assert row.get('iterator_advance_seconds') == timing[0], row
        assert row.get('consumer_pause_seconds') == timing[1], row
        last = next(event for event in reversed(logs) if event.get('observation_id') == row['observation_id'])
        assert last.get('iterator_advance_seconds') == timing[0], last
        assert last.get('consumer_pause_seconds') == timing[1], last
    cases = [(chunks,None,None,True,False,(11,20)), ([b'{"ok":true}'],None,None,False,False,(5,5)),
             ([b'partial'],httpx.ReadError('do-not-log-exception-text'),None,False,False,(5,5)),
             ([],None,RuntimeError('do-not-log-close-text'),False,False,(3,0)),
             ([b'first',b'unread'],None,None,False,True,(2,5)),
             ([b': heartbeat\n\n',b'data: {"ty',b'pe":"response.output_item.added","payload":"',b'x'*5000+b'"}\n\n'],None,None,True,False,(11,20))]
    try:
        for values,error,close_error,sse,early,timing in cases:
            stream = SyncStream(values,error,close_error); before=len(timings)
            transport = httpx.MockTransport(lambda request:httpx.Response(200,
                headers={'content-type':'text/event-stream' if sse else 'application/json'},stream=stream))
            with httpx.Client(transport=transport,event_hooks={'request':[credential.prepare_request]}) as client:
                response = client.send(client.build_request('POST','https://observer.invalid/responses',json=body),stream=True)
                seen=[]
                try:
                    for chunk in response.iter_raw():
                        seen.append(chunk)
                        clock.advance(5)
                        if early: break
                except BaseException as actual:
                    assert actual is (error or close_error)
                else: assert error is None and close_error is None
                try: response.close()
                except BaseException as actual: assert actual is close_error
                assert seen == (values[:1] if early else values)
                assert all(actual is expected for actual,expected in zip(seen,values))
            verify(before,stream,seen,error,close_error,sse,early,timing)
        stream=SyncStream([b'nonstream ',b'body']);before=len(timings)
        with httpx.Client(transport=httpx.MockTransport(lambda request:httpx.Response(200,stream=stream)),
                          event_hooks={'request':[credential.prepare_request]}) as client:
            assert client.post('https://observer.invalid/responses',json=body).content == b'nonstream body'
        verify(before,stream,stream.values,None,None,False)
        async def async_cases():
            async def prepare(request): credential.prepare_request(request)
            for values,error,close_error,sse,early,timing in cases:
                stream=AsyncStream(values,error,close_error);before=len(timings)
                transport=httpx.MockTransport(lambda request:httpx.Response(200,
                    headers={'content-type':'text/event-stream' if sse else 'application/json'},stream=stream))
                async with httpx.AsyncClient(transport=transport,event_hooks={'request':[prepare]}) as client:
                    response=await client.send(client.build_request('POST','https://observer.invalid/responses',json=body),stream=True)
                    seen=[]
                    try:
                        async for chunk in response.aiter_raw():
                            seen.append(chunk)
                            clock.advance(5)
                            if early: break
                    except BaseException as actual: assert actual is (error or close_error)
                    else: assert error is None and close_error is None
                    try: await response.aclose()
                    except BaseException as actual: assert actual is close_error
                    assert seen == (values[:1] if early else values)
                    assert all(actual is expected for actual,expected in zip(seen,values))
                verify(before,stream,seen,error,close_error,sse,early,timing)
            stream=AsyncStream([b'nonstream ',b'body']);before=len(timings)
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request:httpx.Response(200,stream=stream)),
                                        event_hooks={'request':[prepare]}) as client:
                assert (await client.post('https://observer.invalid/responses',json=body)).content == b'nonstream body'
            verify(before,stream,stream.values,None,None,False)
            error=httpx.ConnectError('do-not-log-send-text')
            async def fail(request): raise error
            async with httpx.AsyncClient(transport=httpx.MockTransport(fail),event_hooks={'request':[prepare]}) as client:
                try: await client.post('https://observer.invalid/responses',json=body)
                except BaseException as actual: assert actual is error
                else: raise AssertionError('send error was swallowed')
            assert timings[-1]['send_error_type']=='ConnectError' and 'headers_received_seconds' not in timings[-1]
        asyncio.run(async_cases())
        error=httpx.ConnectError('do-not-log-send-text')
        def fail(request): raise error
        with httpx.Client(transport=httpx.MockTransport(fail),event_hooks={'request':[credential.prepare_request]}) as client:
            try: client.post('https://observer.invalid/responses',json=body)
            except BaseException as actual: assert actual is error
            else: raise AssertionError('send error was swallowed')
        assert timings[-1]['send_error_type']=='ConnectError' and 'headers_received_seconds' not in timings[-1]
        count=len(timings)
        with httpx.Client(transport=httpx.MockTransport(lambda request:httpx.Response(200,content=b'unmanaged'))) as client:
            assert client.post('https://observer.invalid/unmanaged',json=body).content == b'unmanaged'
        assert len(timings)==count
        assert all(item['body_unchanged'] and item['input_structure']['input']['item_count']==2 for item in observed)
        encoded=json.dumps(logs)
        assert all(value not in encoded for value in ('DO_NOT_LOG_BODY','DO_NOT_LOG_OUTPUT','do-not-log-'))
    finally:
        restore()
        clock_patch.stop()
    return {'httpx_version':httpx.__version__, 'sync_async_chunks_preserved':True,
            'errors_propagated_unchanged':True, 'close_preserved':True, 'non_sse_preserved':True,
            'early_close_not_eof':True, 'nonstream_send_preserved':True,
            'unmanaged_skipped':True, 'metadata_only':True, 'fake_attempts':len(timings),
            'iterator_consumer_timing_separated':True}

if args.driver == 'aino':
    import httpx
    wire_httpx_version = httpx.__version__
    if not args.live:
        wire_observer_self_check = check_wire_observer()
        progress('wire_observer_self_check', **wire_observer_self_check)
    from agent.auxiliary_billing_scope import ManagedCredential
    install_wire_observer(ManagedCredential, wire_attempts, wire_transports, record)

# The normal managed binding RPC uses exactly two authenticated transports.
import uvicorn
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute, Route
from starlette.responses import StreamingResponse, JSONResponse
from websockets.sync.client import connect
from tui_gateway import server as srv
from tui_gateway.ws import handle_ws
from hermes_cli.plugins import PluginContext, get_plugin_manager
from hermes_cli.plugins_manifest import PluginManifest

cap_event = threading.Event()
# SIGTERM can come from the spend monitor, watchdog, or caller; the signal alone
# does not establish that an internal request/input/output threshold fired.
external_signal_event = threading.Event()
signal.signal(signal.SIGTERM, lambda *_: external_signal_event.set())
billing_seen = set()
input_ceiling_observations = []

def pre_request(**kw):
    request_payload=kw.get('request') or {}
    body = request_payload.get('body') or {}
    from tui_gateway.managed_model_usage import current_usage_metadata
    billing = current_usage_metadata().get('billing') or {}
    if billing.get('session_id') and billing['session_id'] not in billing_seen:
        billing_seen.add(billing['session_id']);progress('billing_identity',session_id=billing['session_id'])
    system = kw.get('system_prompt') or ''
    if not isinstance(system,str): system = json.dumps(system,sort_keys=True,ensure_ascii=False)
    history = kw.get('conversation_history') or []
    item = {'session_id':kw.get('session_id'),'api_request_id':kw.get('api_request_id'),
        'turn_id':kw.get('turn_id'),'model':kw.get('model'),'api_call_count':kw.get('api_call_count'),'retry_count':kw.get('retry_count'),
        'approx_input_tokens':kw.get('approx_input_tokens'),'system_hash':hashlib.sha256(system.encode()).hexdigest(),
        'wire_reasoning':body.get('reasoning'),'wire_reasoning_effort':body.get('reasoning_effort'),'api_mode':kw.get('api_mode'),'hook_request_truncated':bool(request_payload.get('_truncated')),'hook_request_has_body':isinstance(request_payload.get('body'),dict),'wire_max_output_tokens':body.get('max_output_tokens'),
        'ultra_notes':sum('[Ultra mode on:' in str(m.get('api_content',m.get('content',''))) for m in history if isinstance(m,dict)),
        'ultra_in_system':'[Ultra mode on:' in system}
    if args.replay_source:
        compared=system.replace(str(profile),str(replay_source/'profile'))
        compared_hash=hashlib.sha256(compared.encode()).hexdigest()
        item.update(replay_profile_path_occurrences=system.count(str(profile)),
            replay_system_hash_with_source_profile=compared_hash,
            replay_system_diff_is_profile_paths_only=replay_data['system_hashes_by_session'][replay_data['stored_session_id']]==[compared_hash])
    # Keep publication, accounting and the observation on the same snapshot. Child hooks
    # share this RLock; record() re-enters it without allowing another hook to interleave.
    with log_lock:
        requests.append(item)
        record('pre_api_request',**item)
        observation=observe_input_ceiling(requests,responses,input_ceiling_observations,
            limit=input_limit,phase='pre_request',api_request_id=item.get('api_request_id'),
            seconds=round(time.monotonic()-t0,3))
        record('input_ceiling_observation',**observation)
        if not observation['accounting_complete']:
            caps.append('input_accounting_incomplete');cap_event.set()
        # Observe even the last allowed request: short-circuiting here loses the peak.
        if len(requests)>=request_limit or observation['stop_required']:
            if len(requests)>=request_limit or observation['crossed']:
                caps.append('aggregate_request_or_input_threshold')
            cap_event.set()
def post_request(**kw):
    item = {key:kw.get(key) for key in ('session_id','api_request_id','turn_id','api_call_count','api_duration','finish_reason','usage')}
    with log_lock:
        responses.append(item)
        record('post_api_request',**item)
        observation=observe_input_ceiling(requests,responses,input_ceiling_observations,
            limit=input_limit,phase='post_request',api_request_id=item.get('api_request_id'),
            seconds=round(time.monotonic()-t0,3))
        record('input_ceiling_observation',**observation)
        if not observation['accounting_complete']:
            caps.append('input_accounting_incomplete');cap_event.set()
        if observation['stop_required']:
            if observation['crossed']: caps.append('aggregate_request_or_input_threshold')
            cap_event.set()
        output=sum(int((r.get('usage') or {}).get('output_tokens') or (r.get('usage') or {}).get('completion_tokens') or 0) for r in responses)
        if output>=60000: caps.append('aggregate_output_threshold');cap_event.set()
observer = PluginContext(PluginManifest(name='ultra-acceptance-observer'),get_plugin_manager())
observer.register_hook('pre_api_request',pre_request)
observer.register_hook('post_api_request',post_request)
if args.replay_source:
    def stop_redelegation(tool_name='', args=None, **kw):
        if tool_name!='delegate_task' or ((args or {}).get('action') or '').strip().lower() not in ('spawn',''):
            return None
        record('replay_redelegation_attempt',tool_name=tool_name,tool_call_id=kw.get('tool_call_id'))
        caps.append('replay_redelegation_attempt');cap_event.set()
        with srv._sessions_lock:
            replay_agent=(srv._sessions.get(sid) or {}).get('agent')
        if replay_agent is not None:
            replay_agent.interrupt('Parent-only replay boundary',hard_cancel=True)
        return {'action':'block','message':'Parent-only replay stopped before creating a new child.'}
    observer.register_hook('pre_tool_call',stop_redelegation)

async def endpoint(ws):
    if ws.query_params.get('token') != ws_token:
        await ws.close(code=1008);return
    await handle_ws(ws,auth_identity={'provider':'isolated-acceptance','user_id':'local-test-user'})

# The dry endpoint drives a real parallel delegation and automatic result continuation.
# Its outputs are explicitly scripted and are never used as evidence of LLM judgment.
dry_partial_seen = {}
async def model_endpoint(req):
    import asyncio
    body = await req.json()
    if req.url.path != '/v1/responses': return JSONResponse({'error':'dry protocol expects Responses API'},status_code=400)
    inputs = body.get('input') or []; serialized=json.dumps(inputs,ensure_ascii=False)
    record('dry_model_request',keys=list(body),stream=body.get('stream'),input_types=[x.get('type') for x in inputs],tool_names=[x.get('name') for x in body.get('tools') or []])
    names=[x.get('name') for x in body.get('tools') or []]
    child = 'delegate_task' not in names and 'LOCAL_CHILD_PROBE' in serialized
    outputs=[x for x in inputs if x.get('type')=='function_call_output']
    is_large = args.scenario=='large' and not child
    final=False; name='read_file'; arguments={'path':str(workspace / ('agent/compaction_display.py' if args.scenario=='large' else 'auth.py'))}
    text='Local model finished.'
    if child:
        if outputs:
            child_index=int(re.search(r'LOCAL_CHILD_PROBE ([0-2])',serialized).group(1))
            if args.independent_completions:
                if child_index:
                    await asyncio.wait_for(dry_partial_seen.setdefault(child_index-1,asyncio.Event()).wait(),45)
            else:
                await asyncio.sleep(2)
            final=True;text=f'LOCAL_CHILD_RESULT_{child_index}: checked the fixture and finished.'
            if args.evidence_contract:
                text=json.dumps({'findings':[{'claim':f'LOCAL_CHILD_RESULT_{child_index}: scripted transport sample only.',
                    'status':'needs_verification','trigger':'No semantic evaluation in a scripted dry run.',
                    'evidence':[{'file':'agent/compaction_display.py','line_start':1,'line_end':1,
                                 'reason':'Fixture reference only; this is not a defect claim.'}]}],
                    'limitations':['Scripted output verifies transport and schema only.']},ensure_ascii=False)
            if recorded_child_results is not None:
                text=recorded_child_results[child_index]
    elif is_large:
        if 'ASYNC DELEGATION BATCH COMPLETE' in serialized:
            if args.independent_completions:
                received={int(i) for i in re.findall(r'LOCAL_CHILD_RESULT_([0-2])',serialized)}
                for index in received: dry_partial_seen.setdefault(index,asyncio.Event()).set()
                record('dry_parent_received',child_indexes=sorted(received))
                if received=={0,1}:
                    # Reproduce a partial final AFTER the last child completes.
                    # The old acceptance predicate then mistakes this for the
                    # total final while the next notification turn is running.
                    child_deadline=time.monotonic()+15
                    while True:
                        with log_lock:
                            last_finished=any(e.get('event')=='subagent.complete' and e.get('payload',{}).get('task_index')==2 for e in events)
                        if last_finished: break
                        if time.monotonic()>=child_deadline: raise TimeoutError('dry final child did not complete')
                        await asyncio.sleep(.02)
                    record('dry_partial_race_armed',child_indexes=sorted(received))
                if received=={0,1,2}:
                    record('dry_total_final_delay',seconds=5)
                    await asyncio.sleep(5)
                final=True;text=('LOCAL_PARENT_FINAL: received every child result automatically.' if len(received)==3 else 'LOCAL_PARENT_PARTIAL: incorporated available evidence; remaining children still pending.')
            else:
                if recorded_child_results is not None:
                    incoming_text='\n'.join(x.get('content','') if isinstance(x.get('content'),str)
                        else '\n'.join(p.get('text','') for p in x.get('content',[]) if isinstance(p,dict))
                        for x in inputs)
                    record('dry_recorded_summaries_received',summary_present={str(i):summary in incoming_text
                        for i,summary in recorded_child_results.items()})
                final=True;text='LOCAL_PARENT_FINAL: received every child result automatically.'
        elif outputs:
            final=True;text='LOCAL_PARENT_WAIT: three independent children are running.'
        else:
            name='delegate_task';arguments={'tasks':[{'goal':'LOCAL_CHILD_PROBE '+str(i)+': read '+str(workspace/'agent/compaction_display.py')+' and return one sentence.','context':'Dry transport probe. Read only.'} for i in range(3)]}
            if args.evidence_contract:
                for task in arguments['tasks']:
                    task['goal']=task['goal'].replace('and return one sentence.','and return evidence JSON with findings and limitations.')
                    task['context']='Dry transport probe. Read only. Supply evidence and uncertainty; parent owns final report formatting.'
                    task['output_schema']=evidence_schema
    elif outputs: final=True
    if args.scenario=='daily':
        completed_count=len(outputs)
        if completed_count==0:
            name='read_file';arguments={'path':str(workspace/'SPEC.md')};final=False
        elif completed_count==1:
            name='write_file';arguments={'path':str(workspace/'test_dry_transport.py'),'content':'import unittest\nfrom pathlib import Path\nclass TransportSmoke(unittest.TestCase):\n    def test_fixture_present(self):\n        self.assertTrue(Path(__file__).with_name("SPEC.md").is_file())\n'};final=False
        elif completed_count==2:
            name='terminal';arguments={'command':str(Path(sys.executable))+' -B -m unittest discover -v','timeout':30};final=False
        else:
            final=True;text='LOCAL_DAILY_DRY_FINAL: fixture read, test file written, unittest invoked. No source repair was attempted by this scripted transport probe.'
    if is_replay: final=True;text='LOCAL_REPLAY_FINAL: automatic completion notification consumed the original three real child summaries.'
    if args.replay_dry_redelegate:
        final=False;name='delegate_task';arguments={'goal':'LOCAL_REPLAY_SHOULD_NOT_SPAWN: no model task may start.'}
    if args.scenario=='length': final=True;text='访问控制：存在认证和管理员授权缺陷。\n支付与退款：存在并发重复入账和退款边界缺陷。\n租户导出隔离：缓存命中绕过所有权检查。\n优先风险：缓存越权可泄露跨租户数据。'
    uid=uuid.uuid4().hex
    item={'id':'msg_'+uid,'type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':text,'annotations':[]}]} if final else {'id':'fc_'+uid,'type':'function_call','call_id':'call_'+uid,'name':name,'arguments':json.dumps(arguments),'status':'completed'}
    record('dry_model_response',item=item)
    async def chunks():
        packets=[{'type':'response.output_item.added','output_index':0,'item':item}]
        if final: packets.append({'type':'response.output_text.delta','item_id':item['id'],'output_index':0,'content_index':0,'delta':text})
        packets += [{'type':'response.output_item.done','output_index':0,'item':item},{'type':'response.completed','response':{'id':'resp_'+uid,'object':'response','model':body['model'],'status':'completed','output':[item],'usage':{'input_tokens':100,'output_tokens':20,'total_tokens':120}}}]
        for p in packets: yield ('event: '+p['type']+'\ndata: '+json.dumps(p)+'\n\n').encode()
    return StreamingResponse(chunks(),media_type='text/event-stream')

ws_token=uuid.uuid4().hex
listener=socket.socket();listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
app=Starlette(routes=[WebSocketRoute('/api/ws',endpoint),Route('/v1/responses',model_endpoint,methods=['POST'])])
started=threading.Event()
class Server(uvicorn.Server):
    async def startup(self,sockets=None):
        await super().startup(sockets);started.set()
http_server=Server(uvicorn.Config(app,lifespan='off',log_config=None,access_log=False))
server_thread=threading.Thread(target=http_server.run,kwargs={'sockets':[listener]},daemon=True);server_thread.start()
if not started.wait(15): raise RuntimeError('Local gateway failed to start')
if not lease:
    origin=f'http://127.0.0.1:{port}'
    lease={'origin':origin,'user_id':'local-fixture-user','model':{'id':'local-fixture','model':'gpt-5.6-sol','api_mode':'responses','capabilities':{'tools':True,'vision':False,'reasoning':True}},'api_key':'local-fixture-no-secret','credential_id':'local-fixture-lease','base_url':origin+'/v1','expires_at':(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()}
    secret=lease['api_key']

class Client:
    def __init__(self,label):
        self.label=label;self.seq=0;self.pending={};self.lock=threading.Lock()
        self.ws=connect(f'ws://127.0.0.1:{port}/api/ws?token={ws_token}',open_timeout=15,close_timeout=3,max_size=16*1024*1024)
        self.thread=threading.Thread(target=self.reader,daemon=True);self.thread.start()
    def reader(self):
        try:
            for text in self.ws:
                for line in text.splitlines():
                    msg=json.loads(line)
                    if msg.get('method')=='event':
                        p=msg.get('params') or {};typ=p.get('type');payload=p.get('payload') or {}
                        record('event',transport=self.label,event=typ,session_id=p.get('session_id'),payload=payload)
                        if typ in ('subagent.start','subagent.complete','message.complete','error'):
                            progress(typ,session_id=p.get('session_id'),status=payload.get('status'),chars=len(str(payload.get('text') or '')),subagent_id=payload.get('subagent_id'))
                    elif msg.get('method') and msg.get('id'):
                        # A real permission request is not silently approved by this harness.
                        record('server_request',method=msg['method'],params=msg.get('params'))
                        if msg['method']=='approval': result={'choice':'deny'}
                        elif msg['method']=='clarify':
                            caps.append('requires_user_input');cap_event.set();result={'answer':''}
                        else:
                            self.ws.send(json.dumps({'jsonrpc':'2.0','id':msg['id'],'error':{'code':-32601,'message':'Isolated test client has no such UI surface'}}));continue
                        self.ws.send(json.dumps({'jsonrpc':'2.0','id':msg['id'],'result':result},ensure_ascii=False))
                    elif 'id' in msg:
                        with self.lock: target=self.pending.get(msg['id'])
                        if target: target.put(msg)
        except Exception as exc:
            record('client_closed',transport=self.label,error_type=type(exc).__name__)
    def rpc(self,method,params,timeout=90):
        with self.lock:
            self.seq+=1;n=self.seq;result=queue.Queue();self.pending[n]=result
        self.ws.send(json.dumps({'jsonrpc':'2.0','id':n,'method':method,'params':params},ensure_ascii=False))
        try:
            msg=result.get(timeout=timeout)
            if 'error' in msg: raise RuntimeError(method+': '+safe(msg['error']))
            return msg.get('result')
        finally:
            with self.lock: self.pending.pop(n,None)
    def close(self): self.ws.close();self.thread.join(5)

report={'scenario':args.scenario,'live':args.live,'run_dir':str(run),'repo':str(REPO),'prompt':prompt,'config':config,'fixture_hashes':fixture_before,'review_skill_hashes':skill_hashes,'note':'Real desktop WebSocket RPC, real managed model binding, real tools and asynchronous delivery. Dry outputs are scripted transport evidence only. Input and output thresholds interrupt after observation; Observed cost is a budget target, not a monetary hard cap.'}
report['budget_target_usd']={'length':1,'replay':2,'daily':1.5,'daily_replay':1}.get(args.scenario,5)
if args.spend_target is not None: report['budget_target_usd']=args.spend_target
report['execution_workspace']=str(execution_workspace)
report['matched_comparison']=comparison
report['independent_completions']=bool(args.independent_completions)
if recorded_child_results is not None:
    report['recorded_child_results']={'source_run':str(recorded_child_source),
        'summary_sha256':{str(i):hashlib.sha256(summary.encode()).hexdigest() for i,summary in recorded_child_results.items()},
        'boundary':'Offline scripted child answers replay saved real JSON through normal batch aggregation. The parent is scripted; this does not validate model reasoning.'}
report['evidence_contract']={'enabled':bool(args.evidence_contract),'schema':evidence_schema if args.evidence_contract else None,
    'base_prompt_sha256_ignoring_workspace':base_prompt_sha256,
    'boundary':'Explicit task-contract intervention, not forced dispatch or runtime rewriting of model tool calls; JSON validity does not prove findings.'}
report['diagnostic']={'review_skill':args.review_skill, 'original_acceptance_eligible':args.review_skill=='original' and not args.matched_comparison, 'boundary':'Removing the custom review skill changes the review instructions. A final answer here does not pass the original skill-bearing acceptance. Historical comparison is not a randomized causal estimate.' if args.review_skill=='none' else 'Original review skill policy unchanged.'}
report['limits']={'seconds':args.budget,'requests':request_limit,'approx_cumulative_input':input_limit,'cumulative_input_basis':'input_excluding_cache_reads','cumulative_input_policy':'acceptance_policy_change: looser than the superseded approx_represented_input basis; runs under the two bases are not comparable','observed_spend_target_usd':report['budget_target_usd'],'monetary_hard_cap':False}
if args.input_cap is not None:
    # Self-labelling so a diagnostic probe can never be read as a within-budget pass later.
    report['limits']['scenario_ceiling_overridden']=True
    report['limits']['scenario_ceiling_default']=500000 if args.scenario in ('daily','daily_replay') else 2000000
    report['limits']['diagnostic_note']='Input ceiling raised for a headroom probe. The whole-task budget acceptance does NOT apply to this run.'
if length_source is not None:
    report['length_source']={'report':str(length_source_path),'text_sha256':hashlib.sha256(length_source.encode()).hexdigest(),'purpose':'Final formatting/counting regression probe only; not the full large-task acceptance.'}
if replay_data:
    report['replay']={'source_run':str(replay_source),'source_stored_session_id':replay_data['stored_session_id'],'source_delegation_id':replay_event['delegation_id'],'seed_rows':len(replay_prefix),'seed_tool_call_ids':sorted(seed_tool_ids),'seed_history_sha256':hashlib.sha256(json.dumps(replay_prefix,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'results_sha256':hashlib.sha256(json.dumps(replay_result,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'source_fixture_hashes':replay_fixture_before,'boundary':'Replay of the parent phase using real stored child results; children are not rerun. The normal completion notification is the only new model input. This is not a fresh full-task acceptance.'}
    if args.replay_source:
        report['replay'].update(source_prompt_preserved=prompt==replay_data['prompt'],
            source_config_preserved=args.live, redelegation_boundary='Existing pre_tool_call blocks spawn and hard-stops this experiment; tools schema is retained. A triggered stop is failed replay, not a recovered success.',
            budget_scope='Fresh parent-only limits; earlier parent/child spending and elapsed time are not charged to this replay. Success cannot pass the original whole-run budget.')
def run_daily_verification(command):
    try:
        completed=subprocess.run(command,cwd=execution_workspace,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,text=True,timeout=45)
        return {'command':command,'returncode':completed.returncode,'stdout':completed.stdout,'stderr':completed.stderr}
    except subprocess.TimeoutExpired as exc:
        return {'command':command,'timeout':True,'stdout':str(exc.stdout or ''),'stderr':str(exc.stderr or '')}
if args.scenario=='daily':
    report['daily']={'fixture_source':str(source),'fixture_source_files':len(fixture_before),'fixture_bytes':sum((workspace/n).stat().st_size for n in fixture_before),'skill_installed':False,'boundary':'Independent small daily repair sample; delegation is observed, not mandatory. This does not replace the large-task acceptance.','limits':{'seconds':args.budget,'requests':request_limit,'approx_cumulative_input':500000,'observed_spend_target_usd':report['budget_target_usd'],'monetary_hard_cap':False}}
    report['daily']['baseline_contract']=run_daily_verification([sys.executable,'-B',str(SOURCE_ROOT/'daily_contract.py'),str(workspace)])
chat=main=None;stop_reason=None
try:
    chat=Client('chat');main=Client('main')
    chat.rpc('client.capabilities',{'server_requests':True})
    main.rpc('client.capabilities',{'server_requests':True})
    if replay_data:
        from hermes_state import SessionDB
        seed_db=SessionDB(db_path=profile/'state.db')
        seed_config={'model_source':'aino','model_id':lease['model']['id'],'model':lease['model']['model'],'api_mode':lease['model']['api_mode'],'provider':'aino','reasoning_config':{'enabled':True,'effort':'ultra'}}
        seed_db.create_session(replay_stored_id,'desktop',model=lease['model']['model'],model_config=seed_config,user_id='local-test-user',cwd=str(replay_source/'workspace'))
        seed_db.replace_messages(replay_stored_id,replay_prefix)
        seed_db.set_session_hidden(replay_stored_id,True)
        seed_db.set_session_title(replay_stored_id,'TEST Ultra parent completion replay')
        seeded=seed_db.get_messages_as_conversation(replay_stored_id,repair_alternation=False)
        fields=('role','content','api_content','tool_calls','tool_call_id','codex_reasoning_items','codex_message_items')
        for original, restored in zip(replay_prefix,seeded,strict=True):
            for key in fields:
                if key in original: assert restored.get(key)==original[key], (key,'seed persistence changed model input')
        seed_db.close()
        created=chat.rpc('session.resume',{'session_id':replay_stored_id,'source':'desktop','lazy':True,'close_on_disconnect':True})
        sid=created['session_id'];stored_sid=replay_stored_id
        report['replay']['seed_roundtrip_verified']=True
    else:
        created=chat.rpc('session.create',{'source':'desktop','cwd':str(workspace),'model_source':'aino','model_id':lease['model']['id'],'reasoning_effort':'ultra','close_on_disconnect':True,'hidden':True,'title':'TEST Ultra acceptance '+args.scenario})
        sid=created['session_id'];stored_sid=created['stored_session_id']
    report.update(session_id=sid,stored_session_id=stored_sid)
    owner={'platform_origin':lease['origin'],'user_id':str(lease['user_id'])}
    common={'session_id':sid,'model_id':lease['model']['id'],'owner':owner}
    ticket=chat.rpc('session.managed_model_ticket',common)['session_ticket']
    revision=main.rpc('session.claim_managed_model',dict(common,session_ticket=ticket))['binding_revision']
    main.rpc('session.bind_managed_model',dict(common,binding_revision=revision,model=lease['model']['model'],api_mode=lease['model']['api_mode'],capabilities=lease['model']['capabilities'],api_key=secret,credential_id=lease['credential_id'],base_url=lease['base_url'],expires_at=lease['expires_at']))
    progress('session_ready',scenario=args.scenario,run_dir=str(run),session_id=sid,stored_session_id=stored_sid)
    if replay_data:
        # process.list is a read-only RPC whose normal _sess path builds the resumed agent and poller.
        chat.rpc('process.list',{'session_id':sid})
        from tools.async_delegation import _persist_dispatch, _push_completion_event
        from tools.process_registry_notifications import format_process_notification
        routed=dict(replay_event,session_key=stored_sid,origin_ui_session_id=sid,origin_session_id=stored_sid,parent_session_id=stored_sid)
        _persist_dispatch(routed)
        formatted=format_process_notification(routed)
        (run/'replayed-notification.txt').write_text(formatted)
        report['replay']['notification_sha256']=hashlib.sha256(formatted.encode()).hexdigest()
        report['replay']['routing_changes']={key:routed[key] for key in ('session_key','origin_ui_session_id','origin_session_id','parent_session_id')}
        _push_completion_event(routed,replay_result,replay_event['status'])
        report['submit']={'status':'notification_enqueued','method':'production completion queue; no prompt.submit'}
        progress('replay_enqueued',source_run=str(replay_source),seed_rows=len(replay_prefix),result_count=len(replay_result['results']))
    else:
        report['submit']=chat.rpc('prompt.submit',{'session_id':sid,'text':prompt})
    deadline=time.monotonic()+args.budget;last_status=0;candidate=None
    while True:
        timed_out=time.monotonic()>deadline
        if cap_event.is_set() or timed_out or external_signal_event.is_set():
            if cap_event.is_set():
                if 'replay_redelegation_attempt' in caps:
                    stop_reason='replay_redelegation_attempt'
                elif 'input_accounting_incomplete' in caps:
                    stop_reason='input_accounting_incomplete'
                else:
                    stop_reason='token_request_cap'
            else:
                stop_reason='timeout' if timed_out else 'external_signal'
            report['interrupt']=chat.rpc('session.interrupt',{'session_id':sid})
            record('harness_interrupt',reason=stop_reason);break
        with log_lock: snapshot=list(events)
        finals=[e for e in snapshot if e['kind']=='event' and e.get('event')=='message.complete' and e.get('session_id')==sid]
        starts={e['payload'].get('subagent_id') for e in snapshot if e['kind']=='event' and e.get('event')=='subagent.start'}
        done={e['payload'].get('subagent_id') for e in snapshot if e['kind']=='event' and e.get('event')=='subagent.complete'}
        last_child=max([e['time'] for e in snapshot if e.get('event')=='subagent.complete'] or [0])
        # A parent's partial answer can race the final child completion. Delivery ACKs
        # mean the notification turn was admitted, not that the model finished it.
        # Require every unit's durable delivery, the corresponding committed user
        # messages, and a settled parent turn before accepting a final answer.
        with srv._sessions_lock:
            completion_session=srv._sessions.get(sid) or {}
        with completion_session.get('history_lock',threading.RLock()):
            parent_running=bool(completion_session.get('running'))
            parent_thread=completion_session.get('_run_thread')
            parent_thread_alive=bool(parent_thread and parent_thread.is_alive())
            current_parent_sid=getattr(completion_session.get('agent'),'session_id',None) or stored_sid
        parent_starts=[e['time'] for e in snapshot if e['kind']=='event' and e.get('event')=='message.start' and e.get('session_id')==sid]
        latest_parent_start=max(parent_starts,default=0)
        final_time=finals[-1]['time'] if finals else None
        guard={'parent_running':parent_running,'parent_thread_alive':parent_thread_alive,
               'children_started':len(starts),'children_finished':len(done),
               'latest_parent_start':latest_parent_start,'latest_final_time':final_time,
               'last_child_time':last_child,'ledger_checked':False}
        eligible=bool(finals and starts<=done and final_time>=last_child and
                      final_time>=latest_parent_start and not parent_running and not parent_thread_alive)
        if eligible:
            conn=None
            try:
                conn=sqlite3.connect(f'file:{profile}/state.db?mode=ro',uri=True,timeout=.2)
                units=conn.execute('''SELECT delegation_id,state,delivery_state FROM async_delegations
                    WHERE origin_ui_session_id=? OR origin_session IN (?,?) ORDER BY delegation_id''',
                    (sid,stored_sid,current_parent_sid)).fetchall()
                unit_ids={row[0] for row in units}
                consumed={}
                for row_id,raw_metadata in conn.execute('''SELECT id,display_metadata FROM messages
                        WHERE role='user' AND display_kind='async_delegation_complete' ORDER BY id'''):
                    metadata=json.loads(raw_metadata or '{}')
                    if metadata.get('delegation_id') in unit_ids:
                        consumed[metadata['delegation_id']]=row_id
                pending=[row[0] for row in units if row[1] in ('running','stalling','finalizing') or row[2]!='delivered']
                missing=sorted(unit_ids-set(consumed))
                guard.update(ledger_checked=True,completion_units=[{'delegation_id':i,'state':s,'delivery_state':d} for i,s,d in units],
                             notification_message_ids=consumed,pending_unit_ids=pending,missing_notification_ids=missing)
                eligible=not pending and not missing
            except (sqlite3.Error,ValueError,TypeError) as exc:
                guard['ledger_error']=type(exc).__name__
                eligible=False
            finally:
                if conn is not None: conn.close()
        guard['eligible']=eligible
        report['completion_guard']=guard
        if eligible:
            signature=(final_time,latest_parent_start,tuple((u['delegation_id'],u['state'],u['delivery_state']) for u in guard['completion_units']),tuple(sorted(guard['notification_message_ids'].items())))
            if candidate != signature:
                candidate=signature;candidate_at=time.monotonic()
                record('final_candidate',**guard)
            guard['stable_idle_seconds']=round(time.monotonic()-candidate_at,3)
            if time.monotonic()-candidate_at>=3:
                report['final_event']=finals[-1];payload=finals[-1]['payload'];stop_reason='model_failure' if payload.get('status')=='error' or payload.get('error') or payload.get('failure_reason') or str(payload.get('text','')).startswith('⚠️ No reply:') else 'normal_final';break
        else:
            if candidate is not None: record('final_candidate_rejected',**guard)
            candidate=None
        if time.monotonic()-last_status>=15:
            with srv._sessions_lock: session=srv._sessions.get(sid) or {}; running=bool(session.get('running'));agent=session.get('agent')
            progress('progress',seconds=round(time.monotonic()-t0),children_started=len(starts),children_finished=len(done),api_requests=len(requests),parent_running=running)
            last_status=time.monotonic()
        time.sleep(.25)
    if stop_reason!='normal_final': time.sleep(2)
except Exception as exc:
    report.update(error_type=type(exc).__name__,error=str(exc));stop_reason='harness_error'
    if chat and sid:
        try: chat.rpc('session.interrupt',{'session_id':sid},timeout=10)
        except Exception: pass
finally:
    report['stop_reason']=stop_reason; report['elapsed_seconds']=round(time.monotonic()-t0,2)
    if sid:
        with srv._sessions_lock: session=srv._sessions.get(sid) or {};agent=session.get('agent'); history=list(session.get('history') or [])
        if agent:
            report['agent_state']={key:getattr(agent,key,None) for key in ('model','provider','reasoning_config','run_budget_seconds','max_iterations','max_tokens','session_input_tokens','session_output_tokens','session_reasoning_tokens','session_api_calls')}
            report['tool_names']=sorted(agent.valid_tool_names)
        report['history']=history
    if chat: chat.close()
    if main: main.close()
    http_server.should_exit=True;server_thread.join(10);listener.close()
    if replay_fixture_before is not None:
        replay_after=hashes(replay_source/'workspace')
        report['replay']['source_fixture_changed']=[p for p in set(replay_fixture_before)|set(replay_after) if replay_fixture_before.get(p)!=replay_after.get(p)]
    report['fixture_changed']=[p for p in set(fixture_before)|set(hashes(workspace)) if fixture_before.get(p)!=hashes(workspace).get(p)]
    with log_lock:
        report['requests']=list(requests);report['responses']=list(responses);report['caps']=list(caps)
        final_snapshot=cumulative_input_excluding_cache_reads(report['requests'],report['responses'])
        ceiling_observations=list(input_ceiling_observations)
    peak=max(ceiling_observations,key=lambda o:o['value'],default=None)
    first_crossing=next((o for o in ceiling_observations if o['crossed']),None)
    first_incomplete=next((o for o in ceiling_observations if not o['accounting_complete']),None)
    report['input_accounting']={**final_snapshot,'limit':input_limit,
        'policy':'acceptance_policy_change',
        'final_value':final_snapshot['input_excluding_cache_reads'],
        'peak_value':(peak or {}).get('value'),'peak_at':(peak or {}).get('seconds'),
        'peak_requests_recorded':(peak or {}).get('requests_recorded'),
        'first_crossing':first_crossing,'ever_crossed':first_crossing is not None,
        'first_incomplete':first_incomplete,'ever_incomplete':first_incomplete is not None,
        'observations':len(ceiling_observations),
        'superseded_basis':'approx_represented_input',
        'approx_represented_input':(None if final_snapshot['invalid_request_estimate_rows'] else
            sum(r['approx_input_tokens'] for r in report['requests'])),
        'boundary':'ACCEPTANCE POLICY CHANGE, not a correction of a miscount. The ceiling now bounds input excluding cache reads (uncached + cache writes, per unique request; a request without usable usage reserves its rough estimate, and conflicting duplicate usage also reserves). This is LOOSER than the superseded approx_represented_input basis, which summed each request whole re-presented context and was a coherent stricter policy bounding total context volume. Runs scored under the two bases are NOT comparable. The figure is not total new input (excluded cache reads were real input the provider processed) and not a cost (writes, reads and uncached input are priced differently). Because a reservation can be replaced by a smaller settled figure the value is non-monotonic, so final_value alone cannot show whether the ceiling was reached: read peak_value and first_crossing. If a request cannot be covered by complete usage or a valid estimate, or identity is missing, accounting_complete is false and input_accounting_incomplete stops the run independently of crossing the numeric ceiling; first_incomplete remains latched.'}
    report['wire_attempts']=wire_attempts
    report['wire_transports']=wire_transports
    report['wire_observer_self_check']=wire_observer_self_check
    report['wire_observation_limits']={
        'httpx_version':wire_httpx_version,
        'scope':'Aino-driver managed POST requests successfully prepared before the HTTPX attempt, independent of matched-comparison or review-skill mode; Codex-driver requests are not observed.',
        'timing':'Process-local monotonic time. Dispatch includes pool/connect/TLS/server wait; headers do not identify generation start.',
        'iterator_advance_seconds':'Cumulative time inside completed underlying next/anext calls, including EOF and read errors; may include network waiting and local transport work, never a provider CPU measurement.',
        'consumer_pause_seconds':'Cumulative time from yielding each raw chunk until consumer resume or explicit close; includes caller processing/scheduling. Excludes underlying close work. An unresumed, unclosed pause is not yet counted.',
        'timing_counter_availability':'Iterator/consumer counters exist only in reports recorded by this observer version. Missing fields in older snapshots mean unavailable, not zero; they cannot be reconstructed from dispatch/EOF timestamps.',
        'first_chunk':'First nonempty raw body chunk may be a heartbeat, not a model text token.',
        'sse':'First output-related SSE type can be a reasoning item, not final text. Only identity-encoded SSE, event fields or leading JSON type in a 4 KiB line prefix; absence is unknown.',
        'sizes':'body_bytes is the full serialized SDK body before hook truncation; per-item bytes/hashes use canonical JSON, not raw wire spans.',
        'implementation':'Harness-only HTTPX _send_single_request wrappers, validated against the reported HTTPX version; no retry/timeout/payload modifications.'}
    report['observed_usage']=summarize_observed_usage(report['responses'],report['requests'],'aino_hook')
    if usage_self_check is not None: report['usage_self_check']=usage_self_check
    if (profile/'state.db').exists():
        conn=sqlite3.connect(f'file:{profile}/state.db?mode=ro',uri=True);conn.row_factory=sqlite3.Row
        report['sessions']=[dict(r) for r in conn.execute('select id,parent_session_id,model,message_count,tool_call_count,end_reason from sessions')]
        report['db_messages']=[dict(r) for r in conn.execute('select session_id,role,content,tool_calls,tool_name from messages order by id')];conn.close()
    calls=[]
    for row in report.get('db_messages',[]):
        raw=row.get('tool_calls')
        if not raw:continue
        for call in json.loads(raw) if isinstance(raw,str) else raw:
            fn=call.get('function') or {};calls.append({'session_id':row['session_id'],'id':call.get('id'),'name':fn.get('name'),'arguments':fn.get('arguments')})
    report['tool_calls']=calls
    parent_all_calls=[c for c in calls if c['session_id']==stored_sid]
    parent_calls=[c for c in parent_all_calls if c['id'] not in seed_tool_ids]
    report['new_tool_calls']=[c for c in calls if c['id'] not in seed_tool_ids]
    report['parent_all_tool_counts']=dict(collections.Counter(c['name'] for c in parent_all_calls))
    report['seed_parent_tool_counts']=dict(collections.Counter(c['name'] for c in parent_all_calls if c['id'] in seed_tool_ids))
    report['parent_tool_counts']=dict(collections.Counter(c['name'] for c in parent_calls))
    report['children_finished']=[e['payload'] for e in events if e.get('event')=='subagent.complete']
    report['billing']=[(e['payload'].get('billing') or (e['payload'].get('turn_metrics') or {}).get('billing')) for e in events if e.get('event')=='message.complete' and (e['payload'].get('billing') or (e['payload'].get('turn_metrics') or {}).get('billing'))]
    report['system_hashes_by_session']={s:sorted({r['system_hash'] for r in report['requests'] if r['session_id']==s}) for s in {r['session_id'] for r in report['requests']}}
    report['parent_exact_duplicate_tools']=sum(n-1 for n in collections.Counter((c['name'],c['arguments']) for c in parent_calls).values() if n>1)
    report['parent_character_count_calls']=[c for c in parent_calls if c['name'] in ('execute_code','terminal') and any(t in str(c['arguments']) for t in ('len(','.length','wc -','字符','字数'))]
    if args.scenario=='daily':
        daily_report=report['daily']
        daily_report['modified_source_files']=[n for n in fixture_before if not (workspace/n).exists() or hashlib.sha256((workspace/n).read_bytes()).hexdigest()!=fixture_before[n]]
        daily_report['new_test_files']=[str(p.relative_to(workspace)) for p in workspace.rglob('test*.py') if str(p.relative_to(workspace)) not in fixture_before]
        daily_report['model_test_tool_calls']=[c for c in calls if c['name'] in ('terminal','execute_code') and 'unittest' in str(c['arguments'])]
        daily_report['all_exact_duplicate_tools']=sum(n-1 for n in collections.Counter((c['session_id'],c['name'],c['arguments']) for c in calls).values() if n>1)
        signatures=collections.defaultdict(list)
        for c in calls:
            if c['name'] in ('read_file','search_files'): signatures[(c['name'],c['arguments'])].append(c)
        daily_report['identical_reads_across_agents']=[{'name':key[0],'arguments':key[1],'calls':entries} for key,entries in signatures.items() if len({c['session_id'] for c in entries})>1]
        daily_report['source_diffs']={n:''.join(difflib.unified_diff((source/n).read_text().splitlines(True),(workspace/n).read_text().splitlines(True) if (workspace/n).exists() else [],fromfile='before/'+n,tofile='after/'+n)) for n in daily_report['modified_source_files']}
        if stop_reason=='normal_final':
            discovery=run_daily_verification([sys.executable,'-B','-m','unittest','discover','-v'])
            transcript=discovery.get('stdout','')+discovery.get('stderr','')
            count=re.search(r'Ran (\d+) tests?',transcript)
            discovery['tests_run']=int(count.group(1)) if count else None
            daily_report['independent_unittest']=discovery
            daily_report['final_contract']=run_daily_verification([sys.executable,'-B',str(SOURCE_ROOT/'daily_contract.py'),str(workspace)])
            daily_report['accepted']=bool(args.live and daily_report['modified_source_files'] and daily_report['new_test_files'] and daily_report['model_test_tool_calls'] and discovery.get('returncode')==0 and (discovery.get('tests_run') or 0)>0 and daily_report['final_contract'].get('returncode')==0)
        else: daily_report['accepted']=False
        daily_report['dry_note']='Scripted dry proves RPC/file-write/test invocation only; external behavior checks should still fail because dry does not implement repairs.' if not args.live else None
    if args.scenario=='daily_replay' and stop_reason=='normal_final':
        report['parent_replay_validation']={
            'independent_unittest':run_daily_verification([sys.executable,'-B','-m','unittest','discover','-v']),
            'external_contract':run_daily_verification([sys.executable,'-B',str(SOURCE_ROOT/'daily_contract.py'),str(execution_workspace)]),
            'no_new_children':not report['children_finished'] and not any(c['name']=='delegate_task' for c in report['new_tool_calls']),
            'requires_manual_final_answer_review':True,
        }
    (run/'report.json').write_text(safe(report))
    progress('finished',scenario=args.scenario,stop_reason=stop_reason,run_dir=str(run),report=str(run/'report.json'),children=len(report['children_finished']),parent_tools=report['parent_tool_counts'],fixture_changed=report['fixture_changed'])
    # Check the only secret this process knows did not reach any file it produced.
    leaked=[]
    for p in run.rglob('*'):
        if args.live and secret and p.is_file() and secret.encode() in p.read_bytes(): leaked.append(str(p.relative_to(run)))
    if leaked: progress('credential_leak_detected',paths=leaked);os._exit(3)
    out.flush();os._exit(0 if stop_reason=='normal_final' else 2)

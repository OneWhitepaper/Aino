// Disposable installer acceptance fixtures only. No discovery of installed state,
// user homes, keychains or credentials: every input is under an explicit root.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { resolveDesktopHermesHome } from '../../../apps/desktop/electron/data-paths.mjs';
import { smokeEnvironment } from './smoke-env.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MARKER = '.aino-windows-user-state-fixture.json';
const PURPOSE = 'aino-disposable-windows-installer-preservation';
const FORMAT_VERSION = 2;

function explicitRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('An absolute disposable --root is required');
  }
  return path.resolve(root);
}

function unsafe(message) {
  return Object.assign(new Error(message), { code: 'UNSAFE_FIXTURE_PATH' });
}

function safeFile(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':')
      || relative.split('/').some(part => !part || part === '.' || part === '..')
      || path.isAbsolute(relative)) {
    throw unsafe('Fixture path must stay below the disposable root');
  }
  let current = root;
  for (const part of ['', ...relative.split('/')]) {
    if (part) current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw unsafe(`Fixture symlink or junction is forbidden: ${relative}`);
    if (current !== path.join(root, relative) && !stat.isDirectory()) {
      throw unsafe(`Fixture parent is not a directory: ${relative}`);
    }
  }
  if (!fs.lstatSync(current).isFile()) throw unsafe(`Fixture is not a regular file: ${relative}`);
  return current;
}

function outputPath(root, output) {
  if (typeof output !== 'string' || !path.isAbsolute(output)) {
    throw new Error('Evidence paths must be absolute and outside the disposable root');
  }
  const file = path.resolve(output);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const canonicalRoot = fs.existsSync(root) ? fs.realpathSync(root) : root;
  const canonicalFile = path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
  const relative = path.relative(canonicalRoot, canonicalFile);
  if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error('Evidence paths must be outside the disposable root');
  }
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw unsafe('Evidence symlinks are forbidden');
  return file;
}

function writeEvidence(root, output, value) {
  fs.writeFileSync(outputPath(root, output), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function validateDocument(document) {
  if (document?.formatVersion !== FORMAT_VERSION || document.purpose !== PURPOSE
      || !Array.isArray(document.files) || document.files.length === 0) {
    throw new Error('Not an Aino disposable user-state fixture document');
  }
  return document;
}

const SEED_HISTORY = `
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[3])
from hermes_state import SessionDB

root = Path(sys.argv[1])
databases = []
for account in json.loads(sys.argv[2]):
    home = root / account["home"]
    for index, directory in enumerate([home, home / "profiles" / account["profile"]]):
        session = account["sessionIds"][index]
        with SessionDB(db_path=directory / "state.db") as db:
            db.create_session(session, source="desktop", model=account["model"],
                              model_config={"provider": "custom", "base_url": account["baseUrl"]},
                              user_id="platform:" + account["userId"],
                              profile_name="default" if index == 0 else account["profile"])
            db.set_session_title(session, "历史对话" if index == 0 else "Bot Chat")
            if index:
                db.set_session_hidden(session, True)
            messages = [
                db.append_message(session, role="user", content=account["displayName"] + "：请保留我的历史记录。"),
                db.append_message(session, role="assistant", content=account["displayName"] + "：历史回答和模型设置应在升级后保留。")
            ]
        databases.append({"path": (directory / "state.db").relative_to(root).as_posix(),
                          "sessionIds": [session], "messageIds": messages})
print(json.dumps(databases))
`;

function runPython(root, python, script, args) {
  if (typeof python !== 'string' || !path.isAbsolute(python)) throw new Error('An explicit absolute --python is required');
  const isolatedHome = path.join(root, '.fixture-environment');
  const env = smokeEnvironment(process.env, isolatedHome, root);
  return execFileSync(python, ['-c', script, root, ...args], {
    cwd: REPO, env: { ...env, HERMES_RUNTIME_DIR: path.join(isolatedHome, 'run'), PYTHONPATH: REPO, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Seed only an empty caller-owned directory; never merge into an installed account. */
export function seedUserState({ root, python, origin = 'https://fixture.invalid', primaryUserId = '17', secondaryUserId = '23', mockUrl = 'https://fixture.invalid/v1' }) {
  root = explicitRoot(root);
  if (fs.existsSync(root)) {
    if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory() || fs.readdirSync(root).length) {
      throw new Error('Seed requires an empty disposable root; existing user state is never overwritten');
    }
  }
  if (typeof python !== 'string' || !path.isAbsolute(python)) throw new Error('Seed requires an explicit absolute --python');
  const url = new URL(origin);
  if (url.username || url.password || !['https:', 'http:'].includes(url.protocol)) throw new Error('A credential-free account origin is required');
  origin = url.origin;
  if (!primaryUserId || !secondaryUserId || primaryUserId === secondaryUserId) throw new Error('Two distinct account ids are required');
  const endpoint = new URL(mockUrl);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || !['https:', 'http:'].includes(endpoint.protocol) || !['/', '/v1', '/v1/'].includes(endpoint.pathname)) {
    throw new Error('A credential-free mock origin or /v1 endpoint is required');
  }
  const baseUrl = `${endpoint.origin}/v1`;
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const files = [];
  const write = (relative, text) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(root, relative), text, { mode: 0o600 });
    files.push(relative);
  };
  const accounts = [
    { userId: primaryUserId, displayName: '测试账户甲', profile: 'research-alpha', model: 'fixture-alpha-coder' },
    { userId: secondaryUserId, displayName: '测试账户乙', profile: 'research-beta', model: 'fixture-beta-writer' },
  ].map(account => {
    const home = resolveDesktopHermesHome({ home: root, env: {}, accountWorkspace: { userData: root, origin, userId: account.userId } });
    return { ...account, origin, baseUrl, home: path.relative(root, home).split(path.sep).join('/'),
      sessionIds: [`fixture-history-${account.userId}`, `fixture-bot-${account.userId}`] };
  });
  for (const account of accounts) {
    const bot = `${account.home}/profiles/${account.profile}`;
    for (const home of [account.home, bot]) {
      write(`${home}/config.yaml`, `model:\n  default: ${account.model}\n  provider: custom\n  base_url: ${baseUrl}\n  context_length: 64000\ndisplay:\n  language: zh\n`);
      write(`${home}/.env`, `OPENAI_API_KEY=inert-fixture-${account.userId}-never-a-real-secret\n`);
      write(`${home}/SOUL.md`, `# ${account.displayName}的研究助手\n请保留我已有的工作方式。\n`);
    }
    write(`${bot}/profile.yaml`, `description: 升级保留测试助手\ndisplay_name: ${account.displayName}的助手\nui_meta:\n  hermes-bots:\n    title: ${account.displayName}的助手\n    shape: blobatar::sun\n    color: '#8b5cf6'\n`);
    write(`${account.home}/ui-preferences.json`, `${JSON.stringify({ version: 1, generation: `fixture-${account.userId}`, revision: 3,
      values: { 'hermes-desktop-theme-v2': 'aino', 'hermes-desktop-mode-v1': 'dark', 'hermes.desktop.sessionListDensity': 'compact' } })}\n`);
    write(`${account.home.replace(/\/home$/, '/desktop')}/active-profile.json`, `${JSON.stringify({ profile: 'default' })}\n`);
    write(`${account.home}/资料/升级保留.txt`, `${account.displayName}：这份用户文件必须原样保留。\n`);
    files.push(`${account.home}/state.db`, `${bot}/state.db`);
  }
  const databases = JSON.parse(runPython(root, python, SEED_HISTORY, [JSON.stringify(accounts), REPO]));
  files.push(MARKER);
  const fixture = { formatVersion: FORMAT_VERSION, purpose: PURPOSE, accounts, databases, files: files.sort() };
  fs.writeFileSync(path.join(root, MARKER), `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  return fixture;
}

/** Let the native driver retain a fixture's configured model without changing unrelated homes. */
export function fixtureAccountForHome({ root, home }) {
  root = explicitRoot(root);
  if (typeof home !== 'string' || !path.isAbsolute(home)) return null;
  const relativeHome = path.relative(root, path.resolve(home)).split(path.sep).join('/');
  if (!relativeHome || relativeHome.startsWith('../') || path.isAbsolute(relativeHome)) return null;
  if (!fs.lstatSync(path.join(root, MARKER), { throwIfNoEntry: false })) return null;
  const fixture = validateDocument(JSON.parse(fs.readFileSync(safeFile(root, MARKER), 'utf8')));
  const account = fixture.accounts.find(candidate => candidate.home === relativeHome);
  if (!account) return null;
  const expectedHome = resolveDesktopHermesHome({ home: root, env: {}, accountWorkspace: {
    userData: root, origin: account.origin, userId: account.userId,
  } });
  if (path.resolve(home) !== expectedHome) throw new Error('Fixture account does not match its production workspace scope');
  for (const file of ['config.yaml', 'state.db', `profiles/${account.profile}/profile.yaml`]) safeFile(root, `${relativeHome}/${file}`);
  return { ...account, relativeHome, home: expectedHome };
}

function hashFile(root, relative) {
  const bytes = fs.readFileSync(safeFile(root, relative));
  return { path: relative, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const READ_HISTORY = `
import json, sqlite3, sys
from pathlib import Path
root, selection = Path(sys.argv[1]), json.loads(sys.argv[2])
def rows(db, table, columns, ids):
    placeholders = ",".join("?" for _ in ids)
    return [dict(row) for row in db.execute(f"SELECT {columns} FROM {table} WHERE id IN ({placeholders}) ORDER BY id", ids)]
try:
    with sqlite3.connect((root / selection["path"]).as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        sessions = rows(db, "sessions", "id,source,user_id,profile_name,model,model_config,title,hidden", selection["sessionIds"])
        for session in sessions:
            if session["model_config"]:
                session["model_config"] = json.loads(session["model_config"])
        messages = rows(db, "messages", "id,session_id,role,content", selection["messageIds"])
        result = {"path": selection["path"], "kind": "session-db", "sessions": sessions, "messages": messages}
except (sqlite3.DatabaseError, ValueError):
    result = {"path": selection["path"], "kind": "session-db", "error": "unreadable-history"}
print(json.dumps(result, ensure_ascii=False))
`;

function readDatabase(root, python, selection) {
  safeFile(root, selection.path);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = `${selection.path}${suffix}`;
    if (fs.lstatSync(path.join(root, sidecar), { throwIfNoEntry: false })) safeFile(root, sidecar);
  }
  return JSON.parse(runPython(root, python, READ_HISTORY, [JSON.stringify(selection)]));
}

function recordedHistory(root, python, historyPath) {
  if (!historyPath) return null;
  const proof = JSON.parse(fs.readFileSync(outputPath(root, historyPath), 'utf8').replace(/^\uFEFF/, ''));
  if (proof.purpose !== 'aino-released-zip-history' || proof.status !== 'passed'
      || proof.legacyCommit !== '22a472fcbca8775f56c0f89374027b8e4c68ab5b'
      || fs.realpathSync(proof.userData) !== fs.realpathSync(root)) {
    throw new Error('History receipt is not the verified released ZIP in this userData');
  }
  const relativeHome = path.relative(fs.realpathSync(root), fs.realpathSync(proof.hermesHome));
  const account = fixtureAccountForHome({ root, home: path.resolve(root, relativeHome) });
  const chat = proof.storedChat;
  if (!account || chat?.profile !== 'default' || typeof chat.sessionId !== 'string'
      || !chat.sessionId || !Array.isArray(chat.messages) || chat.messages.length !== 2
      || chat.messages.some(row => !Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.content !== 'string')
      || chat.messages[0].role !== 'user' || chat.messages[1].role !== 'assistant') {
    throw new Error('Released ZIP history must identify two real rows in a fixture-owned account');
  }
  const selection = { path: `${account.relativeHome}/state.db`, sessionIds: [chat.sessionId],
    messageIds: chat.messages.map(row => row.id) };
  const actual = readDatabase(root, python, selection);
  if (actual.sessions?.length !== 1 || actual.messages?.length !== 2 || chat.messages.some(expected =>
    !actual.messages.some(row => row.id === expected.id && row.session_id === chat.sessionId
      && row.role === expected.role && row.content === expected.content))) {
    throw new Error('ZIP API history receipt disagrees with its actual stored rows');
  }
  return selection;
}

/** Static files and both seeded and real ZIP-written rows survive normal new history. */
export function snapshotUserState({ root, snapshotPath, python, historyPath }) {
  root = explicitRoot(root);
  const fixture = validateDocument(JSON.parse(fs.readFileSync(safeFile(root, MARKER), 'utf8')));
  const databases = new Map(fixture.databases.map(database => [database.path, database]));
  const recorded = recordedHistory(root, python, historyPath);
  if (recorded) {
    const seeded = databases.get(recorded.path);
    if (!seeded) throw new Error('Released ZIP history does not belong to a seeded database');
    databases.set(recorded.path, { path: recorded.path,
      sessionIds: [...new Set([...seeded.sessionIds, ...recorded.sessionIds])],
      messageIds: [...new Set([...seeded.messageIds, ...recorded.messageIds])] });
  }
  const files = fixture.files.map(relative => {
    const selection = databases.get(relative);
    if (!selection) return hashFile(root, relative);
    const history = readDatabase(root, python, selection);
    if (history.error || history.sessions.length !== selection.sessionIds.length || history.messages.length !== selection.messageIds.length) {
      throw new Error(`Seeded historical rows are missing or unreadable: ${relative}`);
    }
    return history;
  });
  const snapshot = { ...fixture, files };
  writeEvidence(root, snapshotPath, snapshot);
  return snapshot;
}

/** Content-only reports keep even inert secret fixture values out of CI evidence. */
export function verifyUserState({ root, snapshotPath, reportPath, python }) {
  root = explicitRoot(root);
  const snapshot = validateDocument(JSON.parse(fs.readFileSync(outputPath(root, snapshotPath), 'utf8')));
  const report = { ok: true, root, checked: snapshot.files.length, missing: [], changed: [], unsafe: [] };
  for (const expected of snapshot.files) {
    try {
      if (expected.kind === 'session-db') {
        const actual = readDatabase(root, python, { path: expected.path,
          sessionIds: expected.sessions.map(session => session.id), messageIds: expected.messages.map(message => message.id) });
        if (!isDeepStrictEqual(actual, expected)) report.changed.push(expected.path);
      } else {
        const actual = hashFile(root, expected.path);
        if (actual.size !== expected.size || actual.sha256 !== expected.sha256) report.changed.push(expected.path);
      }
    } catch (error) {
      if (error.code === 'ENOENT') report.missing.push(expected.path);
      else if (error.code === 'UNSAFE_FIXTURE_PATH') report.unsafe.push(expected.path);
      else throw error;
    }
  }
  report.ok = !report.missing.length && !report.changed.length && !report.unsafe.length;
  if (reportPath) writeEvidence(root, reportPath, report);
  return report;
}

function main(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    if (!['root', 'snapshot', 'report', 'python', 'origin', 'primary-user-id', 'secondary-user-id', 'mock-url', 'history'].includes(key) || options[key] || !args[index + 1]) {
      throw new Error('Usage: windows-user-state.mjs seed|snapshot|verify --root PATH [--python PATH] [--snapshot PATH] [--report PATH]');
    }
    options[key] = args[index + 1];
  }
  const input = { root: options.root, python: options.python, snapshotPath: options.snapshot, reportPath: options.report,
    origin: options.origin, primaryUserId: options['primary-user-id'], secondaryUserId: options['secondary-user-id'], mockUrl: options['mock-url'], historyPath: options.history };
  const handlers = {
    seed: () => { const fixture = seedUserState(input); if (options.snapshot) snapshotUserState(input); return fixture; },
    snapshot: () => snapshotUserState(input),
    verify: () => verifyUserState(input),
  };
  if (!handlers[command]) throw new Error('Expected seed, snapshot or verify command');
  const result = handlers[command]();
  if (options.report && command !== 'verify') writeEvidence(explicitRoot(options.root), options.report, result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.ok === false) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

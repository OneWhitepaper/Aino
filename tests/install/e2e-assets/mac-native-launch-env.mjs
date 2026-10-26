// ShipIt launches via NSWorkspace, which reads the GUI login environment rather
// than the Playwright child's environment. Keep only this disposable CI fixture
// routed to its sandbox, then restore the login environment after the native leg.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const keys = ['HERMES_HOME', 'HERMES_DESKTOP_USER_DATA_DIR', 'HERMES_DESKTOP_SKIP_QUIT_CONFIRM',
  'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy', 'SSL_CERT_FILE', 'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS'];
const runLaunchctl = args => spawnSync('/bin/launchctl', args, { encoding: 'utf8' });

function writeEnvironment(launchctl, key, value) {
  const result = launchctl(value === null ? ['unsetenv', key] : ['setenv', key, value]);
  if (result.status !== 0) throw new Error(`Could not configure native CI launch environment: ${key}`);
}

export function prepareNativeLaunchEnvironment(env, stateFile, launchctl = runLaunchctl) {
  const previous = keys.map(key => {
    const result = launchctl(['getenv', key]);
    if (![0, 1].includes(result.status)) throw new Error(`Could not read native CI launch environment: ${key}`);
    return [key, result.status === 0 ? result.stdout.replace(/\n$/, '') : null];
  });
  // Write before the first change so the shell EXIT trap can undo a partial preparation.
  fs.writeFileSync(stateFile, JSON.stringify({ previous }), { flag: 'wx', mode: 0o600 });
  for (const key of keys) writeEnvironment(launchctl, key, env[key] || null);
}

export function restoreNativeLaunchEnvironment(stateFile, launchctl = runLaunchctl) {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (state.restored) return;
  for (const [key, value] of state.previous) {
    if (!keys.includes(key) || (value !== null && typeof value !== 'string')) throw new Error('Invalid native CI environment receipt');
    writeEnvironment(launchctl, key, value);
  }
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, restored: true }), { mode: 0o600 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'darwin' || process.env.GITHUB_ACTIONS !== 'true' || process.argv[2] !== 'restore') {
    throw new Error('Native login environment changes are restricted to disposable macOS CI');
  }
  restoreNativeLaunchEnvironment(process.argv[3]);
}

// @ts-check
// mac-bundled-update-driver.mjs — click the REAL in-app update flow on the
// macOS packaged app: launch the installed OLD bundle binary under
// Playwright, reach Settings -> About, click "Update now", and wait for the
// app process to close.
//
// What this driver deliberately does NOT do:
//   - no internal apply call (no window.hermesDesktop.updates.apply or any
//     bridge invocation that would bypass the user trigger);
//   - no relaunch of the NEW app — Squirrel.Mac owns the swap and the
//     relaunch, and the external watcher
//     (mac-bundled-relaunch-watch.cjs) owns that proof;
//   - no killing of anything. The process-close contract from
//     process-close.cjs releases our stdio pipes instead of tree-killing,
//     so ShipIt's detached relaunch of the NEW bundle survives our exit.
//
// Usage (from the scratch dir with the driver's own @playwright/test):
//   node mac-bundled-update-driver.mjs --app-bin <.app/Contents/MacOS/Hermes> \
//     --shots <dir> --close-timeout-ms 420000

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { _electron } from '@playwright/test';
import { createRequire } from 'node:module';
import { runUpdateWindowChat } from './update-window-chat.mjs';
import { updateWindowEnvironment } from './smoke-env.mjs';
import { signInPlatformFixture } from '../../../tests-js/scripts/platform-account-fixture.ts';
import { writeMockProviderConfig } from '../../../tests-js/scripts/mock-provider-config.ts';

const require = createRequire(import.meta.url);
const { observeProcessClose } = require('./process-close.cjs');
const { prepareWindowForInput } = require('./window-input.cjs');
const { pickAppWindow, openAbout, waitForUpdate, waitForMacUpdateClose } = require('./update-ui.cjs');

const { values } = parseArgs({
  options: {
    'app-bin': { type: 'string' },
    shots: { type: 'string', default: '.' },
    'old-sha': { type: 'string' },
    'chat-out': { type: 'string' },
    'mock-url': { type: 'string' },
    'platform-account-env': { type: 'string' },
    'close-timeout-ms': { type: 'string', default: '420000' },
    'retry-legacy-verification-timeout': { type: 'boolean', default: process.env.HERMES_E2E_LEGACY_RETRY === 'true' },
  },
});

const log = message => console.log(`[mac-bundled-update] ${message}`);
const shot = async (page, name) => {
  try { await page.screenshot({ path: path.join(values.shots, `${name}.png`), fullPage: true }); } catch { /* window may be gone */ }
};

const appBin = values['app-bin'];
if (!appBin || !values['old-sha'] || !values['chat-out'] || !values['mock-url']) {
  throw new Error('--app-bin, --old-sha, --chat-out and --mock-url are required');
}
fs.mkdirSync(values.shots, { recursive: true });
fs.mkdirSync(values['chat-out'], { recursive: true });

log(`launching ${appBin}`);
// Preserve the exact environment for post-launch identity assertions. The
// driver process itself may name a different userData path.
const launchEnv = updateWindowEnvironment(
  process.env,
  path.resolve(path.dirname(appBin), '..', 'Resources', 'agent-payload'),
  'bundled',
);
if (values['platform-account-env']) {
  Object.assign(launchEnv, JSON.parse(fs.readFileSync(values['platform-account-env'], 'utf8')));
  writeMockProviderConfig(launchEnv.HERMES_HOME, values['mock-url'], 'language: en');
}
const app = await _electron.launch({
  executablePath: appBin,
  cwd: path.dirname(appBin),
  // Inherit the driver env: HERMES_HOME / HOME / updates feed config must
  // reach the main process exactly as a user's double-click would.
  env: launchEnv,
  chromiumSandbox: true,
  args: [`--user-data-dir=${launchEnv.HERMES_DESKTOP_USER_DATA_DIR}`],
  timeout: 120_000,
});
const child = app.process();
const waitForProcessClose = observeProcessClose(child);
const oldPid = await app.evaluate(() => process.pid);
log(`launched Electron pid=${oldPid}`);
fs.writeFileSync(path.join(values['chat-out'], 'old-pid'), `${oldPid}\n`);

const page = await pickAppWindow(app, log);

await prepareWindowForInput(app, page);
if (values['platform-account-env']) await signInPlatformFixture(page);

await runUpdateWindowChat(app, page, {
  mockUrl: values['mock-url'], outDir: values['chat-out'],
  expectCommit: values['old-sha'],
  origin: 'bundled', executable: appBin,
  root: path.resolve(path.dirname(appBin), '..', 'Resources', 'agent-payload'),
  userData: launchEnv.HERMES_DESKTOP_USER_DATA_DIR,
});
await shot(page, '01-app-booted');

await openAbout(page, { log, shot, prepare: () => prepareWindowForInput(app, page) });
const updateNow = await waitForUpdate(page, { log, shot });

// ── The click under test ────────────────────────────────────────────────
await updateNow.click();
log('clicked: Update now');
await new Promise(resolve => setTimeout(resolve, 1_200));
await shot(page, '05-updating-overlay');

// The MacStrategy signs off with quitAndInstall: the app quits and
// Squirrel.Mac swaps the bundle and relaunches. Wait for the native close
// (never the renderer's close event) and exit WITHOUT killing anything —
// observeProcessClose released our pipes, so ShipIt's relaunch survives.
const outcome = await waitForMacUpdateClose(page, waitForProcessClose, {
  timeoutMs: Number(values['close-timeout-ms']),
  allow: values['retry-legacy-verification-timeout'], log, shot,
});
fs.writeFileSync(path.join(values['chat-out'], 'apply-attempts.json'), JSON.stringify(outcome, null, 2) + '\n');
log('old Electron process closed — Squirrel.Mac owns the swap and relaunch');
fs.writeFileSync(path.join(values['chat-out'], 'old-exited'), new Date().toISOString() + '\n');
process.exit(0);

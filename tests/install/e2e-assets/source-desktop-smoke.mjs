// Read-only source checkpoint adapter. Tooling is resolved from the CI checkout,
// never from the historical installation. The standalone driver owns the app.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveDesktopArtifact } from './desktop-artifact.cjs';

const { values } = parseArgs({ options: {
  root: { type: 'string' }, home: { type: 'string' },
  'user-data': { type: 'string' }, out: { type: 'string' },
  phase: { type: 'string' }, 'expect-commit': { type: 'string' },
  desktop: { type: 'string' }, method: { type: 'string' },
  'mock-url': { type: 'string' },
} });
for (const key of ['root', 'home', 'user-data', 'out', 'phase', 'expect-commit', 'desktop', 'method']) {
  if (!values[key]) throw new Error(`--${key} is required`);
}
if (!['old', 'new'].includes(values.phase)) throw new Error('expected --phase old|new');
if (!['absent', 'present'].includes(values.desktop)) throw new Error('expected --desktop absent|present');
fs.mkdirSync(values.out, { recursive: true });
if (values.desktop === 'absent') {
  fs.writeFileSync(path.join(values.out, `desktop-chat-${values.phase}.json`), JSON.stringify({
    status: 'not-applicable', phase: values.phase, method: values.method,
    expectedCommit: values['expect-commit'], origin: 'source', reason: 'selected route does not install desktop',
  }, null, 2) + '\n');
} else try {
  fs.rmSync(path.join(values.out, `desktop-chat-${values.phase}.json`), { force: true });
  const artifact = resolveDesktopArtifact(values.root);
  if (!artifact) throw new Error(`No packaged desktop artifact matches the installed package in ${values.root}`);
  const driver = fileURLToPath(new URL('./desktop-smoke.ts', import.meta.url));
  const args = [driver, '--exe', artifact.executablePath, '--origin', 'source'];
  for (const key of ['root', 'home', 'user-data', 'out', 'phase', 'expect-commit']) args.push(`--${key}`, values[key]);
  const mockUrl = values['mock-url'] || process.env.HERMES_E2E_MOCK_URL;
  if (mockUrl) args.push('--mock-url', mockUrl);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: values.root });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Desktop smoke process failed: exit=${result.status}, signal=${result.signal}`);
} catch (error) {
  const receiptPath = path.join(values.out, `desktop-chat-${values.phase}.json`);
  const prior = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : {};
  fs.writeFileSync(receiptPath, JSON.stringify({ ...prior, status: 'failed', phase: values.phase,
    origin: 'source', expectedCommit: values['expect-commit'], method: values.method,
    error: String(error) }, null, 2) + '\n');
  console.error(error);
  process.exitCode = 1;
}

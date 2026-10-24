import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { runInstalledDesktopSmoke } from '../../tests/install/e2e-assets/desktop-smoke.ts'

test('post-update smoke accepts the explicitly isolated existing home without erasing history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-existing-home-'))
  const payload = path.join(root, 'resources', 'agent-payload')
  const home = path.join(root, 'home')
  fs.mkdirSync(payload, { recursive: true })
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(home, 'state.db'), 'existing user history')
  fs.writeFileSync(path.join(payload, '..', 'install-stamp.json'), JSON.stringify({ payload: 'bundled', bundleEnv: {} }))

  try {
    await expect(runInstalledDesktopSmoke({ exe: process.execPath, root: payload, origin: 'bundled',
      home, 'user-data': path.join(root, 'user-data'), out: path.join(root, 'proof'),
      phase: 'new', 'expect-commit': 'a'.repeat(40), 'mock-url': 'http://127.0.0.1:12345' },
    async () => { throw new Error('existing-home-launch-checkpoint') })).rejects.toThrow('existing-home-launch-checkpoint')
    expect(fs.readFileSync(path.join(home, 'state.db'), 'utf8')).toBe('existing user history')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('the parent mock keeps native account HTTPS available across an update-window exit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-account-'))
  const urlFile = path.join(root, 'mock.url')
  const envFile = path.join(root, 'account-env.json')
  const driver = path.resolve(import.meta.dirname, '../../tests/install/e2e-assets/mock-provider.mjs')
  const child = spawn(process.execPath, [driver, urlFile, '', envFile], { stdio: ['ignore', 'pipe', 'pipe'] })
  let transcript = ''
  child.stderr.on('data', chunk => { transcript += String(chunk) })

  try {
    await expect.poll(() => fs.existsSync(envFile), { timeout: 15_000 }).toBe(true)
    const env = JSON.parse(fs.readFileSync(envFile, 'utf8')) as Record<string, string>
    expect(fs.existsSync(urlFile), transcript).toBe(true)
    expect(env.HTTPS_PROXY).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(env.NODE_EXTRA_CA_CERTS).toBe(env.SSL_CERT_FILE)
    expect(env.NODE_USE_ENV_PROXY).toBe('1')

    // Independent OLD/NEW clients use the real HTTPS origin and native proxy
    // settings. The parent, rather than either window, owns the fixture.
    for (const phase of ['old', 'new']) {
      const client = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const r = await fetch('https://api.agentera.com.cn/api/v1/settings/public');
        const body = await r.json();
        if (!r.ok || body.data.desktop_api_version !== 1) process.exit(1);
      `], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15_000 })

      expect(client.status, `${phase}: ${client.stderr}\n${transcript}`).toBe(0)
    }

    expect((await fetch(`${fs.readFileSync(urlFile, 'utf8')}/__e2e__/prompts`)).ok).toBe(true)
  } finally {
    const closed = once(child, 'exit')
    child.kill('SIGTERM')
    await closed
    fs.rmSync(root, { recursive: true, force: true })
  }
}, 45_000)

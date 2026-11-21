import { execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import { expect, test } from 'vitest'

import { startPlatformServer } from '../../../../tests-js/scripts/platform-account-fixture'

import { stopFixtureChild, waitForFixtureOutput } from './account-fixture'
import { startHttpsEdge } from './github-edge'

test('daemon readiness handles split output and removes deadline/error listeners after success', async () => {
  const child = spawn(process.execPath, ['-e', `process.stdout.write('READY=');
    process.stdin.once('data', () => process.stdout.write('private\\n'));
    setInterval(() => {}, 1000)`], { stdio: ['pipe', 'pipe', 'pipe'] })

  try {
    const ready = waitForFixtureOutput(child, 'split fixture', /^READY=private\n/m)
    // The second write cannot happen until the parent observed the first chunk.
    child.stdout.once('data', () => child.stdin.end('continue'))
    expect(await ready).toBe('READY=private\n')
    expect(child.listenerCount('error')).toBe(0)
    expect(child.listenerCount('exit')).toBe(0)
    expect(child.stdout.listenerCount('data')).toBe(0)
    expect(child.stderr.listenerCount('data')).toBe(0)
    expect(child.stdin.listenerCount('error')).toBe(0)
  } finally {
    await stopFixtureChild(child)
  }
})

test('readiness fails on early exit or spawn error without retaining its timeout/listeners', async () => {
  const exited = spawn(process.execPath, ['-e', "process.stderr.write('fixture-startup-error'); process.exitCode=7"],
    { stdio: ['ignore', 'pipe', 'pipe'] })

  await expect(waitForFixtureOutput(exited, 'failed fixture', /READY/)).rejects.toThrow(/exited \(7\).*fixture-startup-error/)
  expect(exited.listenerCount('exit')).toBe(0)
  expect(exited.stderr.listenerCount('data')).toBe(0)
  const missing = spawn(path.join(os.tmpdir(), 'no-such-update-fixture', 'daemon'), [], { stdio: ['ignore', 'pipe', 'pipe'] })
  await expect(waitForFixtureOutput(missing, 'missing fixture', /READY/)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(missing.listenerCount('error')).toBe(0)
})

test.skipIf(process.platform === 'win32')('a readiness deadline and a daemon ignoring SIGTERM still have bounded cleanup', async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('STARTED'); setInterval(() => {}, 1000)"],
    { stdio: ['ignore', 'pipe', 'pipe'] })

  try {
    await waitForFixtureOutput(child, 'hung fixture', /^STARTED\n/m)
    await expect(waitForFixtureOutput(child, 'not ready fixture', /NEVER/, 50)).rejects.toThrow(/did not become ready/)
    expect(child.stdout.listenerCount('data')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
  } finally {
    await stopFixtureChild(child, 100)
  }

  expect(child.signalCode).toBe('SIGKILL')
  expect(child.listenerCount('exit')).toBe(0)
})

test.skipIf(process.platform === 'win32')('one verified TLS proxy serves GitHub and the real phone challenge/profile fixture without mixing hosts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update-account-edge-'))
  const account = await startPlatformServer()
  const run = promisify(execFile)
  const github: string[] = []

  const edge = await startHttpsEdge(root, {
    host: 'api.github.com', tunnelOthers: false,
    handler: (req, res) => { github.push(req.url ?? ''); res.end(JSON.stringify({ sha: 'a'.repeat(40) })) },
    additionalHosts: { 'api.agentera.com.cn': account.handler }
  })

  const request = async (host: string, route: string, body?: unknown, token?: string) => {
    const { stdout } = await run('curl', ['--silent', '--show-error', '--fail', '--proxy', edge.proxyUrl,
      '--noproxy', '', '--cacert', edge.caBundle, '-H', 'content-type: application/json',
      ...(token ? ['-H', `authorization: Bearer ${token}`] : []),
      ...(body ? ['--data', JSON.stringify(body)] : []), `https://${host}${route}`], { timeout: 5000 })

    return JSON.parse(stdout)
  }

  try {
    expect(await request('api.github.com', '/repos/fixture/repo/commits/main')).toEqual({ sha: 'a'.repeat(40) })
    expect((await request('api.agentera.com.cn', '/api/v1/settings/public')).data.phone_login_enabled).toBe(true)
    await expect(request('api.agentera.com.cn', '/api/v1/user/profile')).rejects.toMatchObject({ code: 22 })
    const challenge = await request('api.agentera.com.cn', '/api/v1/auth/phone/send-code', { phone: '+8613800138000' })
    await expect(request('api.agentera.com.cn', '/api/v1/auth/phone/verify', {
      challenge_id: challenge.data.challenge_id, code: '000000', agreement_revision: 'native-terms-1'
    })).rejects.toMatchObject({ code: 22 })

    const verified = await request('api.agentera.com.cn', '/api/v1/auth/phone/verify', {
      challenge_id: challenge.data.challenge_id, code: '246810', agreement_revision: 'native-terms-1'
    })

    expect((await request('api.agentera.com.cn', '/api/v1/user/profile', undefined, verified.data.access_token)).data.id).toBe(17)
    expect(account.requests.filter(row => row.authenticatedProfile)).toHaveLength(1)
    expect(github).toEqual(['/repos/fixture/repo/commits/main'])
    await expect(run('curl', ['--silent', '--show-error', '--fail', '--proxy', edge.proxyUrl, '--noproxy', '',
      'https://api.agentera.com.cn/api/v1/settings/public'], { timeout: 5000 })).rejects.toMatchObject({ code: 60 })

    const denied = await new Promise<string>((resolve, reject) => {
      const proxy = new URL(edge.proxyUrl)

      const socket = net.connect(Number(proxy.port), proxy.hostname, () => {
        socket.write('CONNECT unrelated.invalid:443 HTTP/1.1\r\nHost: unrelated.invalid:443\r\n\r\n')
      })

      socket.once('data', chunk => { resolve(chunk.toString()); socket.destroy() })
      socket.once('error', reject)
    })

    expect(denied).toContain('403 Forbidden')
    expect(edge.deniedConnects).toEqual(['unrelated.invalid:443'])
  } finally {
    await edge.close()
    await account.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

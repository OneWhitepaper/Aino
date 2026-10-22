import { spawn } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createInterface } from 'node:readline'

import { fixtureEnvironment, installLoopbackPythonGuard } from './platform-real-api'
import { processStartMarkerWithEnvironment } from './platform-workspace-proof'
import { expect, test } from './test'

const MARKER_ENV_KEYS = ['TZ', 'LANG', 'LC_ALL'] as const

function markerEnvironmentSnapshot() {
  return Object.fromEntries(MARKER_ENV_KEYS.map(key => [key, process.env[key]]))
}

test('probes a real backend PID with the guarded Electron timezone and restores the test environment', async () => {
  test.skip(process.platform !== 'darwin', 'macOS ps lstart renders in the caller timezone')

  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })

  expect(child.pid).toBeGreaterThan(0)

  const before = markerEnvironmentSnapshot()
  const guardedEnvironment = fixtureEnvironment()

  try {
    const fixtureMarker = await processStartMarkerWithEnvironment(child.pid!, guardedEnvironment)

    const hostMarker = await processStartMarkerWithEnvironment(child.pid!, {
      ...guardedEnvironment,
      TZ: 'Asia/Shanghai'
    })

    // This is the old comparison's RED: one real PID renders as a different
    // marker when the Playwright parent and guarded Electron use different TZs.
    expect(hostMarker).not.toBe(fixtureMarker)

    // The helper's GREEN path probes under the same environment that recorded
    // backend-ownership.json, so the same live process incarnation compares equal.
    expect(await processStartMarkerWithEnvironment(child.pid!, guardedEnvironment)).toBe(fixtureMarker)
    expect(markerEnvironmentSnapshot()).toEqual(before)
  } finally {
    const exited = once(child, 'exit')

    child.kill('SIGTERM')
    await exited
  }
})

test('Python guard keeps startup identity at the inherited root while auditing profile-scoped blocks after re-home', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-e2e-python-guard-home-'))
  const rootHome = path.join(root, 'hermes-home')
  const profileHome = path.join(rootHome, 'profiles', 'fixture-workspace')

  fs.mkdirSync(profileHome, { recursive: true, mode: 0o700 })

  const env = {
    ...fixtureEnvironment(),
    HERMES_HOME: rootHome,
    PYTHONPATH: installLoopbackPythonGuard(root)
  }

  const python = process.env.HERMES_DESKTOP_PYTHON || path.resolve(import.meta.dirname, '../../../.venv/bin/python')
  const forbiddenAddress = '203.0.113.1'

  const child = spawn(python, ['-c', `import json, os, socket, sys
import sitecustomize
os.environ['HERMES_HOME'] = sys.argv[1]
transport_calls = []
sitecustomize._connect = lambda *args, **kwargs: transport_calls.append(True)
blocked = False
try:
    with socket.socket() as guarded:
        guarded.connect((sys.argv[2], 443))
except OSError as error:
    blocked = 'forbids non-loopback transport' in str(error)
print(json.dumps({'pid': os.getpid(), 'blocked': blocked, 'transport_calls': len(transport_calls)}), flush=True)
sys.stdin.readline()
`, profileHome, forbiddenAddress], { env, stdio: ['pipe', 'pipe', 'pipe'] })

  const stdout = createInterface({ input: child.stdout })
  const stderr: string[] = []

  child.stderr.on('data', chunk => stderr.push(String(chunk)))

  try {
    expect(child.pid).toBeGreaterThan(0)

    const [line] = await once(stdout, 'line')
    const proof = JSON.parse(String(line)) as { pid: number; blocked: boolean; transport_calls: number }

    expect(proof).toEqual({ pid: child.pid, blocked: true, transport_calls: 0 })
    expect(fs.readFileSync(path.join(rootHome, 'python-network-guard-active'), 'utf8').trim().split('\n')).toContain(String(child.pid))
    expect(fs.existsSync(path.join(profileHome, 'python-network-guard-active'))).toBe(false)
    expect(fs.readFileSync(path.join(profileHome, 'blocked-network.txt'), 'utf8').trim().split('\n')).toEqual([forbiddenAddress])
    expect(await processStartMarkerWithEnvironment(child.pid!, fixtureEnvironment())).not.toBe('')

    const exited = once(child, 'exit')

    child.stdin.end('\n')
    const [exitCode] = await exited

    expect(exitCode, stderr.join('')).toBe(0)
  } finally {
    stdout.close()

    if (child.pid && child.exitCode === null) {
      const exited = once(child, 'exit')

      child.kill('SIGTERM')
      await exited
    }

    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('persisted audit preserves complete files across batches and rejects incomplete receipts', async () => {
  const { auditFixtureText } = await import('./platform-real-api')

  const values = ['a'.repeat(5 * 1024 * 1024), 'b'.repeat(5 * 1024 * 1024), 'fixture-secret-boundary']
  const observed: string[] = []

  const result = await auditFixtureText({
    async control<T>(_endpoint: string, body?: string): Promise<T> {
      expect(Buffer.byteLength(body!)).toBeLessThanOrEqual(32 * 1024 * 1024)
      observed.push(...JSON.parse(body!))

      return { leaked: false, checked_credentials: 5 } as T
    }
  }, values)

  expect(observed).toEqual(values)
  expect(result.batches).toBeGreaterThan(1)
  expect(result.checked_credentials).toBe(5)

  for (const receipt of [{}, { leaked: false }, { checked_credentials: 5 }, { leaked: false, checked_credentials: 1.5 }, { leaked: true, checked_credentials: 5 }]) {
    await expect(auditFixtureText({ control: async <T>() => receipt as T }, ['fixture'])).rejects.toThrow('Fixture secret audit failed')
  }
})

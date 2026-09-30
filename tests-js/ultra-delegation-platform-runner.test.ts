import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

import { buildSync } from 'esbuild'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  app: { whenReady: vi.fn(), setName: vi.fn(), setPath: vi.fn(), getPath: vi.fn(), exit: vi.fn() },
  auth: { initialize: vi.fn(), models: vi.fn(), modelLease: vi.fn(), listUsage: vi.fn() },
  spawn: vi.fn(),
  loadTokens: vi.fn(),
}))

const runnerFile = fileURLToPath(new URL('../evals/ultra_delegation/platform-runner.ts', import.meta.url))
const runnerCode = buildSync({ entryPoints: [runnerFile], format: 'cjs', platform: 'node', write: false }).outputFiles[0].text
const realRequire = createRequire(import.meta.url)

function executeRunner() {
  const dependencies: Record<string, unknown> = {
    'electron': { app: fake.app, safeStorage: {} },
    'node:child_process': { spawn: fake.spawn },
    '../../apps/desktop/electron/platform-token-store': { createPlatformTokenStore: () => ({ load: fake.loadTokens }) },
    '../../apps/desktop/electron/platform-auth': { createPlatformAuth: () => fake.auth },
    '../../apps/desktop/electron/platform-client': { createPlatformClient: () => ({}) },
  }

  runInNewContext(runnerCode, {
    require: (name: string) => dependencies[name] ?? realRequire(name),
    process, console, Date, setTimeout, clearTimeout, clearInterval,
    setInterval: (callback: () => Promise<void>, delay: number) => {
      budgetPoll = callback

      return setInterval(callback, delay)
    },
    exports: {}, module: { exports: {} },
  }, { filename: runnerFile })
}

const originalArgv = process.argv
const originalUmask = process.umask()
const repo = fileURLToPath(new URL('../', import.meta.url))
let temporaryRoot: string | undefined
let child: ReturnType<typeof createChild> | undefined
let budgetPoll: (() => Promise<void>) | undefined

function createChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(async () => {
  child?.emit('close', 0)
  await Promise.resolve()
  await Promise.resolve()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  process.argv = originalArgv
  process.umask(originalUmask)

  if (temporaryRoot) {fs.rmSync(temporaryRoot, { recursive: true, force: true })}
  temporaryRoot = undefined
  child = undefined
  budgetPoll = undefined
})

it.each([
  { options: [], error: 'Account access and paid runs require explicit --live' },
  { options: ['--budget=3600'], error: 'Account access and paid runs require explicit --live' },
  { options: ['--spend-target=10'], error: 'Account access and paid runs require explicit --live' },
  { options: ['--budget=3600', '--spend-target=10'], error: 'Account access and paid runs require explicit --live' },
  { options: ['--driver=codex', '--codex-native-comparison', '--budget=1200'], error: 'Account access and paid runs require explicit --live' },
  { options: ['--driver=codex', '--codex-native-comparison', '--budget=3600'], error: 'Codex comparison budget must be at most 1200 seconds' },
  { options: ['--budget=29'], error: 'Budget must be' },
  { options: ['--budget=3601'], error: 'Budget must be' },
  { options: ['--budget=30.5'], error: 'Budget must be' },
  { options: ['--budget=Infinity'], error: 'Budget must be' },
  { options: ['--spend-target=0'], error: 'Spend observation target must be' },
  { options: ['--spend-target=10.01'], error: 'Spend observation target must be' },
  { options: ['--spend-target=NaN'], error: 'Spend observation target must be' },
  { options: ['--review-skill=candidate'], error: 'candidate requires --review-skill-path' },
  { options: ['--review-skill=candidate', '--matched-comparison'], error: 'candidate requires a fresh large Aino task' },
  { options: ['--review-skill=candidate', '--driver=codex', '--codex-native-comparison'], error: 'candidate requires a fresh large Aino task' },
])('validates limits before account access: $options', async ({ options, error }) => {
  process.argv = ['electron', 'platform-runner.cjs', 'large', ...options]
  expect(executeRunner).toThrow(error)
  expect(fake.app.whenReady).not.toHaveBeenCalled()
  expect(fake.auth.modelLease).not.toHaveBeenCalled()
})

it.each(['--replay-source', '--legacy-replay-source', '--length-source'])(
  'rejects candidate-derived %s before account access', sourceOption => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-candidate-source-'))
    const reportPath = path.join(temporaryRoot, 'report.json')
    fs.writeFileSync(reportPath, JSON.stringify({ diagnostic: { review_skill: 'candidate', original_acceptance_eligible: false } }))
    const scenario = sourceOption === '--length-source' ? 'length' : 'replay'
    const source = sourceOption === '--length-source' ? reportPath : temporaryRoot
    fake.app.whenReady.mockImplementation(() => { throw new Error('unexpected account boundary') })
    process.argv = ['electron', 'platform-runner.cjs', scenario, '--live', '--repo=' + repo,
      '--output-root=' + path.join(temporaryRoot, 'runs'), sourceOption + '=' + source]
    expect(executeRunner).toThrow('candidate source')
    expect(fake.app.whenReady).not.toHaveBeenCalled()
    expect(fake.auth.modelLease).not.toHaveBeenCalled()
  },
)

it('rejects a directory named SKILL.md before account access', () => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-candidate-directory-'))
  fs.mkdirSync(path.join(temporaryRoot, 'SKILL.md'))
  fake.app.whenReady.mockImplementation(() => { throw new Error('unexpected account boundary') })
  process.argv = ['electron', 'platform-runner.cjs', 'large', '--live', '--repo=' + repo,
    '--review-skill=candidate', '--review-skill-path=' + temporaryRoot,
    '--output-root=' + path.join(temporaryRoot, 'runs')]
  expect(executeRunner).toThrow('candidate requires --review-skill-path containing SKILL.md')
  expect(fake.app.whenReady).not.toHaveBeenCalled()
  expect(fake.auth.modelLease).not.toHaveBeenCalled()
})

it.each([
  { driver: 'aino', failRenewal: false, candidate: false, options: ['--budget=3600', '--spend-target=10'], budget: 3600, spend: 10 },
  { driver: 'aino', failRenewal: false, candidate: true, options: ['--review-skill=candidate'], budget: 1200, spend: 5 },
  { driver: 'aino', failRenewal: true, candidate: false, options: [], budget: 1200, spend: 5 },
  { driver: 'codex', failRenewal: false, candidate: false, options: ['--driver=codex', '--codex-native-comparison'], budget: 1200, spend: 5 },
])('keeps the lease transport scoped to $driver and cleans up (renewal failure: $failRenewal, candidate: $candidate)', async ({ driver, failRenewal, candidate, options, budget, spend }) => {
  vi.useFakeTimers()
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-runner-test-'))
  const installation = path.join(temporaryRoot, 'installation.json')
  fs.writeFileSync(installation, JSON.stringify({ installationId: 'fixture-device' }))
  const skillPath = path.join(temporaryRoot, 'review-skill')

  if (candidate) {
    fs.mkdirSync(skillPath)
    fs.writeFileSync(path.join(skillPath, 'SKILL.md'), 'Review only the provided source snapshot.')
  }

  const logged: string[] = []
  vi.spyOn(console, 'log').mockImplementation(value => logged.push(String(value)))
  vi.spyOn(console, 'error').mockImplementation(value => logged.push(String(value)))
  fake.app.whenReady.mockResolvedValue(undefined)
  fake.app.getPath.mockReturnValue(temporaryRoot)
  fake.loadTokens.mockResolvedValue({ accessToken: 'fixture-access-secret', refreshToken: 'fixture-refresh-secret' })
  fake.auth.initialize.mockResolvedValue({ phase: 'signed_in', account: { id: 'fixture-user' } })
  fake.auth.models.mockResolvedValue([{ id: 'fixture-model', model: 'gpt-5.6-sol', state: 'available' }])

  const lease = {
    model: { id: 'fixture-model', model: 'gpt-5.6-sol', api_mode: 'responses', capabilities: { tools: true } },
    api_key: 'fixture-initial-lease-secret', credential_id: 'fixture-credential', base_url: 'https://fixture.invalid/v1',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  }

  fake.auth.modelLease.mockResolvedValueOnce(lease).mockImplementationOnce(async () => {
    if (failRenewal) {throw new Error('renewal failed with ' + lease.api_key)}

    return { ...lease, api_key: 'fixture-renewed-lease-secret', credential_id: 'fixture-next-credential',
      expires_at: new Date(Date.now() + 3600_000).toISOString() }
  })
  child = createChild()
  fake.spawn.mockReturnValue(child)
  const input: string[] = []
  child.stdin.on('data', chunk => input.push(String(chunk)))
  process.argv = ['electron', 'platform-runner.cjs', 'large', '--live', '--repo=' + repo,
    '--output-root=' + temporaryRoot, '--installation-path=' + installation, ...options,
    ...(candidate ? ['--review-skill-path=' + skillPath] : [])]
  executeRunner()
  await vi.waitFor(() => expect(fake.spawn).toHaveBeenCalledTimes(1))
  expect(fake.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--budget=' + budget, '--spend-target=' + spend]))

  if (candidate) {
    expect(fake.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--review-skill=candidate', '--review-skill-path=' + skillPath]))
  }

  expect(child.stdin.writableEnded).toBe(driver === 'codex')
  expect(input.join('')).toMatch(/\n$/)
  const first = JSON.parse(input.join('').trim())
  expect(first.api_key).toBe(lease.api_key)
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  const leaseCalls = driver === 'codex' ? 1 : 2
  expect(fake.auth.modelLease).toHaveBeenCalledTimes(leaseCalls)

  if (driver === 'aino') {
    expect(fake.auth.modelLease.mock.calls[1][0]).toEqual(fake.auth.modelLease.mock.calls[0][0])
  }

  const frames = input.join('').trim().split('\n').map(line => JSON.parse(line))

  if (driver === 'codex') {
    expect(frames).toHaveLength(1)
  } else if (failRenewal) {
    expect(frames).toHaveLength(1)
    expect(logged.join('\n')).toContain('lease_renewal_error')
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(fake.auth.modelLease).toHaveBeenCalledTimes(2)
  } else {
    expect(frames).toHaveLength(2)
    expect(frames[1]).toMatchObject({ type: 'renew_managed_model', lease: {
      api_key: 'fixture-renewed-lease-secret', origin: first.origin, user_id: 'fixture-user',
    } })
    child.stdout.write('probe fixture-renewed-lease-secret\n')
    expect(logged.join('\n')).toContain('[REDACTED]')
  }

  expect(logged.join('\n')).not.toContain(lease.api_key)
  expect(logged.join('\n')).not.toContain('fixture-renewed-lease-secret')
  child.emit('close', 0)
  await vi.waitFor(() => expect(fake.app.exit).toHaveBeenCalledWith(0))
  expect(child.stdin.writableEnded).toBe(true)
  await vi.advanceTimersByTimeAsync(60 * 60_000)
  expect(fake.auth.modelLease).toHaveBeenCalledTimes(leaseCalls)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['resolve', 'reject'])('ignores an in-flight usage poll after child close while settlement is pending: %s', async outcome => {
  vi.useFakeTimers()
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-runner-poll-'))
  const installation = path.join(temporaryRoot, 'installation.json')
  const runDir = path.join(temporaryRoot, 'live-fixture')
  fs.mkdirSync(runDir)
  fs.writeFileSync(installation, JSON.stringify({ installationId: 'fixture-device' }))
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ billing: [{ session_id: 'fixture-billing' }] }))
  const logged: string[] = []
  vi.spyOn(console, 'log').mockImplementation(value => logged.push(String(value)))
  fake.app.whenReady.mockResolvedValue(undefined)
  fake.app.getPath.mockReturnValue(temporaryRoot)
  fake.loadTokens.mockResolvedValue({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh' })
  fake.auth.initialize.mockResolvedValue({ phase: 'signed_in', account: { id: 'fixture-user' } })
  fake.auth.models.mockResolvedValue([{ id: 'fixture-model', model: 'gpt-5.6-sol', state: 'available' }])
  fake.auth.modelLease.mockResolvedValue({ model: { id: 'fixture-model', api_mode: 'responses' }, api_key: 'fixture-lease',
    expires_at: new Date(Date.now() + 3600_000).toISOString() })
  let resolvePoll!: (page: { items: { actual_cost_decimal: string }[], total: number }) => void
  let rejectPoll!: (reason: Error) => void
  let resolveSettlement!: (page: { items: [], total: number }) => void
  const pendingPoll = new Promise((resolve, reject) => { resolvePoll = resolve; rejectPoll = reject })
  const pendingSettlement = new Promise(resolve => { resolveSettlement = resolve })
  fake.auth.listUsage.mockReturnValueOnce(pendingPoll).mockReturnValueOnce(pendingSettlement)
  child = createChild()
  fake.spawn.mockReturnValue(child)
  process.argv = ['electron', 'platform-runner.cjs', 'large', '--live', '--repo=' + repo,
    '--output-root=' + temporaryRoot, '--installation-path=' + installation]
  executeRunner()
  await vi.waitFor(() => expect(fake.spawn).toHaveBeenCalledTimes(1))
  child.stdout.write(JSON.stringify({ stage: 'session_ready', run_dir: runDir }) + '\n'
    + JSON.stringify({ stage: 'billing_identity', session_id: 'fixture-billing' }) + '\n')
  const pollResult = budgetPoll!().then(() => undefined, error => error)
  await vi.waitFor(() => expect(fake.auth.listUsage).toHaveBeenCalledTimes(1))
  child.emit('close', 0)
  await vi.waitFor(() => expect(fake.auth.listUsage).toHaveBeenCalledTimes(2))
  expect(fake.app.exit).not.toHaveBeenCalled()

  try {
    if (outcome === 'resolve') {resolvePoll({ items: [{ actual_cost_decimal: '20' }], total: 1 })}
    else {rejectPoll(new Error('offline usage failure'))}

    expect(await pollResult).toBeUndefined()
    await budgetPoll!()
    expect(fake.auth.listUsage).toHaveBeenCalledTimes(2)
    expect(child.kill).not.toHaveBeenCalled()
    expect(logged.join('\n')).not.toMatch(/observed_usage|usage_poll_error/)
  } finally {
    resolveSettlement({ items: [], total: 0 })
    await vi.waitFor(() => expect(fake.app.exit).toHaveBeenCalledWith(0))
  }
})

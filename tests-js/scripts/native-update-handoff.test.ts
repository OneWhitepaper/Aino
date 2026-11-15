import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expect, test } from 'vitest'

import { resolveDesktopHermesHome } from '../../apps/desktop/electron/data-paths.mjs'
import { holdNativeUpdate, readPreservedAccountHistory, resolveSmokeLaunch, seedSmokeAccount, verifyRunningDesktop } from '../../tests/install/e2e-assets/desktop-smoke.ts'

import type { ElectronApplication, Page } from './e2e-driver-deps.ts'

test('native OLD keeps the exact preservation profile before Electron requests its singleton', (): void => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-handoff-profile-'))
  const userData = path.join(root, 'preserved-user-data')
  fs.mkdirSync(userData)
  fs.writeFileSync(path.join(userData, 'Local State'), 'existing Chromium profile')

  try {
    const launch = resolveSmokeLaunch({ exe: path.join(root, 'app'), root, origin: 'bundled',
      home: path.join(root, 'home'), 'user-data': userData, out: path.join(root, 'proof'),
      phase: 'old', 'expect-commit': 'a'.repeat(40), 'platform-account': true, 'native-handoff': true })

    expect(launch.env.HERMES_DESKTOP_USER_DATA_DIR).toBe(userData)
    expect(launch.args).toContain(`--user-data-dir=${userData}`)
    expect(fs.readFileSync(path.join(userData, 'Local State'), 'utf8')).toBe('existing Chromium profile')
    expect(fs.readdirSync(root)).toEqual(['preserved-user-data'])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('active preservation proof reads scoped historical messages and model through the desktop API', async (): Promise<void> => {
  const account = { home: '/account/home', relativeHome: 'account/home', origin: 'https://api.agentera.com.cn',
    userId: '17', displayName: '测试账户甲', profile: 'research', model: 'fixture-model',
    baseUrl: 'http://127.0.0.1:9999/v1', sessionIds: ['fixture-history-17', 'fixture-bot-17'] }

  let actualModel = account.model
  let hasHistory = true

  const page = { evaluate: async (reader: (items: unknown) => Promise<unknown>, items: unknown) => {
    const prior = globalThis.window
    Object.assign(globalThis, { window: { hermesDesktop: { api: async (request: { path: string; profile: string }) => {
      if (request.path.startsWith('/api/config')) {
        return { model: { default: actualModel, provider: 'custom', base_url: account.baseUrl } }
      }

      return { session_id: request.profile === 'default' ? account.sessionIds[0] : account.sessionIds[1],
        messages: hasHistory ? [{ role: 'user', content: '测试账户甲：请保留我的历史记录。' },
          { role: 'assistant', content: '测试账户甲：历史回答和模型设置应在升级后保留。' }] : [] }
    } } } })

    try { return await reader(items) } finally { Object.assign(globalThis, { window: prior }) }
  } } as unknown as Page

  const proof = await readPreservedAccountHistory(page, account)
  expect(proof.sessions.map(row => row.profile)).toEqual(['default', 'research'])
  expect(proof.sessions.map(row => row.sessionId)).toEqual(account.sessionIds)
  actualModel = 'wrong-model'
  await expect(readPreservedAccountHistory(page, account)).rejects.toThrow('model')
  actualModel = account.model
  hasHistory = false
  await expect(readPreservedAccountHistory(page, account)).rejects.toThrow('historical messages')
})

test('a predicted bundled backend home never waives Electron userData identity', async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-identity-'))
  const userData = path.join(root, 'preserved-profile')
  const wrongUserData = path.join(root, 'unseeded-clone')
  fs.mkdirSync(userData)
  fs.mkdirSync(wrongUserData)

  const options = { exe: path.join(root, 'app'), root, origin: 'bundled' as const,
    home: path.join(root, 'home'), 'user-data': userData, out: path.join(root, 'proof'),
    phase: 'old' as const, 'expect-commit': 'a'.repeat(40), 'platform-account': true, 'native-handoff': true }

  const app = { evaluate: async () => ({ userData: wrongUserData, sandboxDisabled: false }) } as unknown as ElectronApplication

  try {
    await expect(verifyRunningDesktop(app, options, resolveSmokeLaunch(options), options.home)).rejects.toThrow('userData')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('native account preparation retains the owned preservation model and credentials byte for byte', (): void => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-preserved-config-'))
  const userData = path.join(root, 'profile')

  const home = resolveDesktopHermesHome({ home: root, env: {}, accountWorkspace: {
    userData, origin: 'https://api.agentera.com.cn', userId: '17',
  } })

  const account = { home: path.relative(userData, home).split(path.sep).join('/'), origin: 'https://api.agentera.com.cn',
    userId: '17', displayName: '测试账户甲', profile: 'research', model: 'fixture-model',
    baseUrl: 'http://127.0.0.1:9999/v1', sessionIds: ['fixture-history-17', 'fixture-bot-17'] }

  fs.mkdirSync(path.join(home, 'profiles', account.profile), { recursive: true })
  const config = 'model:\n  default: fixture-model\n  provider: custom\n  base_url: http://127.0.0.1:9999/v1\n'
  const credentials = 'OPENAI_API_KEY=inert-old-key\n'
  fs.writeFileSync(path.join(home, 'config.yaml'), config)
  fs.writeFileSync(path.join(home, '.env'), credentials)
  fs.writeFileSync(path.join(home, 'state.db'), '')
  fs.writeFileSync(path.join(home, 'profiles', account.profile, 'profile.yaml'), '')
  fs.writeFileSync(path.join(userData, '.aino-windows-user-state-fixture.json'), JSON.stringify({
    formatVersion: 2, purpose: 'aino-disposable-windows-installer-preservation', accounts: [account], files: ['config.yaml'],
  }))

  try {
    const options = { exe: path.join(root, 'app'), root, origin: 'bundled' as const, home: path.join(root, 'home'),
      'user-data': userData, out: path.join(root, 'proof'), phase: 'old' as const, 'expect-commit': 'a'.repeat(40),
      'platform-account': true, 'native-handoff': true }

    expect(seedSmokeAccount(options, undefined, 'http://127.0.0.1:9999')).toBe(home)
    expect(fs.readFileSync(path.join(home, 'config.yaml'), 'utf8')).toBe(config)
    expect(fs.readFileSync(path.join(home, '.env'), 'utf8')).toBe(credentials)
    expect(() => seedSmokeAccount(options, undefined, 'http://127.0.0.1:8888')).toThrow('mock endpoint')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('native OLD reports process close without releasing its account service before NEW verification', async (): Promise<void> => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'native-handoff-lifetime-'))

  let closeOld: () => void = () => {}
  const processClosed = new Promise<void>(resolve => { closeOld = resolve })
  let released = false

  try {
    const completion = holdNativeUpdate({ out, pid: 2718, exe: '/installed/app', oldSha: 'a'.repeat(40),
      userData: '/preserved/profile', hermesHome: '/preserved/account/home',
      env: { HERMES_HOME: '/preserved/home', HERMES_DESKTOP_USER_DATA_DIR: '/preserved/profile',
        HTTPS_PROXY: 'http://127.0.0.1:4321', NODE_EXTRA_CA_CERTS: '/fixture/ca.pem', RUNNER_TOKEN: 'must-not-publish' },
      waitForProcessClose: () => processClosed,
    }).then(() => { released = true })

    expect(JSON.parse(fs.readFileSync(path.join(out, 'old-chat-ready.json'), 'utf8'))).toMatchObject({
      pid: 2718, userData: '/preserved/profile', hermesHome: '/preserved/account/home',
    })
    expect(JSON.parse(fs.readFileSync(path.join(out, 'native-relaunch-environment.json'), 'utf8'))).toEqual({
      HERMES_HOME: '/preserved/home', HERMES_DESKTOP_USER_DATA_DIR: '/preserved/profile',
      HTTPS_PROXY: 'http://127.0.0.1:4321', NODE_EXTRA_CA_CERTS: '/fixture/ca.pem',
    })
    closeOld()
    await expect.poll(() => fs.existsSync(path.join(out, 'old-process-closed.json')), { timeout: 5000 }).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(out, 'old-process-closed.json'), 'utf8'))).toMatchObject({ pid: 2718, closed: true })
    expect(released).toBe(false)
    fs.writeFileSync(path.join(out, 'native-update-complete'), 'NEW verified')
    await completion
    expect(released).toBe(true)
  } finally { fs.rmSync(out, { recursive: true, force: true }) }
})

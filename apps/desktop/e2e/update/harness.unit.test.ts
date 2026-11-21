import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'

import { _electron, type ElectronApplication, type Page } from '@playwright/test'
import yaml from 'js-yaml'
import { expect, test, vi } from 'vitest'

import * as platformAccountFixture from '../../../../tests-js/scripts/platform-account-fixture'
import { resolveDesktopHermesHome } from '../../electron/data-paths.mjs'

import { appEnv, configureProvider, desktopMainProcesses, type InstallFacts, installFirstRunSampler, installProcesses, launchInstalledApp, packagedExe, releaseDir } from './harness'

interface TestDom { window: Window & typeof globalThis }

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { runScripts: string }) => TestDom
}

test('the installed desktop permits PM to prepare the newly authenticated account environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update account environment '))

  const facts = {
    sandboxRoot: root, home: path.join(root, 'home'), hermesHome: path.join(root, 'install'),
    checkout: path.join(root, 'checkout'), hermes: path.join(root, 'bin', 'hermes'),
    origin: path.join(root, 'origin.git'), headSha: 'a'.repeat(40),
    env: { HOME: path.join(root, 'home'), HERMES_HOME: path.join(root, 'install'),
      HERMES_DISABLE_LAZY_INSTALLS: '1', PATH: '/usr/bin', GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig') }
  } satisfies InstallFacts

  try {
    // The private keyring returns baseEnv plus its own overrides, as the real
    // startInstallSession call passes it; this must not restore the old flag.
    const env = appEnv(facts, { ...facts.env, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/private-test-bus' })
    expect(env.HERMES_DISABLE_LAZY_INSTALLS, 'a new account has no committed dependency generation yet').toBeUndefined()
    expect(env.HOME).toBe(facts.env.HOME)
    expect(env.HERMES_HOME).toBe(facts.env.HERMES_HOME)
    expect(env.GIT_CONFIG_GLOBAL).toBe(facts.env.GIT_CONFIG_GLOBAL)
    expect(env.DBUS_SESSION_BUS_ADDRESS).toBe('unix:path=/private-test-bus')
    expect(env.HERMES_DESKTOP_USER_DATA_DIR).toBe(path.join(root, 'user-data'))
    expect(facts.env.HERMES_DISABLE_LAZY_INSTALLS, 'other upgrade fixtures retain their acquisition policy').toBe('1')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function installedAccountLaunchFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update account launch '))
  const facts = { sandboxRoot: root, home: path.join(root, 'home'), checkout: path.join(root, 'checkout') } as InstallFacts
  const tokenFile = path.join(root, 'user-data', 'platform-tokens.json')
  fs.mkdirSync(releaseDir(facts), { recursive: true })
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true })
  fs.writeFileSync(path.join(releaseDir(facts), 'aino'), 'not an executable')
  const events: string[] = []
  const context = { exposeBinding: async () => {}, addInitScript: async () => {} }
  let workspace: Page

  // Keep launchInstalledApp -> signInUpdateAccount real; only the native launch
  // and UI handoff are doubled. The encrypted session's loss is a real file deletion.
  const launch = vi.spyOn(_electron, 'launch').mockImplementation(async () => {
    const login = { context: () => context, evaluate: async () => {}, isClosed: () => false } as unknown as Page
    workspace = {
      evaluate: async () => ({
        phase: 'signed_in', userId: '17', mode: 'production', rememberState: 'encrypted', hasError: false
      })
    } as unknown as Page

    return {
      process: () => ({}), firstWindow: async () => login, windows: () => [login], close: async () => {}
    } as unknown as ElectronApplication
  })

  const signIn = vi.spyOn(platformAccountFixture, 'signInPlatformFixture').mockImplementation(async () => {
    events.push('phone-login')
    fs.writeFileSync(tokenFile, 'encrypted fixture session')

    return workspace
  })

  const restore = vi.spyOn(platformAccountFixture, 'platformLoginWorkspace').mockImplementation(async (_app, _page, submit) => {
    events.push('restore')
    await submit()

    if (!fs.existsSync(tokenFile)) { throw new Error('Persisted platform session was lost') }

    return workspace
  })

  return { facts, tokenFile, get workspace() { return workspace }, events, close() {
    launch.mockRestore()
    signIn.mockRestore()
    restore.mockRestore()
    fs.rmSync(root, { recursive: true, force: true })
  } }
}

test('a cold same-user launch with deleted credentials fails restore instead of signing in again', async () => {
  const fixture = installedAccountLaunchFixture()

  try {
    const first = await launchInstalledApp(fixture.facts, {})
    expect(first.page).toBe(fixture.workspace)
    await first.app.close()
    fs.rmSync(fixture.tokenFile)

    await expect(launchInstalledApp({ ...fixture.facts }, {})).rejects.toThrow('Persisted platform session was lost')
    expect(fixture.events).toEqual(['phone-login', 'restore'])
    expect(fs.existsSync(fixture.tokenFile), 'a lost remembered session must not be repaired by OTP').toBe(false)
  } finally {
    fixture.close()
  }
})

test('each genuinely fresh sandbox permits first login and then restores the same account without OTP', async () => {
  for (const _launch of [1, 2]) {
    const fixture = installedAccountLaunchFixture()

    try {
      expect(fs.existsSync(fixture.tokenFile)).toBe(false)
      const first = await launchInstalledApp(fixture.facts, {})
      expect(first.page).toBe(fixture.workspace)
      await first.app.close()
      const restored = await launchInstalledApp({ ...fixture.facts }, {})
      expect(restored.app).not.toBe(first.app)
      expect(restored.page).toBe(fixture.workspace)
      expect(fixture.events).toEqual(['phone-login', 'restore'])
      await restored.app.close()
    } finally {
      fixture.close()
    }
  }
})

test('bootstrap sampling survives the login renderer being replaced and records branded as well as historical flashes', async () => {
  // JSDOM executes the same serialized init script as Playwright. Only the native
  // context boundary is adapted here; mutation observation runs in each real DOM.
  const windows: TestDom[] = []
  let binding: (_source: unknown, screen: string) => void
  let init: { script: (screens: string[]) => void; screens: string[] } | undefined

  const context = {
    exposeBinding: async (_name: string, callback: typeof binding) => { binding = callback },
    addInitScript: async (script: (screens: string[]) => void, screens: string[]) => { init = { script, screens } }
  }

  const open = () => {
    const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' })
    windows.push(dom)
    Object.assign(dom.window, { __updateFirstRunScreen: (screen: string) => binding({}, screen) })

    const evaluate = async (script: (screens: string[]) => void, screens: string[]) => {
      dom.window.eval(`(${script.toString()})`)(screens)
    }

    return { dom, page: { context: () => context, evaluate } as unknown as Page, evaluate }
  }

  const paint = async (dom: TestDom, text: string) => {
    dom.window.document.body.innerText = text
    dom.window.document.body.textContent = text
    await new Promise(resolve => setImmediate(resolve))
  }

  const close = (dom: TestDom) => {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'))
    dom.window.close()
  }

  try {
    const login = open()
    const seen = await installFirstRunSampler(login.page)
    expect(typeof seen, 'the observation must outlive the replaced login page').toBe('function')
    await paint(login.dom, 'AINO Send code')
    expect(seen()).toEqual([])
    const workspace = open()
    await workspace.evaluate(init!.script, init!.screens)
    await paint(workspace.dom, 'Aino needs a one-time install')
    await paint(workspace.dom, 'Set up Hermes Desktop')
    await paint(workspace.dom, 'Native member Chat')
    close(login.dom)
    expect(seen()).toEqual(['Aino needs a one-time install', 'Set up Hermes Desktop'])
  } finally {
    for (const dom of windows) {
      if (dom.window.document) { close(dom) }
    }
  }
})

test('update provider setup seeds the authenticated account without borrowing shared state or dropping the update channel', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update account '))
  const facts = { sandboxRoot: root, home: path.join(root, 'home'), hermesHome: path.join(root, 'install') } as InstallFacts

  const accountHome = resolveDesktopHermesHome({ home: facts.home, accountWorkspace: {
    userData: path.join(root, 'user-data'), origin: 'https://api.agentera.com.cn', userId: '17'
  } })

  const update = { installs: { ['1'.repeat(16)]: { path: path.join(root, 'checkout'), channel: 'main' } } }

  try {
    fs.mkdirSync(facts.hermesHome, { recursive: true })
    fs.writeFileSync(path.join(facts.hermesHome, 'config.yaml'), yaml.dump({ update, plugins: { enabled: ['retained'] } }))
    fs.writeFileSync(path.join(facts.hermesHome, 'state.db'), 'private installation history')
    configureProvider(facts, 'http://127.0.0.1:45678')

    expect(fs.existsSync(path.join(accountHome, 'config.yaml')), 'the signed-in workspace needs its own provider').toBe(true)
    const account = yaml.load(fs.readFileSync(path.join(accountHome, 'config.yaml'), 'utf8')) as Record<string, unknown>
    expect(account.model).toMatchObject({ provider: 'custom', default: 'mock-model', base_url: 'http://127.0.0.1:45678/v1' })
    expect(account.account).toBeUndefined()
    expect(account.plugins).toBeUndefined()
    expect(account.update, 'source update subscriptions belong to the installation, not the account').toBeUndefined()
    expect(fs.existsSync(path.join(accountHome, 'state.db'))).toBe(false)
    expect(fs.readFileSync(path.join(accountHome, '.env'), 'utf8')).toContain('OPENAI_API_KEY=update-e2e-key\n')
    const installation = yaml.load(fs.readFileSync(path.join(facts.hermesHome, 'config.yaml'), 'utf8')) as Record<string, unknown>
    expect(installation.update).toEqual(update)
    expect(installation.plugins).toEqual({ enabled: ['retained'] })
    expect(installation.account).toBeUndefined()
    expect(fs.readFileSync(path.join(facts.hermesHome, 'state.db'), 'utf8')).toBe('private installation history')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test.skipIf(process.platform !== 'linux')('install cleanup includes the account gateway but not a neighbouring account', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update account census '))
  const facts = { sandboxRoot: root, home: path.join(root, 'home'), hermesHome: path.join(root, 'install'), checkout: path.join(root, 'checkout') } as InstallFacts

  const accountHome = resolveDesktopHermesHome({ home: facts.home, accountWorkspace: {
    userData: path.join(root, 'user-data'), origin: 'https://api.agentera.com.cn', userId: '17'
  } })

  const gateway = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { env: { HERMES_HOME: accountHome }, stdio: 'ignore' })
  const neighbour = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { env: { HERMES_HOME: `${accountHome}-other` }, stdio: 'ignore' })

  try {
    await expect.poll(() => installProcesses(facts).map(proc => proc.pid)).toContain(gateway.pid)
    expect(installProcesses(facts).map(proc => proc.pid)).not.toContain(neighbour.pid)
  } finally {
    gateway.kill('SIGKILL')
    neighbour.kill('SIGKILL')
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test.each(['aino', 'Aino', 'Hermes', 'hermes'])(
  'the installed update harness finds the packaged %s executable without selecting helpers',
  name => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update executable '))
    const facts = { checkout: root } as InstallFacts
    const dir = releaseDir(facts)
    const executable = path.join(dir, name)

    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'chrome_crashpad_handler'), 'helper', { mode: 0o755 })
      fs.writeFileSync(executable, 'desktop', { mode: 0o755 })
      const found = fs.statSync(packagedExe(facts))
      const expected = fs.statSync(executable)
      expect([found.dev, found.ino]).toEqual([expected.dev, expected.ino])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)

test('the installed update harness refuses a release containing only helper executables', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update helpers '))
  const facts = { checkout: root } as InstallFacts
  const dir = releaseDir(facts)

  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'chrome_crashpad_handler'), 'helper', { mode: 0o755 })
    expect(() => packagedExe(facts)).toThrow(/no packaged .* executable/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// Electron 44 zeroes its processes' /proc/<pid>/environ, so the installed app shows no
// HERMES_HOME. A copy of node under the install's release dir, started with an empty
// environment, is that process.
test.skipIf(process.platform !== 'linux')(
  'the install census still sees the packaged app when its environment names no HERMES_HOME',
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update census '))

    const facts = {
      sandboxRoot: root,
      home: path.join(root, 'home'),
      hermesHome: path.join(root, 'home', '.hermes'),
      checkout: path.join(root, 'checkout')
    } as InstallFacts

    fs.mkdirSync(releaseDir(facts), { recursive: true })
    const exe = path.join(releaseDir(facts), 'Hermes')
    fs.copyFileSync(process.execPath, exe)
    const app = spawn(exe, ['-e', 'setTimeout(() => {}, 60_000)'], { env: {}, stdio: 'ignore' })

    try {
      await expect.poll(() => installProcesses(facts).map(proc => proc.pid)).toContain(app.pid)
      expect(desktopMainProcesses(facts).map(proc => proc.pid)).toEqual([app.pid])
    } finally {
      app.kill('SIGKILL')
      await expect.poll(() => installProcesses(facts).length).toBe(0)
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)

// Crashpad's handler runs from the same release dir with no `--type=` and is reparented to init,
// and it can outlive the app it served. The update spec signals the app it found as "relaunched":
// a handler taken for the app gets the SIGTERM and the real app is never asked to quit.
test.skipIf(process.platform !== 'linux')(
  "the packaged app's crash handler is not a Desktop main process",
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'update census '))

    const facts = {
      sandboxRoot: root,
      home: path.join(root, 'home'),
      hermesHome: path.join(root, 'home', '.hermes'),
      checkout: path.join(root, 'checkout')
    } as InstallFacts

    fs.mkdirSync(releaseDir(facts), { recursive: true })
    const exe = path.join(releaseDir(facts), 'Hermes')
    const handlerExe = path.join(releaseDir(facts), 'chrome_crashpad_handler')
    fs.copyFileSync(process.execPath, exe)
    fs.copyFileSync(process.execPath, handlerExe)

    const handler = spawn(
      handlerExe,
      ['-e', 'setTimeout(() => {}, 60_000)', '--', '--monitor-self-annotation=ptype=crashpad-handler'],
      {
        env: {},
        stdio: 'ignore'
      }
    )

    const app = spawn(exe, ['-e', 'setTimeout(() => {}, 60_000)'], { env: {}, stdio: 'ignore' })

    try {
      await expect
        .poll(() =>
          installProcesses(facts)
            .map(proc => proc.pid)
            .sort()
        )
        .toEqual([handler.pid, app.pid].sort())
      expect(desktopMainProcesses(facts).map(proc => proc.pid)).toEqual([app.pid])
    } finally {
      handler.kill('SIGKILL')
      app.kill('SIGKILL')
      await expect.poll(() => installProcesses(facts).length).toBe(0)
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)

import * as fs from 'node:fs'
import * as path from 'node:path'

import { resolveDesktopHermesHome } from '../electron/data-paths.mjs'

import { ACCOUNT_FIXTURES, seedWorkspaceSession, startAccountWorkspacePlatform } from './account-workspace-fixture'
import { buildAppEnv, createSandbox } from './fixtures'
import { replaceAccountWindow } from './platform-account-window'
import { fixtureEnvironment, guardedPlatformPython, installLoopbackNodeGuard, installLoopbackPythonGuard, launchGuardedDesktop } from './platform-real-api'
import { collectErrorBanners, expect, test } from './test'

interface FreshAccountWindow {
  hermesDesktop: {
    getVersion(): Promise<{ hermesHome: string }>
    platformAccount: {
      status(): Promise<{ phase: string; account: { id: string } | null; remember_state: string }>
      loginExisting(input: { email: string; password: string; remember: boolean }): Promise<unknown>
    }
    api<T>(request: { path: string; method?: string }): Promise<T>
  }
}

function freshAccountEnvironment(sandbox: ReturnType<typeof createSandbox>, python: string): Record<string, string> {
  const inherited = buildAppEnv(sandbox)
  const env: Record<string, string> = { ...fixtureEnvironment(), HOME: sandbox.root, HERMES_HOME: sandbox.hermesHome }

  for (const key of [
    'HERMES_DESKTOP_USER_DATA_DIR', 'HERMES_DESKTOP_IGNORE_EXISTING', 'HERMES_DESKTOP_HERMES_ROOT',
    'HERMES_DESKTOP_APP_NAME', 'HERMES_DESKTOP_SKIP_QUIT_CONFIRM', 'HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION',
    'HERMES_DESKTOP_ISOLATED_BACKEND'
  ]) {
    if (inherited[key]) { env[key] = inherited[key] }
  }

  env.HERMES_DESKTOP_PYTHON = guardedPlatformPython(sandbox.root, installLoopbackPythonGuard(sandbox.root), python)

  return env
}

test('starts a fresh unconfigured account without adopting legacy configuration or history', async ({
  browserName: _browserName
}, testInfo) => {
  test.setTimeout(180_000)
  const sandbox = createSandbox('fresh-account')
  const platform = await startAccountWorkspacePlatform()
  const python = process.env.HERMES_DESKTOP_PYTHON || path.resolve(import.meta.dirname, '../../../.venv/bin/python')
  const legacySession = 'legacyfreshprivatehistory'
  const marker = 'legacy-account-private-model-marker'

  const home = resolveDesktopHermesHome({ home: sandbox.root, accountWorkspace: {
    userData: sandbox.userDataDir, origin: platform.origin, userId: ACCOUNT_FIXTURES[0].id
  } })

  let launched: Awaited<ReturnType<typeof launchGuardedDesktop>> | null = null
  let proof: unknown

  try {
    seedWorkspaceSession(python, sandbox, sandbox.hermesHome, legacySession)
    fs.writeFileSync(path.join(sandbox.hermesHome, 'config.yaml'), `model:\n  provider: custom\n  model: ${marker}\n  base_url: http://127.0.0.1:9/v1\ndisplay:\n  language: en\n`)
    fs.writeFileSync(path.join(sandbox.hermesHome, '.env'), `MOCK_API_KEY=${marker}\n`)
    const legacyFiles = ['config.yaml', '.env', 'state.db'].map(name => ({ name, bytes: fs.readFileSync(path.join(sandbox.hermesHome, name)) }))
    expect(fs.existsSync(home)).toBe(false)
    fs.writeFileSync(path.join(sandbox.userDataDir, 'platform-development.json'), JSON.stringify({ enabled: true, origin: platform.origin }))
    const env = freshAccountEnvironment(sandbox, python)
    launched = await launchGuardedDesktop(env, installLoopbackNodeGuard(sandbox.root))
    await expect(launched.page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    expect(fs.existsSync(home)).toBe(false)

    const page = await replaceAccountWindow(launched, current => current.evaluate(() =>
      (window as unknown as FreshAccountWindow).hermesDesktop.platformAccount.loginExisting({
        email: 'alpha@example.test', password: 'inert-fixture-password', remember: false
      })
    ))

    await expect.poll(() => page.evaluate(async () => {
      const snapshot = await (window as unknown as FreshAccountWindow).hermesDesktop.platformAccount.status()

      return { id: snapshot.account?.id, phase: snapshot.phase, remember: snapshot.remember_state }
    }), { timeout: 120_000 }).toEqual({ id: '17', phase: 'signed_in', remember: 'session_only' })
    await expect(page.locator('[data-account-login-page]')).toHaveCount(0)
    await expect.poll(() => page.evaluate(async () => {
      try {
        return await (window as unknown as FreshAccountWindow).hermesDesktop.api<{ sessions: Array<{ id: string }> }>({ path: '/api/sessions?profile=default' })
      } catch { return null }
    }), { timeout: 120_000 }).toMatchObject({ sessions: [] })

    const result = await page.evaluate(async sessionId => {
      const desktop = (window as unknown as FreshAccountWindow).hermesDesktop
      let legacy: unknown

      try { legacy = await desktop.api({ path: `/api/sessions/${sessionId}?profile=default` }) }
      catch (error) { legacy = { rejected: String(error) } }

      return { version: await desktop.getVersion(), legacy }
    }, legacySession)

    expect(result.version.hermesHome).toBe(home)
    expect(result.legacy).toEqual({ rejected: expect.stringMatching(/404/) })

    for (const file of legacyFiles) { expect(fs.readFileSync(path.join(sandbox.hermesHome, file.name))).toEqual(file.bytes) }

    for (const name of ['config.yaml', '.env']) {
      const file = path.join(home, name)

      if (fs.existsSync(file)) { expect(fs.readFileSync(file, 'utf8')).not.toContain(marker) }
    }

    expect(fs.existsSync(path.join(sandbox.userDataDir, 'platform-tokens.json'))).toBe(false)
    expect(await collectErrorBanners(page)).toEqual([])
    const accountWindow = await launched.app.browserWindow(page)
    expect(await accountWindow.evaluate(window => window.getBounds().width)).toBeGreaterThan(1000)
    proof = { home, version: result.version, legacy: result.legacy, emptyHistory: true, legacyFilesUnchanged: true,
      accountConfigPreseeded: false, remember: 'session_only' }
    await page.screenshot({ path: testInfo.outputPath('fresh-account-workspace.png') })
  } finally {
    await testInfo.attach('fresh-account-proof', { body: JSON.stringify(proof ?? { completed: false }), contentType: 'application/json' })
    await launched?.app.close().catch(() => undefined)

    for (const [index, directory] of [sandbox.hermesHome, home].entries()) {
      const logs = path.join(directory, 'logs')

      if (fs.existsSync(logs)) { fs.cpSync(logs, testInfo.outputPath(`fresh-account-${index}-logs`), { recursive: true }) }
    }

    await platform.close()
    sandbox.cleanup()
  }
})

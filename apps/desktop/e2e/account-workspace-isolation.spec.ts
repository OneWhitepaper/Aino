import * as fs from 'node:fs'
import * as path from 'node:path'

import { writeEnvFile, writeMockProviderConfig } from '../../../tests-js/scripts/mock-provider-config'
import { startMockServer } from '../../../tests-js/scripts/mock-server'
import { resolveDesktopHermesHome } from '../electron/data-paths.mjs'

import { ACCOUNT_FIXTURES, seedWorkspaceSession, startAccountWorkspacePlatform } from './account-workspace-fixture'
import { buildAppEnv, createSandbox } from './fixtures'
import {
  fixtureEnvironment,
  guardedPlatformPython,
  installLoopbackNodeGuard,
  installLoopbackPythonGuard,
  launchGuardedDesktop
} from './platform-real-api'
import { collectErrorBanners, type ElectronApplication, expect, installErrorBannerGuard, type Page, test } from './test'

interface NativeAccountWindow {
  hermesDesktop: {
    accountAdapter: 'legacy-development' | 'platform'
    getVersion(): Promise<{ hermesHome: string }>
    platformAccount: {
      status(): Promise<{ phase: string; mode: string; account: { id: string } | null; remember_state: string }>
      loginExisting(input: { email: string; password: string; remember: boolean }): Promise<unknown>
      logout(): Promise<unknown>
    }
    api<T>(request: { path: string; method?: string }): Promise<T>
    openWindow(): Promise<unknown>
  }
}

async function changeAccount(app: ElectronApplication, page: Page, email: string | null): Promise<Page> {
  const retired = [...app.windows()]
  const nextWindow = app.waitForEvent('window', { timeout: 120_000 })

  const transition = page
    .evaluate(async nextEmail => {
      const account = (window as unknown as NativeAccountWindow).hermesDesktop.platformAccount

      try {
        if (nextEmail === null) {
          await account.logout()
        } else {
          await account.loginExisting({ email: nextEmail, password: 'inert-fixture-password', remember: false })
        }
      } catch (error) {
        throw new Error(JSON.stringify(error))
      }
    }, email)
    .catch(error => {
      // Successful auth retires the invoking renderer before its IPC reply lands.
      if (!page.isClosed()) {
        throw error
      }
    })

  const replacement = await nextWindow
  installErrorBannerGuard(replacement)
  await transition
  await expect.poll(() => retired.every(candidate => candidate.isClosed())).toBe(true)

  return replacement
}

async function assertAccount(page: Page, id: string | null) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const state = await (window as unknown as NativeAccountWindow).hermesDesktop.platformAccount.status()

          return { id: state.account?.id ?? null, phase: state.phase, remember: state.remember_state }
        }),
      { timeout: 120_000 }
    )
    .toEqual({ id, phase: id === null ? 'signed_out' : 'signed_in', remember: 'session_only' })
}

async function inspectHistory(page: Page, own: string, foreign: string[]) {
  return page.evaluate(
    async ({ ownSession, foreignSessions }) => {
      const desktop = (window as unknown as NativeAccountWindow).hermesDesktop
      const api = desktop.api
      const account = await desktop.platformAccount.status()
      const version = await desktop.getVersion()
      const listed = await api<{ sessions: Array<{ id: string }> }>({ path: '/api/sessions?profile=default' })

      const search = async (query: string) => {
        const result = await api<{ results: Array<{ session_id: string }> }>({
          path: `/api/sessions/search?profile=default&q=${encodeURIComponent(query)}`
        })

        return result.results.map(row => row.session_id)
      }

      const ownDetail = await api<{ id: string }>({ path: `/api/sessions/${ownSession}?profile=default` })
      const foreignResults = []

      for (const session of foreignSessions) {
        let detail: unknown

        try {
          detail = await api({ path: `/api/sessions/${session}?profile=default` })
        } catch (error) {
          detail = { rejected: String(error) }
        }

        foreignResults.push({ session, search: await search(session), detail })
      }

      return {
        runtime: {
          accountAdapter: desktop.accountAdapter,
          accountId: account.account?.id,
          mode: account.mode,
          hermesHome: version.hermesHome
        },
        listed: listed.sessions.map(row => row.id),
        ownSearch: await search(ownSession),
        ownDetail: ownDetail.id,
        foreign: foreignResults
      }
    },
    { ownSession: own, foreignSessions: foreign }
  )
}

async function assertHistoryUi(page: Page, own: string, foreign: string[]) {
  const sidebar = page.locator('[data-aino-sidebar]')
  const ownTitle = sidebar.getByText(`Private ${own}`, { exact: true })

  await expect(ownTitle).toBeVisible({ timeout: 60_000 })

  for (const other of foreign) {
    await expect(sidebar.getByText(`Private ${other}`, { exact: true })).toHaveCount(0)
    expect(new URL(page.url()).hash.split('?')[0]).not.toBe(`#/${other}`)
    await expect(page.getByText(`Saved ${other}`, { exact: true })).toHaveCount(0)
  }

  await ownTitle.click()
  await expect.poll(() => new URL(page.url()).hash.split('?')[0]).toBe(`#/${own}`)
  const surface = page.locator('[data-chat-surface]:visible')
  await expect(surface.getByText(`Notebook ${own}`, { exact: true })).toBeVisible()
  await expect(surface.getByText(`Saved ${own}`, { exact: true })).toBeVisible()
  await expect(surface.getByText(/This chat belongs to another account/)).toHaveCount(0)

  return { route: new URL(page.url()).hash, activeConversation: own, foreignContentVisible: false }
}

async function assertHistory(page: Page, own: string, foreign: string[], expectedHome: string) {
  // This native REST bridge waits for the actual account-owned gateway to start.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          try {
            await (window as unknown as NativeAccountWindow).hermesDesktop.api({
              path: '/api/sessions?profile=default'
            })

            return true
          } catch {
            return false
          }
        }),
      { timeout: 120_000 }
    )
    .toBe(true)
  const proof = await inspectHistory(page, own, foreign)

  expect(proof.runtime).toEqual({
    accountAdapter: 'platform',
    mode: 'development',
    accountId: ACCOUNT_FIXTURES.find(account => account.session === own)!.id,
    hermesHome: expectedHome
  })

  expect(proof.listed).toContain(own)
  expect(proof.ownSearch).toContain(own)
  expect(proof.ownDetail).toBe(own)

  for (const other of proof.foreign) {
    expect(proof.listed).not.toContain(other.session)
    expect(other.search).toEqual([])
    expect(other.detail).toEqual({ rejected: expect.stringMatching(/404/) })
  }

  return { ...proof, ui: await assertHistoryUi(page, own, foreign) }
}

async function chromiumStorage(app: ElectronApplication, page: Page, origin: string, marker?: string) {
  const native = await app.browserWindow(page)

  return native.evaluate(
    async (window, value) => {
      const storage = window.webContents.session

      if (value.marker) {
        await storage.cookies.set({ url: value.origin, name: 'account-workspace-marker', value: value.marker })
      }
      const cookies = await storage.cookies.get({ url: value.origin, name: 'account-workspace-marker' })

      return { path: storage.getStoragePath(), markers: cookies.map((cookie: { value: string }) => cookie.value) }
    },
    { origin, marker }
  )
}

test('isolates real account homes, history and Chromium storage across A → B → A on one device', async ({
  browserName: _browserName
}, testInfo) => {
  test.setTimeout(420_000)
  const sandbox = createSandbox('account-workspace')
  const inference = await startMockServer()
  const platform = await startAccountWorkspacePlatform()
  const python = process.env.HERMES_DESKTOP_PYTHON || path.resolve(import.meta.dirname, '../../../.venv/bin/python')

  const homes = ACCOUNT_FIXTURES.map(account =>
    resolveDesktopHermesHome({
      home: sandbox.root,
      env: { HERMES_HOME: sandbox.hermesHome },
      accountWorkspace: { userData: sandbox.userDataDir, origin: platform.origin, userId: account.id }
    })
  )

  const legacy = 'legacysharednotebook'
  const proofs: unknown[] = []
  let launched: Awaited<ReturnType<typeof launchGuardedDesktop>> | null = null
  let page: Page | null = null

  try {
    for (const [index, home] of [sandbox.hermesHome, ...homes].entries()) {
      seedWorkspaceSession(python, sandbox, home, index === 0 ? legacy : ACCOUNT_FIXTURES[index - 1]!.session)
      writeMockProviderConfig(
        home,
        inference.url,
        '  language: en',
        'desktop:\n  repo_scan_enabled: false\nupdates:\n  check: false'
      )
      writeEnvFile(home, 'e2e-mock-key', inference.url)
    }

    fs.writeFileSync(
      path.join(sandbox.userDataDir, 'platform-development.json'),
      JSON.stringify({ enabled: true, origin: platform.origin })
    )
    const inherited = buildAppEnv(sandbox)
    const env: Record<string, string> = { ...fixtureEnvironment(), HOME: sandbox.root, HERMES_HOME: sandbox.hermesHome }

    for (const key of [
      'HERMES_DESKTOP_USER_DATA_DIR',
      'HERMES_DESKTOP_IGNORE_EXISTING',
      'HERMES_DESKTOP_HERMES_ROOT',
      'HERMES_DESKTOP_APP_NAME',
      'HERMES_DESKTOP_SKIP_QUIT_CONFIRM',
      'HERMES_DESKTOP_SKIP_PROTOCOL_REGISTRATION',
      'HERMES_DESKTOP_ISOLATED_BACKEND'
    ]) {
      if (inherited[key]) {
        env[key] = inherited[key]
      }
    }

    const pythonGuard = installLoopbackPythonGuard(sandbox.root)
    env.HERMES_DESKTOP_PYTHON = guardedPlatformPython(sandbox.root, pythonGuard, python)
    const tokenFile = path.join(sandbox.userDataDir, 'platform-tokens.json')
    launched = await launchGuardedDesktop(env, installLoopbackNodeGuard(sandbox.root))
    const { app } = launched
    page = launched.page
    await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    await assertAccount(page, null)
    expect(fs.existsSync(tokenFile)).toBe(false)

    page = await changeAccount(app, page, ACCOUNT_FIXTURES[0].email)
    await assertAccount(page, '17')
    proofs.push(
      await assertHistory(page, ACCOUNT_FIXTURES[0].session, [ACCOUNT_FIXTURES[1].session, legacy], homes[0]!)
    )
    await page.evaluate(() => localStorage.setItem('account-workspace-probe', 'alpha'))
    const alphaStorage = await chromiumStorage(app, page, platform.origin, 'alpha')
    await page.evaluate(() => (window as unknown as NativeAccountWindow).hermesDesktop.openWindow())
    await expect.poll(() => app.windows().length).toBe(2)
    const peer = app.windows().find(candidate => candidate !== page)!
    await assertAccount(peer, '17')
    await page.screenshot({ path: testInfo.outputPath('account-alpha.png') })
    expect(await collectErrorBanners(page)).toEqual([])
    expect(fs.existsSync(tokenFile)).toBe(false)

    page = await changeAccount(app, page, null)
    await assertAccount(page, null)
    expect(peer.isClosed()).toBe(true)
    page = await changeAccount(app, page, ACCOUNT_FIXTURES[1].email)
    await assertAccount(page, '23')
    proofs.push(
      await assertHistory(page, ACCOUNT_FIXTURES[1].session, [ACCOUNT_FIXTURES[0].session, legacy], homes[1]!)
    )
    expect(await page.evaluate(() => localStorage.getItem('account-workspace-probe'))).toBeNull()
    const betaStorage = await chromiumStorage(app, page, platform.origin)
    expect(betaStorage.path).not.toBe(alphaStorage.path)
    expect(betaStorage.markers).toEqual([])
    await page.evaluate(() => localStorage.setItem('account-workspace-probe', 'beta'))
    await chromiumStorage(app, page, platform.origin, 'beta')
    await page.screenshot({ path: testInfo.outputPath('account-beta.png') })
    expect(await collectErrorBanners(page)).toEqual([])
    expect(fs.existsSync(tokenFile)).toBe(false)

    page = await changeAccount(app, page, null)
    page = await changeAccount(app, page, ACCOUNT_FIXTURES[0].email)
    await assertAccount(page, '17')
    proofs.push(
      await assertHistory(page, ACCOUNT_FIXTURES[0].session, [ACCOUNT_FIXTURES[1].session, legacy], homes[0]!)
    )
    expect(await page.evaluate(() => localStorage.getItem('account-workspace-probe'))).toBe('alpha')
    expect(await chromiumStorage(app, page, platform.origin)).toEqual(alphaStorage)
    expect(platform.logins).toEqual(['17', '23', '17'])
    expect(fs.existsSync(tokenFile)).toBe(false)
    expect(fs.existsSync(path.join(sandbox.hermesHome, 'state.db'))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('account-alpha-restored.png') })
    expect(await collectErrorBanners(page)).toEqual([])

    await app.close()
    launched = null
    launched = await launchGuardedDesktop(env, installLoopbackNodeGuard(sandbox.root))
    page = launched.page
    await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    await assertAccount(page, null)
    expect(fs.existsSync(tokenFile)).toBe(false)
  } finally {
    await testInfo.attach('account-workspace-history-proof', {
      body: JSON.stringify(proofs, null, 2),
      contentType: 'application/json'
    })

    if (page && !page.isClosed()) {
      await testInfo.attach('final-error-banners', {
        body: JSON.stringify(await collectErrorBanners(page)),
        contentType: 'application/json'
      })
    }

    await launched?.app.close().catch(() => undefined)

    for (const [index, home] of [sandbox.hermesHome, ...homes].entries()) {
      const logs = path.join(home, 'logs')

      if (fs.existsSync(logs)) {
        fs.cpSync(logs, testInfo.outputPath(`backend-${index}-logs`), { recursive: true })
      }
    }

    await inference.close()
    await platform.close()
    sandbox.cleanup()
  }
})

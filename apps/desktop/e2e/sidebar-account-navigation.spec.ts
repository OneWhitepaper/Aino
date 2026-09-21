import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { startMockServer } from '../../../tests-js/scripts/mock-server'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  type MockBackendFixture,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig
} from './fixtures'
import { expect, test } from './test'

test('the signed-in account remains accessible across Sessions and Agent Hub', async () => {
  test.setTimeout(180_000)
  const sandbox = createSandbox('sidebar-account')
  const isolatedHome = path.join(sandbox.root, 'os-home')
  sandbox.hermesHome = path.join(isolatedHome, '.hermes')
  mkdirSync(sandbox.hermesHome, { recursive: true })
  const mock = await startMockServer()
  let fixture: MockBackendFixture | undefined

  try {
    writeMockProviderConfig(
      sandbox.hermesHome,
      mock.url,
      '  language: en',
      'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true'
    )
    writeEnvFile(sandbox.hermesHome)
    const env = buildAppEnv(sandbox, {
      HOME: isolatedHome,
      XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
      XDG_DATA_HOME: path.join(isolatedHome, '.local/share'),
      HERMES_SHARED_AUTH_DIR: path.join(sandbox.hermesHome, 'shared')
    })
    delete env.CODEX_HOME
    delete env.CLAUDE_CONFIG_DIR
    delete env.HERMES_DESKTOP_DEV_SERVER
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_ENV
    const launched = await launchDesktop(env)
    fixture = { ...launched, mock, mockUrl: mock.url, sandbox, cleanup: async () => {} }
    const { app, page } = launched
    const rendererErrors: string[] = []
    page.on('pageerror', error => rendererErrors.push(error.message))
    await app.evaluate(({ app }, home) => app.setPath('home', home), isolatedHome)
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
    expect(
      await page.evaluate(() => (window as Window & { hermesDesktop?: { accountAdapter?: string } }).hermesDesktop?.accountAdapter)
    ).toBe('legacy-development')
    await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('13800000101')
    await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
    await page.getByRole('button', { name: 'Send code', exact: true }).click()
    await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await waitForAppReady(fixture, 120_000)

    const footer = page.locator('[data-slot="sidebar-identity-footer"]:visible')
    const account = footer.getByRole('button', { name: /^My account/ })
    await expect(footer).toHaveCount(1)
    const accountLabel = await account.getAttribute('aria-label')
    await page.locator('[data-tree-tab="hermes-bots:pane"]:visible').click()
    await expect(page.locator('[data-tree-tab="hermes-bots:pane"]:visible')).toHaveAttribute('aria-selected', 'true')
    await expect(footer).toHaveCount(1)
    await expect(account).toHaveAttribute('aria-label', accountLabel!)
    await page.screenshot({ path: test.info().outputPath('agent-hub-account.png') })

    await account.click()
    await expect(page).toHaveURL(/#\/settings\?tab=account$/)
    await expect(page.getByRole('button', { name: 'Edit nickname', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close settings', exact: true }).click()
    await expect(page.locator('[data-tree-tab="hermes-bots:pane"]:visible')).toHaveAttribute('aria-selected', 'true')
    await footer.getByRole('button', { name: 'Open settings', exact: true }).click()
    await expect(page).toHaveURL(/#\/settings$/)
    await page.getByRole('button', { name: 'Close settings', exact: true }).click()

    await page.locator('[data-tree-tab="sessions"]:visible').click()
    await expect(footer).toHaveCount(1)
    await expect(account).toHaveAttribute('aria-label', accountLabel!)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(600, 800, false))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(640)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b')
    const overlayTab = page.locator('[data-narrow-overlay-tab="hermes-bots:pane"]')
    await expect(overlayTab).toBeVisible()
    await overlayTab.click()
    await expect(overlayTab).toHaveAttribute('aria-selected', 'true')
    await expect(footer).toHaveCount(1)
    await expect(account).toHaveAttribute('aria-label', accountLabel!)
    const bounds = await footer.boundingBox()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight))
    await page.screenshot({ path: test.info().outputPath('agent-hub-account-narrow.png') })
    expect(rendererErrors).toEqual([])
  } finally {
    await fixture?.app.close()
    await mock.close()
    sandbox.cleanup()
  }
})

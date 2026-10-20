import * as fs from 'node:fs'
import * as path from 'node:path'

import { writeEnvFile, writeMockProviderConfig } from '../../../tests-js/scripts/mock-provider-config'
import { startMockServer } from '../../../tests-js/scripts/mock-server'
import { signInPlatformFixture, startPlatformServer } from '../../../tests-js/scripts/platform-account-fixture'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  waitForAppReady,

  } from './fixtures'
import { expect, test } from './test'

interface NativeAccountWindow {
  hermesDesktop: {
    platformAccount: {
      capabilities(): Promise<{ phone_login_enabled: boolean; login_agreement_enabled: boolean }>
    }
  }
}


test('uses the real native platform bridge across windows without a gateway-owned identity', async ({
  browserName: _browserName
}, testInfo) => {
  test.setTimeout(180_000)
  const sandbox = createSandbox('platform-account')
  const inference = await startMockServer()
  const platform = await startPlatformServer()
  const diagnostics: string[] = []
  let launched: Awaited<ReturnType<typeof launchDesktop>> | null = null

  try {
    writeMockProviderConfig(sandbox.hermesHome, inference.url, '  language: en', 'desktop:\n  repo_scan_enabled: false')
    writeEnvFile(sandbox.hermesHome)
    fs.writeFileSync(
      path.join(sandbox.userDataDir, 'platform-development.json'),
      JSON.stringify({ enabled: true, origin: platform.origin }),
      'utf8'
    )
    const env = buildAppEnv(sandbox)

    const unavailable = await launchDesktop(
      buildAppEnv(sandbox, {
        HERMES_DESKTOP_BOOT_FAKE_ERROR: 'isolated backend unavailable',
        HERMES_DESKTOP_BOOT_FAKE_STEP_MS: '5'
      })
    )

    launched = unavailable
    await expect(unavailable.page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    await unavailable.page.waitForTimeout(250)
    expect(
      await unavailable.page.getByRole('textbox', { name: 'Phone number', exact: true }).evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const top = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)

        return Boolean(top?.closest('[data-account-login-page]'))
      })
    ).toBe(true)
    await unavailable.page.screenshot({ path: testInfo.outputPath('platform-account-login-native.png') })
    await unavailable.app.close()
    launched = null

    launched = await launchDesktop(env)
    const { app, page } = launched
    page.on('console', message => diagnostics.push(`console ${message.type()}: ${message.text()}`))
    page.on('pageerror', error => diagnostics.push(`pageerror: ${error.stack ?? error.message}`))
    page.on('requestfailed', request => diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`))

    expect(await app.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      userData: app.getPath('userData')
    }))).toEqual({ packaged: false, userData: sandbox.userDataDir })
    await expect.poll(() => platform.requests.some(item => item.path === '/api/v1/settings/public')).toBe(true)
    await expect.poll(() => page.evaluate(async () => {
      const capabilities = await (window as unknown as NativeAccountWindow).hermesDesktop.platformAccount.capabilities()

      return { phone: capabilities.phone_login_enabled, agreement: capabilities.login_agreement_enabled }
    })).toEqual({ phone: true, agreement: true })
    await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    const loginBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
    expect(loginBounds.width).toBeLessThanOrEqual(360)

    await signInPlatformFixture(page)
    expect(platform.requests.some(item => item.path === '/desktop/captcha')).toBe(false)
    await waitForAppReady({ app, page } as never, 120_000)

    const verify = platform.requests.find(item => item.path === '/api/v1/auth/phone/verify')
    expect(verify?.body).toEqual({
      phone: '+8613800138000',
      challenge_id: 'native-challenge',
      code: '246810',
      register_if_new: true,
      agreement_revision: 'native-terms-1'
    })
    const workspaceBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds())
    expect(workspaceBounds.width).toBeGreaterThan(1000)

    await page.evaluate(() =>
      (window as unknown as { hermesDesktop: { openWindow(): Promise<unknown> } }).hermesDesktop.openWindow()
    )
    await expect.poll(() => app.windows().length).toBe(2)
    const peer = app.windows().find(candidate => candidate !== page)!
    await expect(peer.getByRole('button', { name: 'My account · Native member', exact: true })).toBeVisible({
      timeout: 120_000
    })

    const nativeWindow = await app.browserWindow(page)
    await nativeWindow.evaluate(window => {
      window.show()
      window.focus()
    })
    await page.bringToFront()
    await page.screenshot({ path: testInfo.outputPath('platform-workspace-native.png') })
    await page.getByRole('button', { name: 'My account · Native member', exact: true }).click()
    await expect(page.getByText('+86 138****8000', { exact: true })).toBeVisible()
    await expect(page.getByText('member@example.test', { exact: true })).toBeVisible()
    await expect(page.getByText('17', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('platform-account-native.png') })

    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    await expect(peer.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
    await app.close()
    launched = null

    const restarted = await launchDesktop(env)
    launched = restarted
    await expect(restarted.page.getByRole('textbox', { name: 'Phone number', exact: true })).toBeVisible()
  } finally {
    await testInfo.attach('native-startup-diagnostics', { body: diagnostics.join('\n'), contentType: 'text/plain' })
    const logs = path.join(sandbox.hermesHome, 'logs')

    if (fs.existsSync(logs)) {
      fs.cpSync(logs, testInfo.outputPath('backend-logs'), { recursive: true })
    }

    await launched?.app.close().catch(() => undefined)
    await inference.close()
    await platform.close()
    sandbox.cleanup()
  }
})

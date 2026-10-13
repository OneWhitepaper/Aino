import { writeEnvFile, writeMockProviderConfig } from '../../../tests-js/scripts/mock-provider-config'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'

import { startMockServer } from '../../../tests-js/scripts/mock-server'

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

function startPlatformServer() {
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
  let displayName = 'Native member'

  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = []

    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {}
      const requestPath = request.url ?? '/'
      requests.push({ method: request.method ?? '', path: requestPath, body })

      let data: unknown

      if (request.method === 'GET' && requestPath === '/api/v1/settings/public') {
        data = {
          desktop_api_version: 1,
          registration_enabled: true,
          phone_login_enabled: true,
          phone_registration_enabled: true,
          phone_binding_enabled: true,
          phone_regions: ['CN'],
          phone_code_length: 6,
          invitation_code_enabled: false,
          promo_code_enabled: false,
          login_agreement_enabled: true,
          login_agreement_mode: 'checkbox',
          login_agreement_revision: 'native-terms-1',
          login_agreement_documents: [
            { id: 'terms', title: 'User Agreement', content_md: 'Isolated native fixture agreement.' }
          ],
          turnstile_enabled: false,
          tencent_captcha_enabled: false,
          aliyun_captcha_enabled: false
        }
      } else if (request.method === 'POST' && requestPath === '/api/v1/auth/phone/send-code') {
        data = { challenge_id: 'native-challenge', expires_in: 300, retry_after: 2, delivery: 'accepted' }
      } else if (request.method === 'POST' && requestPath === '/api/v1/auth/phone/verify') {
        data = {
          access_token: 'native-access-token',
          refresh_token: 'native-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer'
        }
      } else if (request.method === 'GET' && requestPath === '/api/v1/user/profile') {
        data = {
          id: 17,
          username: displayName,
          email: 'member@example.test',
          phone_bound: true,
          auth_bindings: { phone: { subject_hint: '+86 138****8000' } }
        }
      } else if (request.method === 'PUT' && requestPath === '/api/v1/user') {
        displayName = String(body.username || displayName)
        data = {
          id: 17,
          username: displayName,
          email: 'member@example.test',
          phone_bound: true,
          auth_bindings: { phone: { subject_hint: '+86 138****8000' } }
        }
      } else if (request.method === 'POST' && requestPath === '/api/v1/auth/logout') {
        data = null
      } else if (request.method === 'GET' && ['/api/v1/desktop/models', '/api/v1/desktop/devices'].includes(requestPath)) {
        data = []
      } else if (request.method === 'GET' && requestPath === '/api/v1/desktop/billing-summary') {
        data = {
          currency: 'USD', balance: '12.00000000', available_balance: '12.00000000', frozen_balance: '0.00000000',
          payment_enabled: false, active_subscriptions: [], updated_at: '2026-09-18T00:00:00Z'
        }
      } else if (request.method === 'GET' && requestPath.startsWith('/api/v1/payment/orders/my?')) {
        const query = new URL(requestPath, 'http://localhost').searchParams
        data = { items: [], total: 0, page: Number(query.get('page')), page_size: Number(query.get('page_size')) }
      } else {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ code: 'NOT_FOUND', message: 'not found' }))

        return
      }

      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 0, message: 'ok', data }))
    })
  })

  return new Promise<{ close(): Promise<void>; origin: string; requests: typeof requests }>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        reject(new Error('platform fixture did not bind a TCP port'))

        return
      }

      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise<void>(done => server.close(() => done()))
      })
    })
  })
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

    await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+8613800138000')
    await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
    // This fixture covers shared in-memory authority, not the host's Keychain.
    await page.getByRole('checkbox', { name: 'Keep me signed in on this device', exact: true }).uncheck()
    await page.getByRole('button', { name: 'Send code', exact: true }).click()
    await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('246810')
    expect(platform.requests.some(item => item.path === '/desktop/captcha')).toBe(false)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
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

import * as http from 'node:http'

import { type ElectronApplication, expect, type Page } from '@playwright/test'

export function startPlatformServer() {
  const requests: Array<{ method: string; path: string; body: Record<string, unknown>; authenticatedProfile?: boolean }> = []
  let displayName = 'Native member'
  let challengeIssued = false

  const verifyChallenge = (body: Record<string, unknown>) => {
    if (!challengeIssued || body.challenge_id !== 'native-challenge' || body.code !== '246810'
        || body.agreement_revision !== 'native-terms-1') { return false }

    challengeIssued = false

    return true
  }

  const handler: http.RequestListener = (request, response) => {
    const chunks: Buffer[] = []

    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {}
      const requestPath = request.url ?? '/'
      const recorded: typeof requests[number] = { method: request.method ?? '', path: requestPath, body }
      requests.push(recorded)

      const route = `${request.method} ${requestPath}`
      let data: unknown

      if (route === 'GET /api/v1/settings/public') {
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
      } else if (route === 'POST /api/v1/auth/phone/send-code') {
        challengeIssued = true
        data = { challenge_id: 'native-challenge', expires_in: 300, retry_after: 2, delivery: 'accepted' }
      } else if (route === 'POST /api/v1/auth/phone/verify') {
        if (!verifyChallenge(body)) {
          response.writeHead(401, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ code: 'INVALID_CODE', message: 'fixture verification failed' }))

          return
        }

        data = {
          access_token: 'native-access-token',
          refresh_token: 'native-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer'
        }
      } else if (route === 'GET /api/v1/user/profile') {
        // These inert fixture tokens are stable across service restarts, so a
        // restored encrypted token must authenticate without issuing a new login.
        recorded.authenticatedProfile = request.headers.authorization === 'Bearer native-access-token'

        if (!recorded.authenticatedProfile) {
          response.writeHead(401, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ code: 'UNAUTHORIZED', message: 'fixture access token required' }))

          return
        }

        data = {
          id: 17,
          username: displayName,
          email: 'member@example.test',
          phone_bound: true,
          auth_bindings: { phone: { subject_hint: '+86 138****8000' } }
        }
      } else if (route === 'PUT /api/v1/user') {
        displayName = String(body.username || displayName)
        data = {
          id: 17,
          username: displayName,
          email: 'member@example.test',
          phone_bound: true,
          auth_bindings: { phone: { subject_hint: '+86 138****8000' } }
        }
      } else if (route === 'POST /api/v1/auth/logout') {
        data = null
      } else if (route.split('?')[0] === 'GET /api/v1/desktop/models' || route === 'GET /api/v1/desktop/devices') {
        data = []
      } else if (route === 'GET /api/v1/desktop/billing-summary') {
        data = {
          currency: 'USD', balance: '12.00000000', available_balance: '12.00000000', frozen_balance: '0.00000000',
          payment_enabled: false, active_subscriptions: [], updated_at: '2026-09-18T00:00:00Z'
        }
      } else if (route.startsWith('GET /api/v1/payment/orders/my?')) {
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
  }

  const server = http.createServer(handler)

  return new Promise<{ close(): Promise<void>; origin: string; handler: http.RequestListener; requests: typeof requests }>((resolve, reject) => {
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
        handler,
        close: () => new Promise<void>(done => server.close(() => done()))
      })
    })
  })
}

/** Wait for the authenticated renderer: historical bundles reuse it, current bundles replace it. */
export async function platformLoginWorkspace(app: ElectronApplication, page: Page,
  submit: () => Promise<unknown>, timeoutMs = 120_000): Promise<Page> {
  const candidates = new Set<Page>([page])

  const opened = (candidate: Page): void => { candidates.add(candidate) }
  let workspace: Page | undefined
  app.on('window', opened)

  try {
    await submit()
    await expect.poll(async () => {
      for (const candidate of [...candidates].reverse()) {
        if (!candidate.isClosed() && await candidate.getByRole('button', {
          name: /^(?:My account|我的账户) · Native member$/, exact: true
        }).isVisible().catch(() => false)) {
          workspace = candidate

          return true
        }
      }

      return false
    }, { timeout: timeoutMs, message: 'The submitted native account did not reach an authenticated workspace' }).toBe(true)

    if (workspace !== page) { await expect.poll(() => page.isClosed(), { timeout: timeoutMs }).toBe(true) }

    return workspace!
  } finally {
    app.removeListener('window', opened)
  }
}

/** Read only the authenticated persistence facts, never the stored tokens. */
export async function readFixturePlatformSession(page: Page) {
  const snapshot = await page.evaluate(async () => {
    const state = await (window as unknown as { hermesDesktop: { platformAccount: { status: () => Promise<{
      phase: string; account?: { id: string | number } | null; mode: string; remember_state: string; error: unknown
    }> } } }).hermesDesktop.platformAccount.status()

    return { phase: state.phase, userId: String(state.account?.id ?? ''), mode: state.mode,
      rememberState: state.remember_state, hasError: state.error !== null }
  })

  if (snapshot.phase !== 'signed_in' || snapshot.userId !== '17' || snapshot.mode !== 'production'
      || snapshot.rememberState !== 'encrypted' || snapshot.hasError) {
    throw new Error('Persisted platform session is not authenticated with the encrypted production account')
  }

  return snapshot
}

/** Use the real sign-in UI and return the renderer owned by that account. */
export async function signInPlatformFixture(app: ElectronApplication, page: Page,
  options: { keepSignedIn?: boolean; allowExisting?: boolean; requireExisting?: boolean } = {}): Promise<Page> {
  if (options.allowExisting || options.requireExisting) {
    // The native updater's automatically relaunched workspace can already own
    // the persisted fixture session. It still uses the real platform bridge.
    const member = page.getByRole('button', { name: /^(?:My account · Native member|我的账户 · Native member)$/, exact: true })
    const phone = page.getByRole('textbox', { name: /^(?:Phone number|手机号)$/, exact: true })
    await expect.poll(async () => await member.isVisible() || await phone.isVisible(), { timeout: 120_000 }).toBe(true)

    if (await member.isVisible()) {
      if (options.requireExisting) { await readFixturePlatformSession(page) }

      return page
    }

    if (options.requireExisting) { throw new Error('Persisted platform session was lost; migration cannot sign in again') }
  }

  await page.getByRole('textbox', { name: /^(?:Phone number|手机号)$/, exact: true }).fill('+8613800138000')
  await page.getByRole('checkbox', { name: /^(?:Agree to the user agreement and privacy policy|同意用户协议和隐私政策)$/, exact: true }).check()
  const persistent = page.getByRole('checkbox', { name: /^(?:Keep me signed in on this device|在此设备保持登录)$/, exact: true })

  if (options.keepSignedIn) { await persistent.check() } else { await persistent.uncheck() }
  await page.getByRole('button', { name: /^(?:Send code|发送验证码)$/, exact: true }).click()
  await expect(page.getByRole('textbox', { name: /^(?:Verification code|验证码)$/, exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: /^(?:Verification code|验证码)$/, exact: true }).fill('246810')

  return platformLoginWorkspace(app, page, () => page.getByRole('button', { name: /^(?:Sign in|登录)$/, exact: true }).click().catch(error => {
    if (!page.isClosed()) { throw error }
  }))
}

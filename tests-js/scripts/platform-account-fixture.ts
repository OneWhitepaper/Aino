import * as http from 'node:http'

import { expect, type Page } from '@playwright/test'

export function startPlatformServer() {
  const requests: Array<{ method: string; path: string; body: Record<string, unknown> }> = []
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
      requests.push({ method: request.method ?? '', path: requestPath, body })

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
      } else if (['GET /api/v1/desktop/models', 'GET /api/v1/desktop/devices'].includes(route)) {
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

/** Real UI and native auth bridge, session-only synthetic credentials. */
export async function signInPlatformFixture(page: Page) {
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+8613800138000')
  await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
  await page.getByRole('checkbox', { name: 'Keep me signed in on this device', exact: true }).uncheck()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('246810')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'My account · Native member', exact: true })).toBeVisible({ timeout: 120_000 })
}

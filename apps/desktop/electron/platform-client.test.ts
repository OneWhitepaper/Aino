import http from 'node:http'

import { afterEach, describe, expect, it } from 'vitest'

import { createPlatformClient, resolvePlatformOrigin } from './platform-client'

const servers: http.Server[] = []

async function serve(handler: http.RequestListener) {
  const server = http.createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('fixture did not bind')
  }

  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
})

describe('platform client', () => {
  it('derives registration from the authenticated service origin, ignoring a public-config redirect', async () => {
    const origin = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            desktop_api_version: 1,
            phone_code_length: 6,
            registration_enabled: true,
            registration_url: 'https://unrelated.example/register'
          }
        })
      )
    })

    const capabilities = await createPlatformClient({ origin, allowInsecureLoopback: true }).capabilities()

    expect(capabilities.registration_url).toBe(`${origin}/register`)
    expect(capabilities.registration_enabled).toBe(true)
  })

  it('reads exact wallet balances separately from subscriptions and only configured desktop payment methods', async () => {
    const summary = {
      currency: 'USD',
      balance: '1234567890.12345678',
      available_balance: '1234567890.12345678',
      frozen_balance: '2.00000000',
      payment_enabled: false,
      updated_at: '2026-09-16T00:00:00Z',
      active_subscriptions: [
        { id: '7', name: 'Fixture quota', expires_at: '2026-10-16T00:00:00Z', remaining: null, unit: 'USD' }
      ]
    }

    const seen: string[] = []

    const origin = await serve((req, res) => {
      seen.push(`${req.method} ${req.url}`)
      expect(req.headers.authorization).toBe('Bearer wallet-access')

      const data =
        req.url === '/api/v1/desktop/billing-summary'
          ? summary
          : {
              balance_disabled: false,
              help_text: '',
              methods: {
                alipay: { payment_type: 'alipay', currency: 'CNY', single_min: 0.01, single_max: 500 },
                stripe: { payment_type: 'stripe', currency: 'USD', single_min: 1, single_max: 500 }
              },
              stripe_publishable_key: 'not-for-desktop'
            }

      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 0, message: 'ok', data }))
    })

    const client = createPlatformClient({ origin, allowInsecureLoopback: true })
    const wallet = await client.walletSummary('wallet-access')
    expect(wallet.available_balance).toBe(summary.available_balance)
    expect(wallet.frozen_balance).toBe('2.00000000')
    expect(wallet.active_subscriptions[0].remaining).toBeNull()
    const checkout = await client.checkoutInfo('wallet-access')
    expect(checkout.payment_enabled).toBe(false)
    expect(checkout.methods).toEqual([
      {
        id: 'alipay',
        display_name: '',
        currency: 'CNY',
        min_amount: '0.01000000',
        max_amount: '500.00000000',
        available: false
      }
    ])
    expect(checkout).not.toHaveProperty('stripe_publishable_key')
    expect(seen.every(request => request.startsWith('GET '))).toBe(true)
  })

  it('reads exact ledger costs through a whitelisted query and removes nested key data', async () => {
    const turn = 'b8664a58-472a-4ba6-b853-94aadee41bb1'

    const origin = await serve((req, res) => {
      const url = new URL(req.url!, 'http://localhost')
      expect(url.pathname).toBe('/api/v1/usage')
      expect(url.searchParams.get('desktop_turn_id')).toBe(turn)
      expect(url.searchParams.get('model')).toBe('fixture-model')
      expect(url.searchParams.get('timezone')).toBe('Asia/Shanghai')
      expect(url.searchParams.get('start_date')).toBe('2026-09-16')
      expect(url.searchParams.has('user_id')).toBe(false)
      expect(req.headers.authorization).toBe('Bearer fixture-access')
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            page: 1,
            page_size: 50,
            total: 1,
            items: [
              {
                id: 42,
                request_id: 'server-request',
                model: 'fixture-model',
                session_id: null,
                desktop_turn_id: turn,
                desktop_call_id: 'cbec3bce-4de2-4fbe-a6ee-5ab3e7d990cb',
                desktop_purpose: 'chat',
                actual_cost_decimal: '0.00000001',
                actual_cost: 999,
                settlement_status: 'settled',
                currency: 'USD',
                created_at: '2026-09-16T00:00:00Z',
                input_tokens: 125,
                output_tokens: 20,
                cache_read_tokens: 60,
                api_key: { key: 'fixture-secret' }
              }
            ]
          }
        })
      )
    })

    const client = createPlatformClient({ origin, allowInsecureLoopback: true })
    const page = await client.listUsage('fixture-access', {
      page: 1,
      page_size: 50,
      desktop_turn_id: turn,
      model: 'fixture-model',
      timezone: 'Asia/Shanghai',
      start_date: '2026-09-16'
    })
    expect(page.items[0].actual_cost_decimal).toBe('0.00000001')
    expect(page.items[0]).not.toHaveProperty('api_key')
    expect(page.items[0]).not.toHaveProperty('actual_cost')
    expect(page.items[0].id).toBe('42')
    expect(page.items[0]).toMatchObject({
      input_tokens: 125,
      output_tokens: 20,
      cache_read_tokens: 60,
      cache_creation_tokens: null
    })
  })
  it('uses the B2 credential route and connection/device scope', async () => {
    let observed: unknown

    const origin = await serve(async (req, res) => {
      let body = ''

      for await (const chunk of req) {
        body += chunk
      }

      observed = { path: req.url, body: JSON.parse(body) }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 'FIXTURE', message: 'stop here' }))
    })

    const client = createPlatformClient({ origin, allowInsecureLoopback: true })
    await client
      .modelLease('access', { device_id: 'device', connection_grant_id: 'grant', model_id: 'model' })
      .catch(() => {})
    expect(observed).toEqual({
      path: '/api/v1/desktop/credentials',
      body: { device_id: 'device', connection_grant_id: 'grant', model_id: 'model' }
    })
  })
  it('uses only unpackaged loopback development config and ignores it when packaged', () => {
    const read = () => JSON.stringify({ enabled: true, origin: 'http://127.0.0.1:8080' })
    expect(resolvePlatformOrigin({ isPackaged: false, readDevelopmentConfig: read })).toEqual({
      origin: 'http://127.0.0.1:8080',
      development: true
    })
    expect(resolvePlatformOrigin({ isPackaged: true, readDevelopmentConfig: read })).toEqual({
      origin: 'https://api.agentera.com.cn',
      development: false
    })
    expect(() =>
      resolvePlatformOrigin({
        isPackaged: false,
        readDevelopmentConfig: () => JSON.stringify({ enabled: true, origin: 'http://example.com' })
      })
    ).toThrow('invalid_platform_origin')
  })
  it('parses the API envelope and validates profile fields', async () => {
    const origin = await serve((req, res) => {
      expect(req.url).toBe('/api/v1/user/profile')
      expect(req.headers.authorization).toBe('Bearer access')
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            id: 17,
            username: 'Ada',
            email: 'ada@example.test',
            phone_bound: true,
            auth_bindings: { phone: { subject_hint: '+86 139****0000' } }
          }
        })
      )
    })

    const client = createPlatformClient({ origin, allowInsecureLoopback: true })
    await expect(client.profile('access')).resolves.toMatchObject({
      id: '17',
      display_name: 'Ada',
      phone_masked: '+86 139****0000'
    })
  })

  it('preserves an unnamed phone account for the existing masked-identity UI fallback', async () => {
    let names: Record<string, unknown> = { username: '' }

    const origin = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            id: 17,
            email: '',
            phone_bound: true,
            auth_bindings: { phone: { subject_hint: '+86 139****0000' } },
            ...names
          }
        })
      )
    })

    const client = createPlatformClient({ origin, allowInsecureLoopback: true })

    for (const fields of [{ username: '' }, { display_name: '', username: '' }]) {
      names = fields
      await expect(client.profile('fixture-access')).resolves.toEqual({
        id: '17',
        display_name: '',
        phone_masked: '+86 139****0000',
        email: ''
      })
    }
  })

  it('still rejects malformed profile names instead of coercing them into a label', async () => {
    let names: Record<string, unknown> = {}

    const origin = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            id: 17,
            email: '',
            phone_bound: true,
            auth_bindings: { phone: { subject_hint: '+86 139****0000' } },
            ...names
          }
        })
      )
    })

    const client = createPlatformClient({ origin, allowInsecureLoopback: true })

    for (const fields of [
      { username: 42 },
      { username: {} },
      { username: false },
      { display_name: [], username: 'Ada' },
      {}
    ]) {
      names = fields
      await expect(client.profile('fixture-access')).rejects.toMatchObject({ code: 'invalid_response' })
    }
  })

  it('fails closed when public settings enable conflicting captcha providers', async () => {
    const origin = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            desktop_api_version: 1,
            registration_enabled: true,
            phone_login_enabled: true,
            phone_registration_enabled: true,
            phone_binding_enabled: true,
            phone_regions: ['+86'],
            phone_code_length: 6,
            turnstile_enabled: true,
            turnstile_site_key: 'turnstile',
            tencent_captcha_enabled: true,
            tencent_captcha_app_id: 'tencent'
          }
        })
      )
    })

    await expect(createPlatformClient({ origin, allowInsecureLoopback: true }).capabilities()).rejects.toMatchObject({
      code: 'invalid_response'
    })
  })

  it('rejects an authenticated cross-origin redirect without forwarding the token', async () => {
    let leaked: string | undefined

    const target = await serve((req, res) => {
      leaked = req.headers.authorization
      res.end('{}')
    })

    const origin = await serve((_req, res) => {
      res.statusCode = 302
      res.setHeader('location', `${target}/steal`)
      res.end()
    })

    const client = createPlatformClient({ origin, allowInsecureLoopback: true })

    await expect(client.profile('access-secret')).rejects.toMatchObject({ code: 'redirect_rejected' })
    expect(leaked).toBeUndefined()
  })

  it('maps timeout and explicit 401 to distinct safe errors', async () => {
    const slow = await serve((_req, _res) => {})
    await expect(
      createPlatformClient({ origin: slow, allowInsecureLoopback: true, timeoutMs: 15 }).profile('access')
    ).rejects.toMatchObject({ code: 'network_timeout', authentication: false })

    const denied = await serve((_req, res) => {
      res.statusCode = 401
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 'TOKEN_INVALID', message: 'raw server detail' }))
    })

    await expect(
      createPlatformClient({ origin: denied, allowInsecureLoopback: true }).profile('access')
    ).rejects.toMatchObject({ code: 'TOKEN_INVALID', authentication: true })
  })

  it('keeps the timeout active while a response body is stalled', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"code":0,"message":"ok","data":')
    })

    await expect(
      createPlatformClient({ origin, allowInsecureLoopback: true, timeoutMs: 15 }).profile('access')
    ).rejects.toMatchObject({ code: 'network_timeout' })
  })

  it('requires the code/message/data response envelope', async () => {
    const origin = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ id: 17, username: 'unwrapped', email: '' }))
    })

    await expect(createPlatformClient({ origin, allowInsecureLoopback: true }).profile('access')).rejects.toMatchObject(
      {
        code: 'invalid_response'
      }
    )
  })

  it.each([
    [{ access_token: 'access', refresh_token: 'refresh', expires_in: 0, token_type: 'Bearer' }, 'zero expiry'],
    [{ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Basic' }, 'non-Bearer type']
  ])('rejects malformed token pairs: %s (%s)', async data => {
    const origin = await serve((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 0, message: 'success', data }))
    })

    await expect(
      createPlatformClient({ origin, allowInsecureLoopback: true }).refresh('refresh')
    ).rejects.toMatchObject({
      code: 'invalid_response'
    })
  })

  it('does not classify business 403 as token authentication failure or invent retry_after', async () => {
    const origin = await serve((_req, res) => {
      res.statusCode = 403
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 403, message: 'Recent authentication required', reason: 'RECENT_AUTH_REQUIRED' }))
    })

    await expect(createPlatformClient({ origin, allowInsecureLoopback: true }).profile('access')).rejects.toMatchObject(
      {
        code: 'RECENT_AUTH_REQUIRED',
        authentication: false,
        retryAfter: undefined
      }
    )
  })

  it('maps API rate-limit metadata into finite safe error fields', async () => {
    const origin = await serve((_req, res) => {
      res.statusCode = 429
      res.setHeader('retry-after', '47')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 429, message: 'raw cooldown detail', reason: 'SMS_RATE_LIMITED' }))
    })

    await expect(
      createPlatformClient({ origin, allowInsecureLoopback: true }).requestPhoneCode({ phone: '13900000000' })
    ).rejects.toMatchObject({ code: 'SMS_RATE_LIMITED', retryAfter: 47, authentication: false })
  })
})

import http from 'node:http'

import { afterEach, expect, it } from 'vitest'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'
import { unwrapPlatformAccountIpc } from '../shared/platform-contract'

import { registerPlatformIpc } from './platform-ipc'

const servers: http.Server[] = []
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
  )
})

const quote = {
  requested_amount: '20.00000001',
  pay_amount: '20.30',
  fee_amount: '0.30',
  credit_amount: '2.85714286',
  payment_currency: 'CNY',
  credit_currency: 'USD'
}

const input = {
  expected_user_id: '17',
  amount: '20.00000001',
  payment_type: 'alipay',
  order_type: 'balance',
  client_order_id: 'd83601a2-2e9a-4910-859b-79e346020905',
  expected_quote: quote
}

const order = {
  id: 42,
  user_id: 17,
  client_order_id: input.client_order_id,
  status: 'PENDING',
  payment_type: 'alipay',
  out_trade_no: 'fixture-42',
  requested_amount_decimal: quote.requested_amount,
  pay_amount_decimal: quote.pay_amount,
  credit_amount_decimal: quote.credit_amount,
  fee_amount_decimal: quote.fee_amount,
  payment_currency: 'CNY',
  credit_currency: 'USD',
  created_at: '2026-09-16T00:00:00Z',
  expires_at: '2099-09-16T00:00:00Z',
  confirmation_required: false,
  checkout: {
    qr_code: 'weixin://fixture',
    pay_url: 'https://pay.example.test/checkout?opaque=fixture',
    expires_at: '2099-09-16T00:00:00Z'
  },
  api_key: { key: 'must-not-reach-renderer' },
  user: { access_token: 'must-not-reach-renderer' },
  pay_amount: 99,
  amount: 99
}

async function rig() {
  const requests: Array<{ path: string; method: string; body: Record<string, unknown>; authorization: string }> = []
  let current: Record<string, unknown> = structuredClone(order)
  let limits = { single_min: 0.00000001, single_max: 10.00000001 }
  let failure = ''
  let profileUser = 17
  let heldGet: (() => void) | undefined
  let getStarted: (() => void) | undefined

  const server = http.createServer(async (req, res) => {
    let raw = ''

    for await (const part of req) {
      raw += part
    }

    const path = req.url || ''
    const body = raw ? JSON.parse(raw) : {}
    requests.push({ path, method: req.method || '', body, authorization: req.headers.authorization || '' })

    const reply = (data: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: status === 200 ? 0 : 1, message: 'fixture', data }))
    }

    if (path === '/api/v1/user/profile') {
      reply({ id: profileUser, username: 'fixture', email: '' })

      return
    }

    if (path === '/api/v1/auth/refresh') {
      reply({ access_token: 'rotated', refresh_token: 'rotated-refresh', expires_in: 3600, token_type: 'Bearer' })

      return
    }

    if (path === '/api/v1/auth/logout') {
      reply({})

      return
    }

    if (path === '/api/v1/desktop/billing-summary') {
      reply({
        currency: 'USD',
        balance: '1234567890.12345678',
        frozen_balance: '0.00000001',
        available_balance: '1234567890.12345677',
        payment_enabled: true,
        updated_at: '2026-09-16T00:00:00Z',
        active_subscriptions: [],
        api_key: 'must-not-reach-renderer'
      })

      return
    }

    if (path === '/api/v1/payment/checkout-info') {
      reply({
        balance_disabled: false,
        help_text: '',
        methods: {
          alipay: { payment_type: 'alipay', currency: 'CNY', ...limits }
        },
        api_key: 'must-not-reach-renderer'
      })

      return
    }

    if (path === '/api/v1/payment/quote') {
      if (failure === 'quote401' && req.headers.authorization === 'Bearer fixture-access') {
        reply({}, 401)

        return
      }

      reply({ ...quote, access_token: 'not-for-renderer' })

      return
    }

    if (path === '/api/v1/payment/orders') {
      if (failure === 'create401') {
        reply({}, 401)

        return
      }

      if (failure === 'timeout') {
        return
      }

      reply({ order_id: 42, ...quote, access_token: 'not-for-renderer' })

      return
    }

    if (path === '/api/v1/payment/orders/42/cancel') {
      current = { ...current, status: 'CANCELLED' }
      reply({ message: 'cancelled' })

      return
    }

    if (path.startsWith('/api/v1/payment/orders/my?')) {
      reply({ items: [current], page: 1, page_size: 20, total: 1 })

      return
    }

    if (path === '/api/v1/payment/orders/42') {
      if (failure === 'hold') {
        heldGet = () => reply(current)
        getStarted?.()

        return
      }

      reply(current)

      return
    }

    reply({}, 404)
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const client = createPlatformClient({ origin, allowInsecureLoopback: true, timeoutMs: 250 })

  const auth = createPlatformAuth({
    client,
    now: Date.now,
    tokenStore: {
      load: async () => ({
        accessToken: 'fixture-access',
        refreshToken: 'fixture-refresh',
        expiresAt: Date.now() + 3600_000
      }),
      save: async () => 'encrypted',
      clear: async () => undefined
    }
  })

  await auth.initialize()
  const handlers = new Map<string, (...args: any[]) => any>()
  const frame = { url: 'http://localhost:5174/' }
  const sender = { mainFrame: frame }
  const win = { isDestroyed: () => false, webContents: { ...sender, isDestroyed: () => false, send: () => undefined } }
  const launches: string[] = []

  const ipc = registerPlatformIpc({
    ipc: {
      handle: (name, handler) => {
        handlers.set(name, handler)
      },
      removeHandler: name => {
        handlers.delete(name)
      }
    },
    auth,
    captcha: { acquire: async () => ({}) },
    fromWebContents: value => (value === sender ? win : null),
    trustedRendererUrl: frame.url,
    openPaymentBrowser: async (url: string) => {
      launches.push(url)
    }
  })

  ipc.registerWindow(win)
  const event = { sender, senderFrame: frame }

  return {
    auth,
    origin,
    setLimits: (min: number, max: number) => {
      limits = { single_min: min, single_max: max }
    },
    requests,
    launches,
    ipc,
    event,
    handlers,
    setOrder: (patch: Record<string, unknown>) => {
      current = { ...structuredClone(order), ...patch }
    },
    setFailure: (next: string) => {
      failure = next
    },
    setProfileUser: (id: number) => {
      profileUser = id
    },
    waitGet: () =>
      new Promise<void>(resolve => {
        getStarted = resolve
      }),
    releaseGet: () => heldGet?.(),
    invoke: async (name: string, body: unknown = input, source = event) => {
      const handler = handlers.get(`aino:platform-billing:${name}`)
      expect(handler, `registered payment capability ${name}`).toBeTypeOf('function')

      return unwrapPlatformAccountIpc(await handler!(source, body)) as any
    }
  }
}

it('keeps wallet reads owner-scoped and rejects inverted finite checkout limits without losing decimal precision', async () => {
  const f = await rig()
  const owner = { expected_user_id: '17' }
  expect(await f.invoke('scope', owner)).toEqual({ origin: f.origin, user_id: '17', generation: f.auth.generation() })
  const summary = await f.invoke('summary', owner)
  expect(summary.balance).toBe('1234567890.12345678')
  expect(summary.available_balance).toBe('1234567890.12345677')
  expect(summary).not.toHaveProperty('api_key')
  const checkout = await f.invoke('checkout-info', owner)
  expect(checkout.methods[0]).toMatchObject({ min_amount: '0.00000001', max_amount: '10.00000001', available: true })
  expect(checkout).not.toHaveProperty('api_key')

  for (const [min, max] of [
    [100, 10],
    [0.00000002, 0.00000001]
  ]) {
    f.setLimits(min, max)
    await expect(f.invoke('checkout-info', owner)).rejects.toMatchObject({ code: 'invalid_response' })
  }

  f.setLimits(100.00000001, 0)
  expect((await f.invoke('checkout-info', owner)).methods[0]).toMatchObject({
    min_amount: '100.00000001',
    max_amount: '0.00000000',
    available: true
  })
  f.setLimits(0.00000001, 0.00000001)
  expect((await f.invoke('checkout-info', owner)).methods[0]).toMatchObject({
    min_amount: '0.00000001',
    max_amount: '0.00000001',
    available: true
  })
  const readsBefore = f.requests.length

  for (const name of ['scope', 'summary', 'checkout-info']) {
    await expect(f.invoke(name, { expected_user_id: '18' })).rejects.toMatchObject({ code: 'platform_account_changed' })
    await expect(f.invoke(name, {})).rejects.toMatchObject({ code: 'invalid_platform_input' })
    await expect(
      f.invoke(name, owner, { ...f.event, senderFrame: { url: 'https://untrusted.test/' } })
    ).rejects.toMatchObject({ code: 'unauthorized_platform_ipc' })
  }

  expect(f.requests).toHaveLength(readsBefore)
  f.ipc.dispose()

  for (const name of ['scope', 'summary', 'checkout-info']) {
    expect(f.handlers.has(`aino:platform-billing:${name}`)).toBe(false)
  }
})

it('projects authoritative owner orders and exact decimal quotes across registered IPC without exposing credentials', async () => {
  const f = await rig()
  expect(await f.invoke('quote')).toEqual(quote)

  const created = await f.invoke('create-order', {
    ...input,
    amount_decimal: '999',
    access_token: 'ignored',
    user_id: 'other'
  })

  expect(created).toMatchObject({
    order_id: '42',
    requested_amount: '20.00000001',
    pay_amount: '20.30',
    credit_amount: '2.85714286',
    fee_amount: '0.30'
  })
  expect(JSON.stringify(created)).not.toContain('must-not-reach-renderer')
  expect(f.requests.find(req => req.path === '/api/v1/payment/orders')?.body).toEqual({
    amount_decimal: input.amount,
    payment_type: 'alipay',
    order_type: 'balance',
    payment_source: 'aino_desktop',
    client_order_id: input.client_order_id,
    expected_quote: quote
  })
  const ref = { expected_user_id: '17', order_id: '42' }

  for (const status of [
    'PENDING',
    'PAID',
    'RECHARGING',
    'COMPLETED',
    'EXPIRED',
    'CANCELLED',
    'FAILED',
    'REFUND_REQUESTED',
    'REFUNDING',
    'REFUND_PENDING',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'REFUND_FAILED'
  ]) {
    f.setOrder({ status })
    const result = await f.invoke('get-order', ref)
    expect(result.status).toBe(status)

    if (status !== 'PENDING') {
      expect(result.checkout).toBeNull()
      expect(result.can_cancel).toBe(false)
    }
  }

  f.setOrder({ requested_amount_decimal: undefined, fee_amount_decimal: undefined })
  expect(await f.invoke('get-order', ref)).toMatchObject({ requested_amount: null, fee_amount: null })
  expect((await f.invoke('list-orders', { ...ref, page: 1, page_size: 20 })).items[0].order_id).toBe('42')
  expect(await f.invoke('cancel-order', ref)).toMatchObject({ status: 'CANCELLED', checkout: null })
  expect(f.requests.slice(-2).map(req => `${req.method} ${req.path}`)).toEqual([
    'POST /api/v1/payment/orders/42/cancel',
    'GET /api/v1/payment/orders/42'
  ])

  for (const patch of [
    { status: 'NEW_UNKNOWN_STATUS' },
    { pay_amount_decimal: 20 },
    { credit_amount_decimal: '1e8' }
  ]) {
    f.setOrder(patch)
    await expect(f.invoke('get-order', ref)).rejects.toMatchObject({ code: 'invalid_response' })
  }

  for (const [name, invalid] of [
    ['quote', { ...input, amount: '1e2' }],
    ['quote', { ...input, payment_type: ['alipay'] }],
    ['create-order', { ...input, client_order_id: 'bad' }],
    ['get-order', { ...ref, order_id: '../1' }],
    ['list-orders', { ...ref, page: 1, page_size: 101 }]
  ] as const) {
    await expect(f.invoke(name, invalid)).rejects.toMatchObject({ code: 'invalid_platform_input' })
  }

  await expect(f.invoke('quote', { ...input, expected_user_id: '18' })).rejects.toMatchObject({
    code: 'platform_account_changed'
  })
  await expect(
    f.invoke('quote', input, { ...f.event, senderFrame: { url: 'https://untrusted.test/' } })
  ).rejects.toMatchObject({ code: 'unauthorized_platform_ipc' })
  f.ipc.dispose()
  expect(f.handlers.has('aino:platform-billing:create-order')).toBe(false)
})

it('never replays create and opens only a fresh usable checkout while its account generation remains current', async () => {
  const f = await rig()
  const ref = { expected_user_id: '17', order_id: '42' }
  await f.invoke('open-checkout', { ...ref, url: 'https://attacker.test/' })
  expect(f.launches).toEqual([order.checkout.pay_url])

  for (const url of [
    'http://pay.example.test/',
    'javascript:alert(1)',
    'file:///tmp/test',
    'weixin://fixture',
    'https://user:pass@pay.example.test/',
    'https://pay.example.test/\nsecret',
    'https:\\pay.example.test/'
  ]) {
    f.setOrder({ checkout: { ...order.checkout, pay_url: url } })
    await expect(f.invoke('open-checkout', ref)).rejects.toBeDefined()
  }

  for (const patch of [
    { status: 'PAID' },
    { status: 'RECHARGING' },
    { confirmation_required: true },
    { payment_unknown: true },
    { expires_at: '2000-01-01T00:00:00Z' },
    { checkout: { ...order.checkout, expires_at: '2000-01-01T00:00:00Z' } },
    { checkout: { ...order.checkout, pay_url: undefined } }
  ]) {
    f.setOrder(patch)
    await expect(f.invoke('open-checkout', ref)).rejects.toMatchObject({ code: 'checkout_unavailable' })
  }

  expect(f.launches).toHaveLength(1)
  f.setOrder({})
  f.setFailure('create401')
  await expect(f.invoke('create-order')).rejects.toMatchObject({ code: 'authentication_refreshed_retry_required' })
  expect(f.requests.filter(req => req.path === '/api/v1/payment/orders')).toHaveLength(1)
  f.setFailure('timeout')
  await expect(f.invoke('create-order')).rejects.toMatchObject({ code: 'network_timeout' })
  expect(f.requests.filter(req => req.path === '/api/v1/payment/orders')).toHaveLength(2)
  f.setFailure('hold')
  const started = f.waitGet()
  const opening = f.invoke('open-checkout', ref)
  const rejection = expect(opening).rejects.toMatchObject({ code: 'auth_attempt_superseded' })
  await started
  await f.auth.logout()
  f.releaseGet()
  await rejection
  expect(f.launches).toHaveLength(1)

  const safe = await rig()
  safe.setFailure('quote401')
  expect(await safe.invoke('quote')).toEqual(quote)
  expect(safe.requests.filter(req => req.path === '/api/v1/payment/quote')).toHaveLength(2)
  const switched = await rig()
  switched.setFailure('quote401')
  switched.setProfileUser(18)
  await expect(switched.invoke('quote')).rejects.toMatchObject({ code: 'platform_account_changed' })
  expect(switched.requests.filter(req => req.path === '/api/v1/payment/quote')).toHaveLength(1)
})

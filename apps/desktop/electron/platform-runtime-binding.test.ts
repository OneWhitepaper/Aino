import http from 'node:http'

import { afterEach, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import type { PlatformModel } from '../shared/platform-contract'

import { createPlatformAuth } from './platform-auth'
import { createPlatformClient } from './platform-client'
import { registerPlatformIpc } from './platform-ipc'
import { createPlatformRuntimeBindingController, openPlatformGateway } from './platform-runtime-binding'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) {
    await stop()
  }

  vi.useRealTimers()
})

const model: PlatformModel = {
  id: 'fixture',
  model: 'upstream-fixture',
  display_name: 'Fixture',
  provider_label: 'Fixture',
  api_mode: 'chat_completions',
  state: 'available',
  reason_code: null,
  is_default: true,
  context_window: 32000,
  max_output_tokens: 4000,
  capabilities: { tools: true, vision: false, reasoning: true },
  billing_source: 'balance',
  pricing: {
    currency: 'USD',
    unit: 'per_million_tokens',
    input: '1.0',
    output: '2.0',
    cache_read: null,
    cache_write: null,
    effective_user_rate: '1',
    detail_available: true,
    tiers: [],
    time_pricing: null,
    group_peak: null
  }
}

async function rig(options: { delayLeaseAt?: number; delayLogout?: boolean; remote?: boolean; allow?: boolean } = {}) {
  const received: Array<Record<string, unknown>> = []
  const credentials: Record<string, unknown>[] = []

  let releaseLease = () => {}

  let releaseLogout = () => {}

  let leaseStarted = () => {}

  let logoutStarted = () => {}

  const leaseReady = new Promise<void>(r => {
    leaseStarted = r
  })

  const logoutReady = new Promise<void>(r => {
    logoutStarted = r
  })

  let claims = 0
  let activeRevision = 0
  let bound: Record<string, unknown> | undefined
  let valid = true
  let secret = 'fixture-inference-secret'

  const server = http.createServer(async (req, res) => {
    const send = (data: unknown) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 0, message: 'ok', data }))
    }

    if (req.url === '/api/v1/auth/logout') {
      if (options.delayLogout) {
        logoutStarted()
        releaseLogout = () => send({ success: true })
      } else {
        send({ success: true })
      }

      return
    }

    if (req.url === '/api/v1/auth/refresh') {
      return send({
        access_token: 'fixture-access',
        refresh_token: 'fixture-refresh',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    }

    if (req.headers.authorization !== 'Bearer fixture-access') {
      res.statusCode = 401

      return send(null)
    }

    if (req.url === '/api/v1/user/profile') {
      return send({ id: 17, username: 'Fixture', email: '', phone_bound: false })
    }

    if (req.url === '/api/v1/desktop/models') {
      return send([model])
    }

    if (req.url === '/api/v1/desktop/credentials') {
      let body = ''

      for await (const chunk of req) {
        body += chunk
      }

      credentials.push(JSON.parse(body))

      const reply = () =>
        send({
          credential_id: 'lease-1',
          api_key: secret,
          base_url: origin + '/v1',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          model
        })

      if (options.delayLeaseAt === credentials.length) {
        releaseLease = reply
        leaseStarted()
      } else {
        reply()
      }

      return
    }

    res.statusCode = 404
    send(null)
  })

  const wss = new WebSocketServer({ server })
  wss.on('connection', (socket, req) => {
    if (req.url !== '/api/ws?token=fixture-gateway') {
      return socket.close(1008)
    }

    socket.on('message', raw => {
      for (const line of raw.toString().trim().split('\n')) {
        const req = JSON.parse(line)
        const p = req.params
        received.push({ method: req.method, ...p })
        const reply = (result: unknown) => socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n')

        const reject = () =>
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: 4403, message: secret } }) + '\n')

        if (req.method === 'session.claim_managed_model') {
          if (p.session_id !== 'owned-session' || p.session_ticket !== 'owned-ticket' || p.owner.user_id !== '17') {
            reject()

            continue
          }

          reply({ managed_model_binding: 1, binding_revision: ++claims })
        } else if (req.method === 'session.bind_managed_model' || req.method === 'session.renew_managed_model') {
          if (p.binding_revision !== claims) {
            reject()

            continue
          }

          activeRevision = p.binding_revision
          bound = p
          reply({ bound: true, model_id: p.model_id, binding_revision: activeRevision })
        } else if (req.method === 'session.clear_managed_model') {
          if (p.binding_revision === activeRevision) {
            bound = undefined
          }

          reply({ cleared: true })
        } else {
          reply({})
        }
      }
    })
    socket.on('close', () => {
      bound = undefined
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  cleanup.push(async () => {
    for (const socket of wss.clients) {
      socket.terminate()
    }

    await new Promise<void>(r => wss.close(() => r()))
    server.closeAllConnections()
    await new Promise<void>(r => server.close(() => r()))
  })
  const client = createPlatformClient({ origin, allowInsecureLoopback: true })

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
      clear: async () => {}
    }
  })

  expect(await auth.initialize()).toMatchObject({ phase: 'signed_in' })

  const controller = createPlatformRuntimeBindingController({
    auth,
    origin,
    deviceId: () => 'fixture-device',
    confirmRemote: async () => options.allow === true,
    resolveConnection: async () => ({
      fingerprint: 'fixture-route',
      host: 'fixture-host',
      remote: options.remote === true,
      profile: 'default',
      isCurrent: () => valid,
      open: () => openPlatformGateway(origin.replace('http:', 'ws:') + '/api/ws?token=fixture-gateway')
    })
  })

  cleanup.push(() => controller.dispose())

  const window = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, mainFrame: { url: 'http://127.0.0.1:5174/' }, send: () => {} }
  }

  const input = {
    connection_id: 'fixture-connection',
    profile: 'default',
    session_id: 'owned-session',
    model_id: 'fixture',
    expected_account_revision: auth.snapshot().revision,
    session_ticket: 'owned-ticket'
  }

  return {
    auth,
    controller,
    window,
    input,
    credentials,
    received,
    leaseReady,
    logoutReady,
    releaseLease: () => releaseLease(),
    releaseLogout: () => releaseLogout(),
    invalidate: () => {
      valid = false
    },
    binding: () => bound,
    secret
  }
}

it('renews on the retained controller socket without a renderer ticket and stops after clear', async () => {
  const f = await rig()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  const first = f.binding()
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await vi.waitFor(() => expect(f.received.some(r => r.method === 'session.renew_managed_model')).toBe(true))
  expect(f.credentials).toHaveLength(2)
  expect(f.credentials[1]).toEqual(f.credentials[0])
  expect(f.binding()).toMatchObject({ binding_revision: first!.binding_revision, owner: first!.owner })
  expect(f.received.filter(r => r.method === 'session.claim_managed_model')).toHaveLength(1)
  f.controller.clear(f.input, f.window)
  await vi.advanceTimersByTimeAsync(60 * 60_000)
  expect(f.credentials).toHaveLength(2)
})

it('uses real auth HTTP and shared WebSocket serialization without exposing the lease in public results', async () => {
  const f = await rig()
  expect(await f.controller.list()).toEqual([model])
  const response = await f.controller.bind(f.input, f.window)
  expect(response).toMatchObject({ ok: true, ready: true, model_id: model.id, billing_source: 'aino' })
  expect(f.credentials[0]).toMatchObject({
    model_id: model.id,
    device_id: 'fixture-device',
    connection_grant_id: expect.any(String)
  })
  expect(f.binding()).toMatchObject({
    session_id: 'owned-session',
    profile: 'default',
    owner: { user_id: '17' },
    model: model.model,
    api_mode: model.api_mode,
    api_key: f.secret
  })
  expect(JSON.stringify([response, f.auth.snapshot()])).not.toContain(f.secret)

  const renewed = await f.controller.bind(
    { ...f.input, expected_account_revision: f.auth.snapshot().revision },
    f.window
  )

  expect(renewed.ok).toBe(true)
  expect(f.credentials[1].connection_grant_id).toBe(f.credentials[0].connection_grant_id)
})

it('does not obtain credentials for an unauthorized remote, wrong session, or stale account', async () => {
  const remote = await rig({ remote: true })
  expect(await remote.controller.bind(remote.input, remote.window)).toMatchObject({
    ok: false,
    error: { code: 'remote_not_authorized' }
  })
  expect(remote.credentials).toHaveLength(0)
  const local = await rig()

  for (const override of [{ session_id: 'foreign' }, { expected_account_revision: -1 }]) {
    const result = await local.controller.bind({ ...local.input, ...override }, local.window)
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(local.secret)
  }

  expect(local.credentials).toHaveLength(0)
})

it.each(['logout', 'clear', 'route'] as const)('rejects a late credential response after %s', async action => {
  const f = await rig({ delayLeaseAt: 1 })
  const pending = f.controller.bind(f.input, f.window)
  await f.leaseReady

  if (action === 'logout') {
    await f.auth.logout()
  }

  if (action === 'clear') {
    f.controller.clear(f.input, f.window)
  }

  if (action === 'route') {
    f.invalidate()
  }

  f.releaseLease()
  expect((await pending).ok).toBe(false)
  expect(f.received.some(r => r.method === 'session.bind_managed_model')).toBe(false)
})

it('revokes active and pending gateway authority before a remote logout resolves', async () => {
  const f = await rig({ delayLeaseAt: 2, delayLogout: true })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  expect(f.binding()).toMatchObject({ session_id: f.input.session_id })

  const pending = f.controller.bind(
    { ...f.input, expected_account_revision: f.auth.snapshot().revision },
    f.window
  )

  await f.leaseReady

  const logout = f.auth.logout()
  await f.logoutReady

  await vi.waitFor(() => expect(f.binding()).toBeUndefined())
  f.releaseLease()
  expect((await pending).ok).toBe(false)
  expect(f.received.filter(r => r.method === 'session.bind_managed_model')).toHaveLength(1)

  f.releaseLogout()
  await expect(logout).resolves.toMatchObject({ phase: 'signed_out' })
})

it('keeps model IPC restricted to the registered main frame and strips extra renderer fields', async () => {
  const f = await rig()
  const handlers = new Map<string, (...args: any[]) => any>()

  const ipc = registerPlatformIpc({
    ipc: {
      handle: (name, handler) => {
        handlers.set(name, handler)
      }
    },
    auth: f.auth,
    captcha: { acquire: async () => ({}) },
    bindingController: f.controller,
    fromWebContents: sender => (sender === f.window.webContents ? f.window : null),
    trustedRendererUrl: f.window.webContents.mainFrame.url
  })

  cleanup.push(() => ipc.dispose())
  ipc.registerWindow(f.window)
  const event = { sender: f.window.webContents, senderFrame: f.window.webContents.mainFrame }
  const invoke = handlers.get('aino:platform-models:bind')!
  expect(await invoke({ ...event, senderFrame: {} }, f.input)).toMatchObject({ ok: false })
  expect(f.credentials).toHaveLength(0)
  const result = await invoke(event, { ...f.input, api_key: 'renderer-fake-key', owner: { user_id: 'foreign' } })
  expect(result.ok).toBe(true)
  expect(f.binding()).toMatchObject({ owner: { user_id: '17' }, api_key: f.secret })
  expect(JSON.stringify(result)).not.toContain(f.secret)
  ipc.unregisterWindow(f.window)
  expect(await invoke(event, f.input)).toMatchObject({ ok: false })
})

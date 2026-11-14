import http from 'node:http'

import { afterEach, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'
import type { PlatformModel } from '../shared/platform-contract'
import { createPlatformRuntimeBindingController } from '../shared/platform-runtime-binding'

import { registerPlatformIpc } from './platform-ipc'
import { openPlatformGateway } from './platform-runtime-binding'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const stop of cleanup.splice(0).reverse()) {
    await stop()
  }

  vi.useRealTimers()
  vi.restoreAllMocks()
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

async function rig(
  options: {
    delayLeaseAt?: number
    delayLogout?: boolean
    remote?: boolean
    allow?: boolean
    legacyGateway?: boolean
    imageGateway?: boolean
    deviceGateway?: boolean
    deviceRevoked?: boolean
    deviceRecentAuthRequired?: boolean
    deviceRolloutDenied?: boolean
    deviceKeyIssuanceDenied?: boolean
    renewalFailures?: Array<{ status: number; code: string; retryAfter?: number }>
  } = {}
) {
  const received: Array<Record<string, unknown>> = []
  const bindingFailures: Array<{ stage: string; code: string }> = []
  const credentials: Record<string, unknown>[] = []
  const deviceRequests: Record<string, unknown>[] = []
  let catalogRequests = 0

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
  const purposeBindings = new Map<string, Record<string, unknown>>()
  const revisions = new Map<string, number>()
  let valid = true
  let secret = 'fixture-inference-secret'

  async function waitForLease(request: number) {
    if (options.delayLeaseAt === request) {
      await new Promise<void>(resolve => {
        releaseLease = resolve
        leaseStarted()
      })
    }
  }

  async function deviceReply(req: http.IncomingMessage, res: http.ServerResponse, send: (value: unknown) => void) {
    if (options.deviceKeyIssuanceDenied) {
      deviceRequests.push({ device_id: 'fixture-device' })
      res.statusCode = 403
      res.end(JSON.stringify({ code: 'DESKTOP_DEVICE_KEY_ROLLOUT_DENIED', message: 'rollout closed' }))

      return
    }

    let body = ''

    for await (const chunk of req) {
      body += chunk
    }

    deviceRequests.push(JSON.parse(body))

    if (options.deviceRevoked || options.deviceRecentAuthRequired) {
      res.statusCode = 403
      res.end(
        JSON.stringify({
          code: options.deviceRecentAuthRequired ? 'RECENT_AUTH_REQUIRED' : 'DESKTOP_DEVICE_KEY_REVOKED',
          message: 'fixture authorization required'
        })
      )

      return
    }

    return send({
      key_id: 'device-key',
      device_id: 'fixture-device',
      version: 1,
      status: 'active',
      expires_at: null,
      api_key: secret
    })
  }

  const deviceCapabilities = options.deviceRolloutDenied ? {} : { managed_device_key: 1 }

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

    if (req.url === '/api/v1/desktop/models?include_images=true') {
      catalogRequests++

      return send([
        model,
        ...(options.deviceGateway && options.imageGateway
          ? [
              {
                ...model,
                id: 'fixture-image',
                purpose: 'image',
                api_mode: 'images_generations',
                capabilities: { tools: false, vision: false, reasoning: false, image_generation: true }
              }
            ]
          : [])
      ])
    }

    if (req.url?.startsWith('/api/v1/desktop/bootstrap')) {
      return send({ capabilities: deviceCapabilities })
    }

    if (req.url === '/api/v1/desktop/device-keys') {
      return deviceReply(req, res, send)
    }

    if (req.url === '/api/v1/desktop/credentials') {
      let body = ''

      for await (const chunk of req) {
        body += chunk
      }

      const credential = JSON.parse(body)
      credentials.push(credential)

      const failure = credentials.length > 1 ? options.renewalFailures?.shift() : undefined

      await waitForLease(credentials.length)

      if (failure) {
        if (failure.status === 0) {
          req.socket.destroy()

          return
        }

        res.statusCode = failure.status
        res.setHeader('content-type', 'application/json')

        if (failure.retryAfter !== undefined) {
          res.setHeader('retry-after', failure.retryAfter)
        }

        res.end(JSON.stringify({ code: failure.code, message: 'fixture failure' }))

        return
      }

      const purpose = credential.purpose === 'image' ? 'image' : 'chat'

      const selectedModel = { ...model, id: String(credential.model_id) }

      const leasedModel =
        purpose === 'image'
          ? {
              ...selectedModel,
              purpose,
              api_mode: 'images_generations',
              capabilities: { tools: false, vision: false, reasoning: false, image_generation: true }
            }
          : selectedModel

      send({
        credential_id: 'lease-1',
        api_key: secret,
        base_url: origin + '/v1',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        model: leasedModel,
        ...(purpose === 'image' ? { purpose } : {})
      })

      return
    }

    res.statusCode = 404
    send(null)
  })

  const wss = new WebSocketServer({ server })
  wss.on('connection', (socket, req) => {
    const socketPurposes = new Set<string>()

    if (req.url !== '/api/ws?token=fixture-gateway') {
      return socket.close(1008)
    }

    socket.on('message', raw => {
      for (const line of raw.toString().trim().split('\n')) {
        const req = JSON.parse(line)
        const p = req.params
        const purpose = p.purpose ?? 'chat'
        received.push({ method: req.method, ...p })
        const reply = (result: unknown) => socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n')

        const reject = () =>
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: 4403, message: secret } }) + '\n')

        if (req.method === 'session.claim_managed_model') {
          if (
            !['owned-session', 'second-session'].includes(p.session_id) ||
            p.session_ticket !== 'owned-ticket' ||
            p.owner.user_id !== '17'
          ) {
            reject()

            continue
          }

          revisions.set(purpose, ++claims)
          socketPurposes.add(purpose)
          reply({
            managed_model_binding: 1,
            binding_revision: claims,
            ...(options.imageGateway ? { managed_image_binding: 1 } : {}),
            ...(options.deviceGateway ? { managed_device_key: 1 } : {}),
            ...(!options.legacyGateway ? { managed_model_context_window: true } : {})
          })
        } else if (req.method === 'session.bind_managed_model' || req.method === 'session.renew_managed_model') {
          if (p.binding_revision !== revisions.get(purpose)) {
            reject()

            continue
          }

          activeRevision = p.binding_revision
          bound = p
          purposeBindings.set(purpose, p)
          reply({ bound: true, model_id: p.model_id, binding_revision: activeRevision })
        } else if (req.method === 'session.clear_managed_model') {
          if (p.binding_revision === purposeBindings.get(purpose)?.binding_revision) {
            bound = undefined
            purposeBindings.delete(purpose)
          }

          reply({ cleared: true })
        } else if (req.method === 'session.managed_model_status') {
          const active = purposeBindings.get(purpose)
          reply({
            reusable:
              active?.binding_revision === p.binding_revision &&
              active?.credential_version === p.credential_version &&
              active?.model_id === p.model_id
          })
        } else {
          reply({})
        }
      }
    })
    socket.on('close', () => {
      bound = undefined

      for (const purpose of socketPurposes) {
        purposeBindings.delete(purpose)
      }
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
    nativeDeviceKeys: true,
    onBindingFailure: failure => bindingFailures.push(failure),
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
    deviceRequests,
    catalogRequests: () => catalogRequests,
    received,
    bindingFailures,
    leaseReady,
    logoutReady,
    releaseLease: () => releaseLease(),
    releaseLogout: () => releaseLogout(),
    invalidate: () => {
      valid = false
    },
    binding: () => bound,
    purposeBinding: (purpose: string) => purposeBindings.get(purpose),
    secret
  }
}

it('reuses one device key across 100 warm calls and windows without a lease or renewal', async () => {
  const f = await rig({ deviceGateway: true })

  for (let i = 0; i < 100; i++) {
    const result = await f.controller.bind(
      { ...f.input, expected_account_revision: f.auth.snapshot().revision },
      i % 2 ? f.window : { isDestroyed: () => false }
    )

    expect(result).toMatchObject({ ok: true, expires_at: null })
    expect(JSON.stringify(result)).not.toContain(f.secret)
  }

  expect(f.deviceRequests).toEqual([{ device_id: 'fixture-device' }])
  expect(f.catalogRequests()).toBe(1)
  expect(f.credentials).toHaveLength(0)
  expect(f.binding()).toMatchObject({ credential_type: 'device', expires_at: null, api_key: f.secret })
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_001)
  expect(
    (
      await f.controller.bind(
        { ...f.input, expected_account_revision: f.auth.snapshot().revision },
        { isDestroyed: () => false }
      )
    ).ok
  ).toBe(true)
  expect(f.catalogRequests()).toBe(2)
  expect(f.deviceRequests).toHaveLength(1)
})

it('never sends a permanent key to remote gateways even when they advertise support', async () => {
  const f = await rig({ deviceGateway: true, remote: true, allow: true })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  expect(f.deviceRequests).toHaveLength(0)
  expect(f.credentials).toHaveLength(1)
  expect(f.binding()!.expires_at).toEqual(expect.any(String))
})

it('uses the same permanent identity for images and chat with no expiry or renewal timer', async () => {
  const f = await rig({ deviceGateway: true, imageGateway: true })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  const image = { ...f.input, model_id: 'fixture-image', purpose: 'image' as const }
  expect((await f.controller.bind(image, f.window)).ok).toBe(true)
  expect(f.purposeBinding('chat')).toMatchObject({ credential_id: 'device-key', api_key: f.secret })
  expect(f.purposeBinding('image')).toMatchObject({
    credential_id: 'device-key',
    api_key: f.secret,
    model_id: 'fixture-image'
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  await vi.advanceTimersByTimeAsync(24 * 3600_000)
  expect(f.purposeBinding('chat')).toBeDefined()
  expect(f.purposeBinding('image')).toBeDefined()
  expect(f.credentials).toHaveLength(0)
  expect(f.deviceRequests).toHaveLength(1)
  expect(f.received.some(row => row.method === 'session.renew_managed_model')).toBe(false)
})

it('does not downgrade a revoked device identity to a lease or automatically replace it', async () => {
  const f = await rig({ deviceGateway: true, deviceRevoked: true })

  for (let i = 0; i < 2; i++) {
    expect(await f.controller.bind(f.input, f.window)).toMatchObject({
      ok: false,
      error: { code: 'DESKTOP_DEVICE_KEY_REVOKED' }
    })
  }

  expect(f.credentials).toHaveLength(0)
  expect(f.deviceRequests).toEqual([{ device_id: 'fixture-device' }])
  expect(f.bindingFailures).toEqual([
    { stage: 'device_key', code: 'DESKTOP_DEVICE_KEY_REVOKED' },
    { stage: 'device_key', code: 'DESKTOP_DEVICE_KEY_REVOKED' }
  ])
  expect(JSON.stringify(f.bindingFailures)).not.toContain(f.secret)
})

it('preserves recent-auth recovery and a credential-free diagnostic without falling back to a lease', async () => {
  const f = await rig({ deviceGateway: true, deviceRecentAuthRequired: true })
  expect(await f.controller.bind(f.input, f.window)).toMatchObject({
    ok: false,
    error: { code: 'RECENT_AUTH_REQUIRED' }
  })
  expect(f.bindingFailures).toEqual([{ stage: 'device_key', code: 'RECENT_AUTH_REQUIRED' }])
  expect(f.credentials).toHaveLength(0)
  expect(f.binding()).toBeUndefined()
  expect(JSON.stringify(f.bindingFailures)).not.toContain(f.secret)
})

it('uses a temporary lease without requesting a device key when Aino-API excludes this device from rollout', async () => {
  const f = await rig({ deviceGateway: true, deviceRolloutDenied: true })

  expect(await f.controller.bind(f.input, f.window)).toMatchObject({ ok: true, expires_at: expect.any(String) })
  expect(f.deviceRequests).toEqual([])
  expect(f.credentials).toHaveLength(1)
  expect(f.binding()).toMatchObject({ credential_id: 'lease-1', expires_at: expect.any(String) })
  expect(f.bindingFailures).toEqual([])

  expect(await f.controller.bind({ ...f.input, session_id: 'second-session' }, f.window)).toMatchObject({ ok: true })
  expect(f.deviceRequests).toHaveLength(0)
  expect(f.credentials).toHaveLength(2)
})

it('falls back to a temporary lease only when stale capability data is rejected by the API rollout gate', async () => {
  const f = await rig({ deviceGateway: true, deviceKeyIssuanceDenied: true })

  expect(await f.auth.supportsDeviceKey('fixture-device')).toBe(true)
  expect(await f.controller.bind(f.input, f.window)).toMatchObject({ ok: true, expires_at: expect.any(String) })
  expect(f.deviceRequests).toEqual([{ device_id: 'fixture-device' }])
  expect(f.credentials).toHaveLength(1)
  expect(f.binding()).toMatchObject({ credential_id: 'lease-1', expires_at: expect.any(String) })

  expect(await f.controller.bind({ ...f.input, session_id: 'second-session' }, f.window)).toMatchObject({ ok: true })
  expect(f.deviceRequests).toHaveLength(1)
  expect(f.credentials).toHaveLength(2)
})

it('reuses a permanent binding only after confirming the live credential version on its socket', async () => {
  const f = await rig({ deviceGateway: true })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  expect((await f.controller.bind({ ...f.input, session_ticket: '' }, f.window)).ok).toBe(true)
  expect(f.received.filter(row => row.method === 'session.managed_model_status')).toHaveLength(1)
  expect(f.received.filter(row => row.method === 'session.claim_managed_model')).toHaveLength(1)
  expect(f.received.filter(row => row.method === 'session.bind_managed_model')).toHaveLength(1)
})

it('requires a fresh ticket before sending any permanent credential when no retained binding exists', async () => {
  const f = await rig({ deviceGateway: true })
  expect(await f.controller.bind({ ...f.input, session_ticket: '' }, f.window)).toMatchObject({
    ok: false,
    error: { code: 'binding_ticket_required' }
  })
  expect(f.deviceRequests).toHaveLength(0)
  expect(f.credentials).toHaveLength(0)
})

it('renews on the retained controller socket without a renderer ticket and stops after clear', async () => {
  const f = await rig()
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  const first = f.binding()
  expect(first).toMatchObject({ context_window: model.context_window })
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await vi.waitFor(() => expect(f.received.some(r => r.method === 'session.renew_managed_model')).toBe(true))
  expect(f.credentials).toHaveLength(2)
  expect(f.credentials[1]).toEqual(f.credentials[0])
  expect(f.binding()).toMatchObject({
    binding_revision: first!.binding_revision,
    owner: first!.owner,
    context_window: model.context_window
  })
  expect(f.received.filter(r => r.method === 'session.claim_managed_model')).toHaveLength(1)
  f.controller.clear(f.input, f.window)
  await vi.advanceTimersByTimeAsync(60 * 60_000)
  expect(f.credentials).toHaveLength(2)
})

it('keeps binding compatible with gateways that do not accept context metadata', async () => {
  const f = await rig({ legacyGateway: true })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  expect(f.binding()).not.toHaveProperty('context_window')
})

it('uses real auth HTTP and shared WebSocket serialization without exposing the lease in public results', async () => {
  const f = await rig()
  expect(await f.controller.list()).toEqual([
    { ...model, purpose: 'chat', capabilities: { ...model.capabilities, image_generation: false } }
  ])
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
  expect(f.credentials).toHaveLength(1)
  expect(f.received.filter(row => row.method === 'session.claim_managed_model')).toHaveLength(2)
  expect(f.received.filter(row => row.method === 'session.bind_managed_model')).toHaveLength(2)
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
    { ...f.input, model_id: 'other', expected_account_revision: f.auth.snapshot().revision },
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

it('keeps image bind, renewal and clear isolated from the retained chat socket', async () => {
  const f = await rig({ imageGateway: true })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  const chat = f.purposeBinding('chat')
  const imageInput = { ...f.input, purpose: 'image' as const }
  const result = await f.controller.bind(imageInput, f.window)
  expect(result).toMatchObject({ ok: true, ready: true })
  expect(f.purposeBinding('chat')).toBe(chat)
  expect(f.purposeBinding('image')).toMatchObject({
    purpose: 'image',
    api_mode: 'images_generations',
    api_key: f.secret
  })
  expect(f.credentials).toHaveLength(2)
  expect(f.credentials[0]).not.toHaveProperty('purpose')
  expect(f.credentials[1]).toMatchObject({ purpose: 'image' })
  expect(JSON.stringify(result)).not.toContain(f.secret)
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await vi.waitFor(() => expect(f.received.filter(row => row.method === 'session.renew_managed_model')).toHaveLength(2))
  expect(
    f.received.filter(row => row.method === 'session.renew_managed_model' && row.purpose === 'image')
  ).toHaveLength(1)
  f.controller.clear(imageInput, f.window)
  await vi.waitFor(() => expect(f.purposeBinding('image')).toBeUndefined())
  expect(f.purposeBinding('chat')).toBeTruthy()
})

it('refuses image binding before obtaining a secret when the gateway lacks its capability', async () => {
  const f = await rig()
  expect(await f.controller.bind({ ...f.input, purpose: 'image' }, f.window)).toMatchObject({
    ok: false,
    error: { code: 'unsupported_gateway' }
  })
  expect(f.credentials).toHaveLength(0)
})

it('whitelists image purpose through existing model IPC and clears only its image socket', async () => {
  const f = await rig({ imageGateway: true })
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
  const bind = handlers.get('aino:platform-models:bind')!
  expect((await bind(event, f.input)).ok).toBe(true)
  const result = await bind(event, { ...f.input, purpose: 'image', api_key: 'renderer-key' })
  expect(result).toMatchObject({ ok: true, ready: true })
  expect(f.purposeBinding('image')).toMatchObject({ purpose: 'image', api_key: f.secret })
  expect(JSON.stringify(result)).not.toContain(f.secret)
  const before = f.credentials.length
  expect(await bind(event, { ...f.input, purpose: 'other' })).toMatchObject({
    ok: false,
    error: { code: 'invalid_platform_input' }
  })
  expect(f.credentials).toHaveLength(before)
  await handlers.get('aino:platform-models:clear')!(event, { ...f.input, purpose: 'image' })
  await vi.waitFor(() => expect(f.purposeBinding('image')).toBeUndefined())
  expect(f.purposeBinding('chat')).toBeTruthy()
})

it('clearing a pending image lease prevents its late bind and leaves chat running', async () => {
  const f = await rig({ imageGateway: true, delayLeaseAt: 2 })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  const chat = f.purposeBinding('chat')
  const imageInput = { ...f.input, purpose: 'image' as const }
  const pending = f.controller.bind(imageInput, f.window)
  await f.leaseReady
  f.controller.clear(imageInput, f.window)
  f.releaseLease()
  expect(await pending).toMatchObject({ ok: false, error: { code: 'binding_cancelled' } })
  expect(f.received.some(row => row.method === 'session.bind_managed_model' && row.purpose === 'image')).toBe(false)
  expect(f.purposeBinding('chat')).toBe(chat)
})

it('logging out revokes both chat and image authority without persisting or returning secrets', async () => {
  const f = await rig({ imageGateway: true })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  expect((await f.controller.bind({ ...f.input, purpose: 'image' }, f.window)).ok).toBe(true)
  await f.auth.logout()
  await vi.waitFor(() => expect([f.purposeBinding('chat'), f.purposeBinding('image')]).toEqual([undefined, undefined]))
  expect(JSON.stringify(f.auth.snapshot())).not.toContain(f.secret)
})

it('reuses a live lease for repeated turns while still claiming each turn and rejecting a bad ticket', async () => {
  const f = await rig()
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)

  for (let turn = 0; turn < 100; turn++) {
    expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  }

  expect(f.credentials).toHaveLength(1)
  expect(f.received.filter(row => row.method === 'session.claim_managed_model')).toHaveLength(101)

  const revisions = f.received
    .filter(row => row.method === 'session.bind_managed_model')
    .map(row => row.binding_revision)

  expect(new Set(revisions).size).toBe(101)
  expect((await f.controller.bind({ ...f.input, session_ticket: 'bad-ticket' }, f.window)).ok).toBe(false)
  expect(f.credentials).toHaveLength(1)
  expect((await f.controller.bind({ ...f.input, model_id: 'other' }, f.window)).ok).toBe(true)
  expect(f.credentials).toHaveLength(2)
})

it('jitter spreads renewal after the reuse threshold and cached turns do not postpone it', async () => {
  const f = await rig()
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  expect(f.credentials).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(11 * 60_000)
  expect(f.credentials).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(60_000)
  await vi.waitFor(() => expect(f.credentials).toHaveLength(2))
  await vi.waitFor(() => expect(f.received.filter(row => row.method === 'session.renew_managed_model')).toHaveLength(1))
})

it('retries transient renewal failures finitely without extending the current deadline', async () => {
  const f = await rig({ renewalFailures: Array.from({ length: 10 }, () => ({ status: 503, code: 'http_503' })) })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await vi.waitFor(() => expect(f.credentials).toHaveLength(2))

  for (const count of [3, 4, 5]) {
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(() => expect(f.credentials).toHaveLength(count))
  }

  expect(f.binding()).toBeTruthy()
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(f.credentials).toHaveLength(5)
  await vi.advanceTimersByTimeAsync(40 * 60_000)
  await vi.waitFor(() => expect(f.binding()).toBeUndefined())
  expect(f.credentials).toHaveLength(5)
})

it.each([
  { request: 2, retry: true },
  { request: 5, retry: false }
])('retains the renewal retry budget across a cached claim during request $request', async ({ request, retry }) => {
  const f = await rig({
    delayLeaseAt: request,
    renewalFailures: Array.from({ length: request - 1 }, () => ({ status: 503, code: 'http_503' }))
  })

  const leases = vi.spyOn(f.auth, 'modelLease')
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await vi.waitFor(() => expect(f.credentials).toHaveLength(2))

  for (let count = 3; count <= request; count++) {
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(() => expect(f.credentials).toHaveLength(count))
  }

  await f.leaseReady
  const pending = leases.mock.results.at(-1)!.value as ReturnType<typeof f.auth.modelLease>
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  const revision = f.binding()!.binding_revision
  f.releaseLease()
  await expect(pending).rejects.toMatchObject({ code: 'http_503' })
  await vi.advanceTimersByTimeAsync(1)
  expect(leases).toHaveBeenCalledTimes(request)

  if (retry) {
    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() =>
      expect(f.received.filter(row => row.method === 'session.renew_managed_model')).toHaveLength(1)
    )
    expect(f.credentials).toHaveLength(3)
    expect(f.binding()!.binding_revision).toBe(revision)
  } else {
    await vi.advanceTimersByTimeAsync(40 * 60_000)
    await vi.waitFor(() => expect(f.binding()).toBeUndefined())
    expect(leases).toHaveBeenCalledTimes(5)
  }
})

it('stops a forbidden renewal without retrying or silently replacing the grant', async () => {
  const f = await rig({ renewalFailures: [{ status: 403, code: 'DESKTOP_CREDENTIAL_REVOKED' }] })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await vi.waitFor(() => expect(f.credentials).toHaveLength(2))
  await vi.waitFor(() => expect(f.binding()).toBeUndefined())
  await vi.advanceTimersByTimeAsync(40 * 60_000)
  expect(f.credentials).toHaveLength(2)
})

it('ignores a late renewal after a cached turn has claimed a newer binding revision', async () => {
  const f = await rig({ delayLeaseAt: 2 })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await f.leaseReady
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  const claimed = f.binding()!.binding_revision
  f.releaseLease()
  await vi.waitFor(() => expect(f.credentials).toHaveLength(2))
  await vi.advanceTimersByTimeAsync(100)
  await vi.waitFor(() => expect(f.received.filter(row => row.method === 'session.renew_managed_model')).toHaveLength(1))
  expect(f.credentials).toHaveLength(3)
  expect(f.binding()!.binding_revision).toBe(claimed)
  expect(
    f.received.filter(row => row.method === 'session.renew_managed_model' && row.binding_revision !== claimed)
  ).toHaveLength(0)
})

it('recovers from one transient renewal failure on the retained scope', async () => {
  const f = await rig({ renewalFailures: [{ status: 503, code: 'http_503' }] })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await vi.waitFor(() => expect(f.credentials).toHaveLength(2))
  await vi.advanceTimersByTimeAsync(5000)
  await vi.waitFor(() => expect(f.received.filter(row => row.method === 'session.renew_managed_model')).toHaveLength(1))
  expect(f.credentials).toHaveLength(3)
  expect(f.credentials[2]).toEqual(f.credentials[0])
  expect(f.binding()).toBeTruthy()
})

it('retains the third retry deadline across a cached turn during backoff', async () => {
  const f = await rig({ renewalFailures: Array.from({ length: 3 }, () => ({ status: 503, code: 'http_503' })) })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await vi.waitFor(() => expect(f.credentials).toHaveLength(2))
  await vi.advanceTimersByTimeAsync(1100)
  await vi.waitFor(() => expect(f.credentials).toHaveLength(3))
  await vi.advanceTimersByTimeAsync(2100)
  await vi.waitFor(() => expect(f.credentials).toHaveLength(4))
  await vi.advanceTimersByTimeAsync(1000)
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(2100)
  expect(f.credentials).toHaveLength(4)
  await vi.advanceTimersByTimeAsync(1100)
  await vi.waitFor(() => expect(f.credentials).toHaveLength(5))
  await vi.waitFor(() => expect(f.received.filter(row => row.method === 'session.renew_managed_model')).toHaveLength(1))
})

it('does not restart a renewal that cannot retry before the existing lease expires', async () => {
  const f = await rig({ renewalFailures: [{ status: 429, code: 'http_429', retryAfter: 3600 }] })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await vi.waitFor(() => expect(f.credentials).toHaveLength(2))
  await vi.advanceTimersByTimeAsync(500)
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(f.credentials).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(40 * 60_000)
  await vi.waitFor(() => expect(f.binding()).toBeUndefined())
})

it('restores the account after a disconnected renewal before allowing the next turn', async () => {
  const f = await rig({ renewalFailures: [{ status: 0, code: 'network_unavailable' }] })
  vi.spyOn(Math, 'random').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  expect((await f.controller.bind(f.input, f.window)).ok).toBe(true)
  await vi.advanceTimersByTimeAsync(20 * 60_000)
  await vi.waitFor(() => expect(f.auth.snapshot().phase).toBe('offline'))
  await vi.advanceTimersByTimeAsync(5000)
  await vi.waitFor(() => expect(f.received.filter(row => row.method === 'session.renew_managed_model')).toHaveLength(1))
  expect(f.auth.snapshot().phase).toBe('signed_in')
  expect(
    (await f.controller.bind({ ...f.input, expected_account_revision: f.auth.snapshot().revision }, f.window)).ok
  ).toBe(true)
  expect(f.credentials).toHaveLength(3)
})

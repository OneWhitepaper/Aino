import http from 'node:http'

import { afterEach, expect, it } from 'vitest'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'
import type { PlatformModel } from '../shared/platform-contract'
import type { PlatformTokenSet } from '../shared/platform-token-contract'

function platformModel(id = 'catalog-a'): PlatformModel {
  return {
    id,
    model: 'wire-model',
    display_name: 'Fixture Model',
    provider_label: 'Fixture',
    api_mode: 'chat_completions',
    state: 'available',
    reason_code: null,
    is_default: true,
    context_window: 10000,
    max_output_tokens: 1000,
    capabilities: { tools: true, vision: false, reasoning: false },
    billing_source: 'balance',
    pricing: {
      currency: 'USD',
      unit: 'million_tokens',
      input: '1.20',
      output: '2.40',
      cache_read: null,
      cache_write: null,
      effective_user_rate: '1',
      detail_available: true,
      tiers: [],
      time_pricing: null,
      group_peak: null
    }
  }
}

const device = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const servers: http.Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

async function rig(
  options: {
    remember?: boolean
    metadataOnly?: boolean
    revoked?: boolean
    rolloutDenied?: boolean
    deviceKeyDenied?: boolean
    delay?: boolean
    delayRotation?: boolean
    warmLogin?: boolean
  } = {}
) {
  let persisted: PlatformTokenSet | null =
    options.remember === false
      ? null
      : {
          accessToken: 'access-17',
          refreshToken: 'refresh-17',
          expiresAt: Date.now() + 3600000
        }

  let release = () => {}

  let started = () => {}

  const ready = new Promise<void>(resolve => {
    started = resolve
  })

  const requests: Array<{ method: string; body: Record<string, unknown>; account: string }> = []
  const bootstrapDevices: Array<string | null> = []
  let version = 1
  let revoked = options.revoked ?? false
  let managementExpired = false
  let recentAuthentication = true
  let mutationFailure: string | null = null

  function deviceResponse(method: string, mutation: boolean) {
    return {
      key_id: 'one-key',
      device_id: device,
      version,
      status: revoked ? 'revoked' : 'active',
      expires_at: null,
      ...(method === 'POST' && (!options.metadataOnly || mutation) ? { api_key: `secret-${version}` } : {})
    }
  }

  function replyDevice(
    req: http.IncomingMessage,
    body: Record<string, unknown>,
    send: (data: unknown, code?: string | number, status?: number) => void
  ) {
    requests.push({ method: req.method!, body, account: req.headers.authorization! })

    if (req.method === 'POST' && (body.rotate || body.reauthorize) && (!recentAuthentication || mutationFailure)) {
      return send(null, mutationFailure ?? 'RECENT_AUTH_REQUIRED', 403)
    }

    if (options.deviceKeyDenied && req.method === 'POST') {
      return send(null, 'DESKTOP_DEVICE_KEY_ROLLOUT_DENIED', 403)
    }

    if (revoked && !body.reauthorize && req.method === 'POST') {
      return send(null, 'DESKTOP_DEVICE_KEY_REVOKED', 403)
    }

    if (body.rotate || body.reauthorize) {
      version++
      revoked = false
    }

    const result = deviceResponse(req.method!, Boolean(body.rotate || body.reauthorize))

    if ((options.delay && requests.length === 1) || (options.delayRotation && version === 2 && req.method === 'POST')) {
      release = () => send(result)
      started()

      return
    }

    return send(result)
  }

  const server = http.createServer(async (req, res) => {
    let raw = ''

    for await (const chunk of req) {
      raw += chunk
    }

    const body = raw ? JSON.parse(raw) : {}

    const send = (data: unknown, code: string | number = 0, status = 200) => {
      res.statusCode = status
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code, message: 'fixture', data }))
    }

    if (req.url === '/api/v1/auth/login') {
      recentAuthentication = true

      return send({
        access_token: `access-${body.email === 'other@example.com' ? 23 : 17}`,
        refresh_token: 'refresh',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    }

    if (req.url === '/api/v1/user/profile') {
      if (managementExpired) {
        return send(null, 'TOKEN_EXPIRED', 401)
      }

      return send({ id: req.headers.authorization?.endsWith('23') ? 23 : 17, username: 'Fixture', email: '' })
    }

    if (req.url === '/api/v1/auth/logout') {
      return send({ success: true })
    }

    if (req.url === '/api/v1/auth/refresh') {
      return send(null, 'TOKEN_EXPIRED', 401)
    }

    if (req.url === '/api/v1/desktop/models?include_images=true') {
      return send([platformModel()])
    }

    const url = new URL(req.url!, 'http://localhost')

    if (url.pathname === '/api/v1/desktop/bootstrap') {
      bootstrapDevices.push(url.searchParams.get('device_id'))

      return send({ capabilities: options.rolloutDenied ? {} : { managed_device_key: 1 } })
    }

    if (req.url?.startsWith('/api/v1/desktop/device-keys')) {
      return replyDevice(req, body, send)
    }

    return send(null, 'NOT_FOUND', 404)
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  const createAuth = () =>
    createPlatformAuth({
      client: createPlatformClient({ origin, allowInsecureLoopback: true }),
      now: Date.now,
      ...(options.warmLogin ? { nativeDeviceId: () => device } : {}),
      tokenStore: {
        load: async () => (persisted ? structuredClone(persisted) : null),
        save: async (_origin, value) => {
          persisted = structuredClone(value)

          return 'encrypted'
        },
        clear: async () => {
          persisted = null
        }
      }
    })

  const auth = createAuth()
  await auth.initialize()

  if (options.remember === false) {
    await auth.loginExisting({ email: 'fixture@example.com', password: 'password', remember: false })
  }

  return {
    auth,
    createAuth,
    requests,
    bootstrapDevices,
    persisted: () => persisted,
    ready,
    release: () => release(),
    revoke: () => {
      revoked = true
    },
    expireRecentAuthentication: () => {
      recentAuthentication = false
    },
    failDeviceMutation: (code: string | null) => {
      mutationFailure = code
    },
    expireManagement: () => {
      managementExpired = true
    }
  }
}

it('prepares and persists the device key during login so the first later conversation needs no recent-login mutation', async () => {
  const f = await rig({ metadataOnly: true, warmLogin: true })
  const loggedIn = await f.auth.loginExisting({ email: 'fixture@example.com', password: 'password', remember: true })
  expect(loggedIn).toMatchObject({ status: 'signed_in', snapshot: { model_identity_ready: true } })
  expect(f.requests.map(request => request.body)).toEqual([
    { device_id: device },
    { device_id: device, rotate: true, expected_version: 1 }
  ])
  f.expireRecentAuthentication()
  const restarted = f.createAuth()
  await restarted.initialize()
  expect(await restarted.ensureDeviceKey(device)).toMatchObject({ version: 2, api_key: 'secret-2' })
  expect(f.requests).toHaveLength(2)
})

it('prepares only the new account key when switching accounts and rejects a late prior-login response', async () => {
  const f = await rig({ metadataOnly: true, warmLogin: true, delay: true })
  const first = f.auth
    .loginExisting({ email: 'fixture@example.com', password: 'password', remember: true })
    .catch(error => error)
  await f.ready
  expect(
    await f.auth.loginExisting({ email: 'other@example.com', password: 'password', remember: true })
  ).toMatchObject({ status: 'signed_in', snapshot: { account: { id: '23' }, model_identity_ready: true } })
  f.release()
  expect(await first).toMatchObject({ code: 'auth_attempt_superseded' })
  expect(f.persisted()?.deviceKeys).toMatchObject([{ user_id: '23', api_key: 'secret-2' }])
  expect(f.requests.slice(1).every(request => request.account === 'Bearer access-23')).toBe(true)
  f.expireRecentAuthentication()
  expect(await f.auth.ensureDeviceKey(device)).toMatchObject({ api_key: 'secret-2' })
  expect(f.requests).toHaveLength(3)
})

it('retains successful account login and a visible key failure, then recovers on a fresh login', async () => {
  const f = await rig({ metadataOnly: true, warmLogin: true })
  f.failDeviceMutation('RECENT_AUTH_REQUIRED')
  expect(
    await f.auth.loginExisting({ email: 'fixture@example.com', password: 'password', remember: true })
  ).toMatchObject({
    status: 'signed_in',
    snapshot: {
      phase: 'signed_in',
      account: { id: '17' },
      model_identity_ready: false,
      error: { code: 'RECENT_AUTH_REQUIRED' }
    }
  })
  expect(f.persisted()?.deviceKeys).toBeUndefined()
  f.failDeviceMutation(null)
  expect(
    await f.auth.loginExisting({ email: 'fixture@example.com', password: 'password', remember: true })
  ).toMatchObject({ status: 'signed_in', snapshot: { model_identity_ready: true, error: null } })
  f.expireRecentAuthentication()
  expect(await f.auth.ensureDeviceKey(device)).toMatchObject({ api_key: 'secret-2' })
  expect(f.requests).toHaveLength(4)
})

it('shares concurrent first acquisition and persists the secret only for remembered accounts', async () => {
  const f = await rig()
  const keys = await Promise.all(Array.from({ length: 10 }, () => f.auth.ensureDeviceKey(device)))
  expect(new Set(keys.map(key => key.api_key))).toEqual(new Set(['secret-1']))
  expect(f.requests).toHaveLength(1)
  expect(f.persisted()?.deviceKeys).toMatchObject([{ user_id: '17', device_id: device, api_key: 'secret-1' }])
  expect(JSON.stringify(f.auth.snapshot())).not.toContain('secret-1')
  const ephemeral = await rig({ remember: false })
  await ephemeral.auth.ensureDeviceKey(device)
  expect(ephemeral.persisted()).toBeNull()
  await ephemeral.auth.logout()
  await expect(ephemeral.auth.ensureDeviceKey(device)).rejects.toMatchObject({ code: 'authentication_required' })
})

it('rotates an active metadata-only identity with its expected version', async () => {
  const f = await rig({ metadataOnly: true })
  expect(await f.auth.ensureDeviceKey(device)).toMatchObject({ key_id: 'one-key', version: 2, api_key: 'secret-2' })
  expect(f.requests.map(request => request.body)).toEqual([
    { device_id: device },
    { device_id: device, rotate: true, expected_version: 1 }
  ])
})

it('requires an explicit reauthorization for a revoked device, retaining the key identity', async () => {
  const f = await rig({ revoked: true })
  await expect(f.auth.ensureDeviceKey(device)).rejects.toMatchObject({ code: 'DESKTOP_DEVICE_KEY_REVOKED' })
  await expect(f.auth.ensureDeviceKey(device)).rejects.toMatchObject({ code: 'DESKTOP_DEVICE_KEY_REVOKED' })
  expect(f.requests).toHaveLength(1)
  expect(await f.auth.ensureDeviceKey(device, true)).toMatchObject({
    key_id: 'one-key',
    version: 2,
    api_key: 'secret-2'
  })
  expect(f.requests.at(-1)?.body).toEqual({ device_id: device, expected_version: 1, reauthorize: true })
})

it('checks device-key capability for the requested installation', async () => {
  const f = await rig()
  const secondDevice = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'

  expect(await f.auth.supportsDeviceKey(device)).toBe(true)
  expect(await f.auth.supportsDeviceKey(device)).toBe(true)
  expect(await f.auth.supportsDeviceKey(secondDevice)).toBe(true)
  expect(f.bootstrapDevices).toEqual([device, secondDevice])
})

it('remembers a device-specific rollout denial and stops attempting permanent-key issuance', async () => {
  const f = await rig({ rolloutDenied: true, deviceKeyDenied: true })

  await expect(f.auth.ensureDeviceKey(device)).rejects.toMatchObject({ code: 'DESKTOP_DEVICE_KEY_ROLLOUT_DENIED' })
  expect(await f.auth.supportsDeviceKey(device)).toBe(false)
  expect(await f.auth.supportsDeviceKey(device)).toBe(false)
  expect(f.requests).toHaveLength(1)
  expect(f.bootstrapDevices).toEqual([])

  await f.auth.loginExisting({ email: 'fixture@example.com', password: 'password', remember: true })
  expect(await f.auth.supportsDeviceKey(device)).toBe(false)
  expect(f.bootstrapDevices).toEqual([device])
})

it.each(['logout', 'account'] as const)(
  'rejects late device secrets after %s and never persists them',
  async intent => {
    const f = await rig({ delay: true })
    const pending = f.auth.ensureDeviceKey(device).catch(error => error)
    await f.ready

    if (intent === 'logout') {
      await f.auth.logout()
    } else {
      await f.auth.loginExisting({ email: 'other@example.com', password: 'password', remember: true })
    }

    f.release()
    expect(await pending).toMatchObject({ code: 'auth_attempt_superseded' })
    expect(f.persisted()?.deviceKeys).toBeUndefined()
    expect(f.auth.snapshot().model_identity_ready).not.toBe(true)
  }
)

it('confirms inference rejection once and never replaces a revoked credential on retry', async () => {
  const f = await rig()
  await f.auth.ensureDeviceKey(device)
  f.revoke()
  await f.auth.rejectDeviceKey(device, 1)
  await f.auth.rejectDeviceKey(device, 1)
  await expect(f.auth.ensureDeviceKey(device)).rejects.toMatchObject({ code: 'DESKTOP_DEVICE_KEY_REVOKED' })
  expect(f.requests.map(request => request.method)).toEqual(['POST', 'GET'])
  expect(f.persisted()?.deviceKeys).toEqual([])
})

it('persists an unknown inference rejection until a new full login', async () => {
  const f = await rig()
  await f.auth.ensureDeviceKey(device)
  await f.auth.rejectDeviceKey(device, 1)
  const restarted = f.createAuth()
  await restarted.initialize()
  await expect(restarted.ensureDeviceKey(device)).rejects.toMatchObject({ code: 'managed_credential_rejected' })
  expect(f.requests.map(request => request.method)).toEqual(['POST', 'GET'])
  await restarted.loginExisting({ email: 'fixture@example.com', password: 'password', remember: true })
  await expect(restarted.ensureDeviceKey(device)).resolves.toMatchObject({ api_key: 'secret-1' })
})

it('advances public authorization version and revision after explicit rotation', async () => {
  const f = await rig()
  await f.auth.ensureDeviceKey(device)
  const previous = f.auth.snapshot()
  const generation = f.auth.generation()
  await f.auth.ensureDeviceKey(device, true)
  expect(f.auth.snapshot().model_identity_version).toBe(2)
  expect(f.auth.snapshot().revision).toBeGreaterThan(previous.revision)
  expect(f.auth.generation()).toBeGreaterThan(generation)
})

it('ignores an old inference rejection while an explicit rotation is waiting for its new secret', async () => {
  const f = await rig({ delayRotation: true })
  await f.auth.ensureDeviceKey(device)
  const rotating = f.auth.ensureDeviceKey(device, true)
  await f.ready
  const coalesced = f.auth.ensureDeviceKey(device, true)
  const normal = f.auth.ensureDeviceKey(device)
  await f.auth.rejectDeviceKey(device, 1)
  f.release()
  expect(await rotating).toMatchObject({ version: 2, api_key: 'secret-2' })
  expect(await coalesced).toMatchObject({ version: 2, api_key: 'secret-2' })
  expect(await normal).toMatchObject({ version: 2, api_key: 'secret-2' })
  await f.auth.rejectDeviceKey(device, 1)
  expect(f.auth.snapshot()).toMatchObject({ model_identity_ready: true, model_identity_version: 2 })
  expect(await f.auth.ensureDeviceKey(device)).toMatchObject({ api_key: 'secret-2' })
})

it('keeps a remembered model identity and catalog after management expiry and app restart', async () => {
  const f = await rig()
  const models = await f.auth.models()
  await f.auth.ensureDeviceKey(device)
  f.expireManagement()
  await f.auth.refresh()
  expect(f.auth.snapshot()).toMatchObject({ phase: 'reauth_required', model_identity_ready: true })
  expect(await f.auth.ensureDeviceKey(device)).toMatchObject({ api_key: 'secret-1' })
  const restarted = f.createAuth()
  await restarted.initialize()
  expect(restarted.snapshot()).toMatchObject({
    phase: 'reauth_required',
    account: { id: '17' },
    model_identity_ready: true
  })
  expect(await restarted.ensureDeviceKey(device)).toMatchObject({ api_key: 'secret-1' })
  expect(await restarted.models()).toEqual(models)
  expect(await restarted.supportsDeviceKey(device)).toBe(true)
  expect(f.requests).toHaveLength(1)
})

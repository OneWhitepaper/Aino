import http from 'node:http'

import { afterEach, expect, it, vi } from 'vitest'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'
import type { PlatformDeviceInfo } from '../shared/platform-contract'
import { parsePlatformDeviceInfo } from '../shared/platform-device-contract'
import type { PlatformTokenSet } from '../shared/platform-token-contract'

import { nativePlatformDeviceInfo } from './platform-native-auth'

const deviceId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const otherId = '11111111-2222-3333-4444-555555555555'

const info: PlatformDeviceInfo = {
  installation_name: 'Aino',
  os: 'macos',
  client_type: 'desktop_dev',
  client_version: '0.23.0'
}

const row = { device_id: deviceId, last_used_at: '2026-11-10T00:00:00Z', expires_at: null, revoked: false }
const servers: http.Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

async function rig(restored = false, nativeInfo: () => PlatformDeviceInfo | Promise<PlatformDeviceInfo> = () => info) {
  let metadataStatus = 200
  let holdMetadata = false

  let releaseMetadata = () => {}

  let saved: PlatformTokenSet | null = restored
    ? {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600_000
      }
    : null

  const seen: Array<{ method: string; path: string; body: unknown; authorization?: string }> = []

  const server = http.createServer(async (req, res) => {
    let raw = ''

    for await (const chunk of req) {
      raw += chunk
    }

    const body = raw ? JSON.parse(raw) : undefined
    const path = req.url || ''
    seen.push({ method: req.method!, path, body, authorization: req.headers.authorization })

    const reply = (data: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: status === 200 ? 0 : 1, message: 'fixture', data }))
    }

    if (path === '/api/v1/user/profile') {
      return reply({
        id: req.headers.authorization === 'Bearer access-other' ? 23 : 17,
        username: 'fixture',
        email: ''
      })
    }

    if (path === '/api/v1/auth/login') {
      return reply({
        access_token: body.email === 'other@example.com' ? 'access-other' : 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    }

    if (path === '/api/v1/auth/logout') {
      return reply({})
    }

    if (path.startsWith('/api/v1/desktop/bootstrap')) {
      return reply({ capabilities: { managed_device_key: 1 } })
    }

    if (path === '/api/v1/desktop/device-keys') {
      return reply({
        key_id: 'same-key',
        device_id: deviceId,
        version: 1,
        status: 'active',
        expires_at: null,
        api_key: 'secret'
      })
    }

    if (path === `/api/v1/desktop/devices/${deviceId}/info`) {
      if (metadataStatus === 0) {
        req.socket.destroy()

        return
      }

      const send = () => reply({ ...info, api_key: 'must-not-cross' }, metadataStatus)

      if (holdMetadata) {
        releaseMetadata = send

        return
      }

      return send()
    }

    if (path === '/api/v1/desktop/devices') {
      return reply([
        { ...row, is_current: false, credential_type: 'device' },
        {
          ...row,
          device_id: otherId,
          is_current: true,
          credential_type: 'lease',
          device_info: { ...info, installation_name: 'Other Aino', client_type: 'desktop' }
        }
      ])
    }

    return reply(null, 404)
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const client = createPlatformClient({ origin, allowInsecureLoopback: true, timeoutMs: 2000 })
  const updates = vi.spyOn(client, 'updateDeviceInfo')

  const createAuth = () =>
    createPlatformAuth({
      client,
      now: Date.now,
      nativeDeviceId: () => deviceId,
      nativeDeviceInfo: nativeInfo,
      tokenStore: {
        load: async () => (saved ? structuredClone(saved) : null),
        save: async (_origin, value) => {
          saved = structuredClone(value)

          return 'encrypted'
        },
        clear: async () => {
          saved = null
        }
      }
    })

  const auth = createAuth()

  const owner = () => ({
    expected_user_id: auth.snapshot().account?.id || '17',
    expected_generation: auth.generation()
  })

  const metadata = () => seen.filter(request => request.path.endsWith('/info'))

  return {
    auth,
    client,
    createAuth,
    seen,
    owner,
    metadata,
    settleMetadata: async () => {
      await Promise.all(updates.mock.results.map(result => Promise.resolve(result.value).catch(() => undefined)))
      await Promise.resolve()
    },
    status: (value: number) => {
      metadataStatus = value
    },
    hold: () => {
      holdMetadata = true
    },
    release: () => releaseMetadata()
  }
}

it('sends only validated non-secret metadata to the JWT info endpoint and strips server current claims', async () => {
  const f = await rig()
  expect(
    await f.client.updateDeviceInfo('access', deviceId, {
      ...info,
      hostname: 'private',
      api_key: 'private'
    } as PlatformDeviceInfo)
  ).toEqual(info)
  expect(f.metadata()).toEqual([
    { method: 'PUT', path: `/api/v1/desktop/devices/${deviceId}/info`, body: info, authorization: 'Bearer access' }
  ])
  const rows = await f.client.listDevices('access')
  expect(rows[1]).toMatchObject({
    credential_type: 'lease',
    device_info: { installation_name: 'Other Aino', client_type: 'desktop' }
  })
  expect(rows.every(device => !Object.hasOwn(device, 'is_current'))).toBe(true)
})

it('registers login metadata once, coalesces concurrent list requests and reuses the same model key', async () => {
  const f = await rig()
  await f.auth.initialize()
  f.hold()
  await f.auth.loginExisting({ email: 'fixture@example.com', password: 'fixture', remember: true })
  await vi.waitFor(() => expect(f.metadata()).toHaveLength(1))
  const reads = Array.from({ length: 5 }, () => f.auth.listDevices(f.owner()))
  const rows = (await Promise.all(reads))[0]
  f.release()
  await f.settleMetadata()
  await f.auth.listDevices(f.owner())
  expect(f.metadata()).toHaveLength(1)
  expect(rows[0]).toMatchObject({ is_current: true, device_info: info, credential_type: 'device' })
  expect(rows[1]).toMatchObject({
    is_current: false,
    device_info: { installation_name: 'Other Aino', client_type: 'desktop' }
  })
  expect(await f.auth.ensureDeviceKey(deviceId)).toMatchObject({ key_id: 'same-key', api_key: 'secret' })
  expect(f.seen.filter(request => request.path === '/api/v1/desktop/device-keys')).toHaveLength(1)
})

it.each([0, 401, 403, 404, 405, 500])(
  'metadata failure %i preserves model credentials and retries when devices are viewed',
  async status => {
    const f = await rig()
    await f.auth.initialize()
    f.status(status)
    await f.auth.loginExisting({ email: 'fixture@example.com', password: 'fixture', remember: true })
    await vi.waitFor(() => expect(f.metadata()).toHaveLength(1))
    expect(f.auth.snapshot()).toMatchObject({ phase: 'signed_in', model_identity_ready: true, error: null })
    expect(await f.auth.ensureDeviceKey(deviceId)).toMatchObject({ key_id: 'same-key' })
    await f.settleMetadata()
    const failedAttempts = f.metadata().length
    f.status(200)
    const rows = await f.auth.listDevices(f.owner())
    await vi.waitFor(() => expect(f.metadata()).toHaveLength(failedAttempts + 1))
    expect(rows[0]).toMatchObject({ is_current: true, device_info: info })
    expect(f.seen.filter(request => request.path === '/api/v1/desktop/device-keys')).toHaveLength(1)
  }
)

it('backfills metadata on restored login without creating or rotating a key', async () => {
  const f = await rig(true)
  await f.auth.initialize()
  await vi.waitFor(() => expect(f.metadata()).toHaveLength(1))
  expect(f.seen.some(request => request.path === '/api/v1/desktop/device-keys')).toBe(false)
  expect((await f.auth.listDevices(f.owner()))[0]).toMatchObject({ is_current: true, device_info: info })
})

it('updates a computer display name without creating another device authorization', async () => {
  let computerName = '仔仔木头'
  const f = await rig(false, () => ({ ...info, installation_name: computerName }))
  await f.auth.initialize()
  await f.auth.loginExisting({ email: 'fixture@example.com', password: 'fixture', remember: true })
  await f.settleMetadata()
  expect(f.metadata()[0].body).toMatchObject({ installation_name: '仔仔木头' })
  expect(await f.auth.ensureDeviceKey(deviceId)).toMatchObject({ key_id: 'same-key' })

  computerName = '工作用 Mac'
  await f.auth.listDevices(f.owner())
  await vi.waitFor(() => expect(f.metadata()).toHaveLength(2))
  expect(f.metadata()[1]).toMatchObject({
    path: `/api/v1/desktop/devices/${deviceId}/info`,
    body: { installation_name: '工作用 Mac' }
  })
  expect(await f.auth.ensureDeviceKey(deviceId)).toMatchObject({ key_id: 'same-key' })
  expect(f.seen.filter(request => request.path === '/api/v1/desktop/device-keys')).toHaveLength(1)
})

it('returns current device rows before a cold native version probe resolves', async () => {
  let release!: (value: PlatformDeviceInfo) => void

  const pending = new Promise<PlatformDeviceInfo>(resolve => {
    release = resolve
  })

  const f = await rig(true, () => pending)
  await f.auth.initialize()
  let completed = false

  const read = f.auth.listDevices(f.owner()).then(rows => {
    completed = true

    return rows
  })

  try {
    await vi.waitFor(() => expect(completed).toBe(true))
    const rows = await read
    expect(rows[0]).toMatchObject({ device_id: deviceId, is_current: true })
    expect(rows[0].device_info).toBeUndefined()
    expect(rows[1]).toMatchObject({ is_current: false, device_info: { installation_name: 'Other Aino' } })
    expect(f.metadata()).toEqual([])
  } finally {
    release(info)
  }

  await vi.waitFor(() => expect(f.metadata()).toHaveLength(1))
  expect((await f.auth.listDevices(f.owner()))[0]).toMatchObject({ is_current: true, device_info: info })
  expect(f.seen.some(request => request.path === '/api/v1/desktop/device-keys')).toBe(false)
})

it('does not send a retired account metadata intent when a native probe resolves after account switching', async () => {
  let release!: (value: PlatformDeviceInfo) => void

  const pending = new Promise<PlatformDeviceInfo>(resolve => {
    release = resolve
  })

  const f = await rig(true, () => pending)
  await f.auth.initialize()
  await f.auth.logout()
  await f.auth.loginExisting({ email: 'other@example.com', password: 'fixture', remember: true })
  release(info)
  await vi.waitFor(() => expect(f.metadata()).toHaveLength(1))
  await f.settleMetadata()

  expect(f.metadata()[0].authorization).toBe('Bearer access-other')
  expect(f.auth.snapshot()).toMatchObject({ account: { id: '23' }, phase: 'signed_in', model_identity_ready: true })
  expect((await f.auth.listDevices(f.owner()))[0]).toMatchObject({ is_current: true, device_info: info })
  expect(f.metadata()).toHaveLength(1)
})

it.each([
  ['darwin', true, 'macos', 'desktop'],
  ['win32', false, 'windows', 'desktop_dev'],
  ['linux', true, 'linux', 'desktop']
] as const)(
  'describes %s using the computer name without changing installation identity',
  (platform, packaged, os, clientType) => {
    expect(nativePlatformDeviceInfo(platform, packaged, '0.23.0', '仔仔木头')).toEqual({
      installation_name: '仔仔木头',
      os,
      client_type: clientType,
      client_version: '0.23.0'
    })
  }
)

it.each([
  { ...info, installation_name: 'x'.repeat(81) },
  { ...info, installation_name: `${' '.repeat(80)}A` },
  { ...info, client_version: 'x'.repeat(65) },
  { ...info, installation_name: 'Aino\n' },
  { ...info, installation_name: 'Aino\u202e' },
  { ...info, client_version: '0.23.0\u0000' },
  { ...info, client_version: '\u200b' },
  { ...info, installation_name: '   ' },
  { ...info, os: 'unknown' },
  { ...info, client_type: 'official' }
])('rejects invalid device metadata before sending a request', async invalid => {
  const f = await rig()
  await expect(f.client.updateDeviceInfo('access', deviceId, invalid as PlatformDeviceInfo)).rejects.toMatchObject({
    code: 'invalid_platform_input'
  })
  expect(f.metadata()).toEqual([])
})

it('counts Unicode code points rather than UTF-16 units at metadata limits', () => {
  const unicode = { ...info, installation_name: '😀'.repeat(80), client_version: '😊'.repeat(64) }

  expect(parsePlatformDeviceInfo(unicode)).toEqual(unicode)
})

it('normalizes edge whitespace while preserving ordinary spaces inside metadata', () => {
  expect(parsePlatformDeviceInfo({ ...info, installation_name: '\u3000Aino Dev\u00a0' })).toEqual({
    ...info,
    installation_name: 'Aino Dev'
  })
})

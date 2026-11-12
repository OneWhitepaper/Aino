import http from 'node:http'

import { afterEach, expect, it } from 'vitest'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'
import { unwrapPlatformAccountIpc } from '../shared/platform-contract'
import type { PlatformRuntimeBindingController } from '../shared/platform-runtime-binding'

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

const id = '67c7ac16-8bac-46c3-a3a8-ae8c11b390ad'
const other = '4d02cc8f-53cd-40ec-9669-d7f33b8b9e18'

const device = {
  device_id: id,
  last_used_at: '2026-09-16T01:00:00Z',
  expires_at: '2099-09-16T02:00:00Z',
  revoked: false
}

async function rig() {
  const requests: string[] = []
  let mode = ''
  let released: (() => void) | undefined
  let started: (() => void) | undefined
  let cleared = 0
  let profileId = 17

  const server = http.createServer((req, res) => {
    const path = req.url || ''
    requests.push(`${req.method} ${path}`)

    const reply = (data: unknown, status = 200, reason?: string) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ code: status === 200 ? 0 : 1, message: 'fixture', data, reason }))
    }

    if (path === '/api/v1/user/profile') {
      reply({ id: profileId, username: 'fixture', email: '' })

      return
    }

    if (path === '/api/v1/auth/refresh') {
      reply({
        access_token: 'refreshed-fixture',
        refresh_token: 'refreshed-fixture',
        expires_in: 3600,
        token_type: 'Bearer'
      })

      return
    }

    if (path === '/api/v1/auth/logout') {
      reply({})

      return
    }

    expect(req.headers.authorization).toMatch(/^Bearer (fixture|refreshed-fixture)$/)

    if (mode === '401') {
      reply({}, 401)

      return
    }

    if (mode === 'timeout') {
      return
    }

    if (mode === 'stepup') {
      reply({}, 403, 'STEP_UP_REQUIRED')

      return
    }

    if (mode === 'hold') {
      released = () => reply([device])
      started?.()

      return
    }

    if (req.method === 'DELETE') {
      reply({ revoked: true, api_key: 'secret-fixture' })

      return
    }

    reply([
      {
        ...device,
        ...(mode === 'malformed' ? { revoked: 'false' } : {}),
        ...(mode.startsWith('status-') ? { status: mode.slice('status-'.length) } : {}),
        api_key: 'secret-fixture',
        is_current: false,
        user: { id: 17 }
      }
    ])
  })

  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const client = createPlatformClient({ origin, allowInsecureLoopback: true, timeoutMs: 2000 })

  const auth = createPlatformAuth({
    client,
    now: Date.now,
    tokenStore: {
      load: async () => ({ accessToken: 'fixture', refreshToken: 'fixture', expiresAt: Date.now() + 3600_000 }),
      save: async () => 'session_only',
      clear: async () => undefined
    }
  })

  await auth.initialize()
  const handlers = new Map<string, (...args: any[]) => any>()
  const frame = { url: 'http://localhost:5174/' }
  const sender = { mainFrame: frame }
  const win = { isDestroyed: () => false, webContents: { ...sender, isDestroyed: () => false, send: () => {} } }

  const ipc = registerPlatformIpc({
    ipc: {
      handle: (name, fn) => {
        handlers.set(name, fn)
      },
      removeHandler: name => {
        handlers.delete(name)
      }
    },
    auth,
    captcha: { acquire: async () => ({}) },
    fromWebContents: value => (value === sender ? win : null),
    trustedRendererUrl: frame.url,
    currentDeviceId: () => id,
    bindingController: {
      invalidateConnections: () => {
        cleared++
      },
      dispose: () => {}
    } as PlatformRuntimeBindingController
  })

  ipc.registerWindow(win)
  const owner = { expected_user_id: '17', expected_generation: auth.generation() }
  const event = { sender, senderFrame: frame }

  return {
    auth,
    requests,
    owner,
    ipc,
    handlers,
    event,
    cleared: () => cleared,
    mode: (value: string) => {
      mode = value
    },
    profile: (value: number) => {
      profileId = value
    },
    started: () =>
      new Promise<void>(resolve => {
        started = resolve
      }),
    release: () => released?.(),
    invoke: async (name: string, input: unknown = owner, source = event) => {
      const handler = handlers.get(`aino:platform-devices:${name}`)
      expect(handler, `device capability ${name}`).toBeTypeOf('function')

      return unwrapPlatformAccountIpc(await handler!(source, input))
    }
  }
}

it('projects only safe device summaries and fences every operation to the trusted current owner and generation', async () => {
  const f = await rig()
  expect(await f.invoke('list')).toEqual([{ ...device, is_current: true }])
  const count = f.requests.length

  for (const method of ['list', 'revoke']) {
    await expect(f.invoke(method, { ...f.owner, device_id: id, expected_user_id: '18' })).rejects.toMatchObject({
      code: 'platform_account_changed'
    })
    await expect(f.invoke(method, { ...f.owner, device_id: id, expected_generation: -1 })).rejects.toMatchObject({
      code: 'platform_account_changed'
    })
    await expect(
      f.invoke(method, { ...f.owner, device_id: id }, { ...f.event, senderFrame: { url: 'https://other.test/' } })
    ).rejects.toMatchObject({ code: 'unauthorized_platform_ipc' })
  }

  await expect(f.invoke('revoke', { ...f.owner, device_id: '../credentials' })).rejects.toMatchObject({
    code: 'invalid_platform_input'
  })
  expect(f.requests).toHaveLength(count)
  const stepUp = f.handlers.get('aino:platform-account:submit-step-up')!

  for (const owner of [
    { ...f.owner, expected_user_id: '18' },
    { ...f.owner, expected_generation: f.owner.expected_generation + 1 }
  ]) {
    const result = await stepUp(f.event, { ...owner, totp_code: '123456' })
    expect(result).toMatchObject({ ok: false, error: { code: 'platform_account_changed' } })
  }

  expect(f.requests).toHaveLength(count)
  f.mode('malformed')
  await expect(f.invoke('list')).rejects.toMatchObject({ code: 'invalid_response' })
  f.mode('hold')
  const started = f.started()
  const pending = expect(f.invoke('list')).rejects.toMatchObject({ code: 'auth_attempt_superseded' })
  await started
  await f.auth.logout()
  f.release()
  await pending
  f.ipc.dispose()
  expect(f.handlers.has('aino:platform-devices:list')).toBe(false)
})

it('preserves explicit device status across the API and IPC boundary while rejecting unknown states', async () => {
  const f = await rig()

  for (const status of ['active', 'expired', 'revoked']) {
    f.mode(`status-${status}`)
    expect(await f.invoke('list')).toEqual([{ ...device, status, is_current: true }])
  }

  f.mode('status-unknown')
  await expect(f.invoke('list')).rejects.toMatchObject({ code: 'invalid_response' })
  f.ipc.dispose()
})

it('never replays revoke after auth or timeout, preserves step-up failures, and clears runtime only for successful self-revoke', async () => {
  const f = await rig()
  f.mode('stepup')
  await expect(f.invoke('revoke', { ...f.owner, device_id: id })).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' })
  f.mode('401')
  await expect(f.invoke('revoke', { ...f.owner, device_id: id })).rejects.toMatchObject({
    code: 'authentication_refreshed_retry_required'
  })
  f.mode('timeout')
  await expect(f.invoke('revoke', { ...f.owner, device_id: id })).rejects.toMatchObject({ code: 'network_timeout' })
  expect(f.requests.filter(row => row.startsWith('DELETE '))).toHaveLength(3)
  expect(f.cleared()).toBe(0)
  f.mode('')
  expect(await f.invoke('revoke', { ...f.owner, device_id: other })).toEqual({ revoked: true })
  expect(f.cleared()).toBe(0)
  expect(await f.invoke('revoke', { ...f.owner, device_id: id })).toEqual({ revoked: true })
  expect(f.cleared()).toBe(1)
  f.ipc.dispose()
})

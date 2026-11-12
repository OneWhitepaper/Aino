import { EventEmitter } from 'node:events'
import http from 'node:http'

import { expect, test, vi } from 'vitest'

import { createPlatformAuth } from '../shared/platform-auth'
import { createPlatformClient } from '../shared/platform-client'

import { createAccountWorkspaceIpc } from './account-workspace'
import { registerPlatformIpc } from './platform-ipc'

const disabled = {
  state: 'disabled',
  pending: 0,
  error: null,
  revision: 0,
  changed_session_ids: [],
  changed_profile_ids: []
}

test('disabled legacy sync capabilities remain denied to a retired account window', async () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const native = Object.assign(new EventEmitter(), {
    handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler)
  })
  let allowed = true
  const fenced = createAccountWorkspaceIpc(
    native,
    () => allowed,
    () => true
  )
  const sender = { id: 1, mainFrame: { url: 'https://desktop.invalid/' } }
  const event = { sender, senderFrame: sender.mainFrame }
  const win = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, mainFrame: sender.mainFrame, send: vi.fn() }
  }
  const controller = registerPlatformIpc({
    ipc: fenced.ipc,
    auth: { subscribe: () => () => {} } as any,
    captcha: { acquire: vi.fn() },
    fromWebContents: () => win,
    trustedRendererUrl: sender.mainFrame.url
  })

  controller.registerWindow(win)
  expect(await handlers.get('aino:platform-sync:status')!(event)).toEqual({ ok: true, value: disabled })
  expect(await handlers.get('aino:platform-sync:retry')!(event)).toEqual({ ok: true, value: disabled })
  allowed = false
  expect(() => handlers.get('aino:platform-sync:status')!(event)).toThrow('account_workspace_unavailable')
  expect(() => handlers.get('aino:platform-sync:retry')!(event)).toThrow('account_workspace_unavailable')
  controller.dispose()
})

test('legacy sync status and repeated retries never request cloud data for a signed-in account', async () => {
  const requests: string[] = []
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ code: 0, message: 'fixture', data: { id: 17, username: 'fixture', email: '' } }))
  })

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const auth = createPlatformAuth({
    client: createPlatformClient({ origin, allowInsecureLoopback: true }),
    now: Date.now,
    tokenStore: {
      load: async () => ({ accessToken: 'fixture', refreshToken: 'fixture', expiresAt: Date.now() + 3_600_000 }),
      save: async () => 'session_only',
      clear: async () => {}
    }
  })
  const handlers = new Map<string, (...args: any[]) => any>()
  const sender = { mainFrame: { url: 'https://desktop.invalid/' } }
  const win = {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, mainFrame: sender.mainFrame, send: vi.fn() }
  }
  const controller = registerPlatformIpc({
    ipc: {
      handle: (name, handler) => {
        handlers.set(name, handler)
      }
    },
    auth,
    captcha: { acquire: vi.fn() },
    fromWebContents: () => win,
    trustedRendererUrl: sender.mainFrame.url
  })

  try {
    await auth.initialize()
    controller.registerWindow(win)
    expect(auth.snapshot().phase).toBe('signed_in')

    for (const name of ['status', 'retry', 'retry', 'status']) {
      expect(await handlers.get(`aino:platform-sync:${name}`)!({ sender, senderFrame: sender.mainFrame })).toEqual({
        ok: true,
        value: disabled
      })
    }

    expect(requests).toEqual(['GET /api/v1/user/profile'])
    expect(win.webContents.send.mock.calls.some(([name]) => name === 'aino:platform-sync:changed')).toBe(false)
  } finally {
    controller.dispose()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

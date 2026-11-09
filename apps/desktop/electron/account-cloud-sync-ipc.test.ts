import { EventEmitter } from 'node:events'

import { expect, test, vi } from 'vitest'

import { createAccountWorkspaceIpc } from './account-workspace'
import { registerPlatformIpc } from './platform-ipc'

test('sync status and retry are account data capabilities denied to a retired account window', async () => {
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
  const snapshot = {
    state: 'synced',
    pending: 0,
    error: null,
    revision: 1,
    changed_session_ids: ['private-A'],
    changed_profile_ids: []
  } as const
  const sync = { snapshot: vi.fn(() => snapshot), retry: vi.fn(async () => snapshot), subscribe: () => () => {} }

  const controller = registerPlatformIpc({
    ipc: fenced.ipc,
    auth: { subscribe: () => () => {} } as any,
    captcha: { acquire: vi.fn() },
    fromWebContents: () => win,
    trustedRendererUrl: sender.mainFrame.url,
    cloudSync: sync as any
  })

  controller.registerWindow(win)
  expect(await handlers.get('aino:platform-sync:status')!(event)).toMatchObject({ ok: true, value: snapshot })
  allowed = false
  expect(() => handlers.get('aino:platform-sync:status')!(event)).toThrow('account_workspace_unavailable')
  expect(() => handlers.get('aino:platform-sync:retry')!(event)).toThrow('account_workspace_unavailable')
  expect(sync.retry).not.toHaveBeenCalled()
  controller.dispose()
})

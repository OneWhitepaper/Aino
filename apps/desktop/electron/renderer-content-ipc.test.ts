import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { BrowserWindow } from 'electron'
import { afterEach, expect, test, vi } from 'vitest'

const native = vi.hoisted(() => ({
  clipboard: { read: vi.fn(), readText: vi.fn(), writeText: vi.fn() },
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  fromId: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  clipboard: native.clipboard,
  dialog: { showOpenDialog: native.showOpenDialog, showSaveDialog: native.showSaveDialog },
  webContents: { fromId: native.fromId }
}))

import { createAccountWorkspaceIpc } from './account-workspace'
import { registerRendererContentIpc } from './renderer-content-ipc'

class NativeIpc extends EventEmitter {
  handlers = new Map<string, (...args: any[]) => unknown>()

  handle(channel: string, listener: (...args: any[]) => unknown) {
    this.handlers.set(channel, listener)
  }

  invoke(channel: string, sender: object, ...args: unknown[]) {
    return this.handlers.get(channel)!({ sender }, ...args)
  }
}

const scratch: string[] = []

afterEach(() => {
  for (const root of scratch.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }

  vi.resetAllMocks()
})

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-renderer-content-'))
  scratch.push(root)
  const ipc = new NativeIpc()
  let account = 1

  const fence = createAccountWorkspaceIpc(
    ipc,
    id => id === account,
    () => true
  )

  const window = {} as BrowserWindow
  const points = new Map([[1, { x: 17, y: 29 }]])

  registerRendererContentIpc(fence.ipc, {
    getMainWindow: () => window,
    getHermesHome: () => path.join(root, String(account), 'home'),
    getAccountUiRoot: () => path.join(root, String(account), 'ui'),
    getLastContextMenuPoint: id => points.get(id),
    saveGatewayFile: vi.fn(),
    resolveHermesCwd: () => root,
    fileExists: fs.existsSync,
    directoryExists: () => false,
    isWindows: false,
    isWsl: false
  })

  return { root, ipc, fence, window, changeAccount: (id: number) => (account = id) }
}

test('content IPC preserves account fencing and reads current account paths after a switch', async () => {
  const { root, ipc, changeAccount } = setup()
  const image = Buffer.from('image bytes')
  const first = (await ipc.invoke('hermes:saveImageBuffer', { id: 1 }, { data: image })) as string
  expect(path.dirname(first)).toBe(path.join(root, '1/ui/composer-images'))
  expect(fs.readFileSync(first)).toEqual(image)

  changeAccount(2)
  expect(() => ipc.invoke('hermes:saveImageBuffer', { id: 1 }, { data: image })).toThrow(
    'account_workspace_unavailable'
  )
  const second = (await ipc.invoke('hermes:saveImageBuffer', { id: 2 }, { data: image })) as string
  const paste = (await ipc.invoke('hermes:savePastedText', { id: 2 }, { text: 'second account draft' })) as string
  expect(path.dirname(second)).toBe(path.join(root, '2/ui/composer-images'))
  expect(path.dirname(paste)).toBe(path.join(root, '2/home/composer-pastes'))
  expect(fs.readFileSync(paste, 'utf8')).toBe('second account draft')
  expect(fs.existsSync(path.join(root, '1/home/composer-pastes'))).toBe(false)
})

test('async clipboard work remains drainable and context-menu commands stay with their sender', async () => {
  const { root, ipc, fence, window } = setup()
  let release!: (items: unknown[]) => void
  native.clipboard.read.mockReturnValue(new Promise(resolve => (release = resolve)))
  const sender = { id: 1, copy: vi.fn(), copyImageAt: vi.fn() }
  const pending = ipc.invoke('hermes:saveClipboardImage', sender)
  const drained = vi.fn()
  const drain = fence.drain().then(drained)
  await Promise.resolve()
  expect(drained).not.toHaveBeenCalled()
  const bytes = Buffer.from('clipboard image')
  release([{ types: ['image/png'], getType: async () => ({ arrayBuffer: async () => bytes }) }])
  const saved = (await pending) as string
  await drain
  expect(fs.readFileSync(saved)).toEqual(bytes)
  expect(path.dirname(saved)).toBe(path.join(root, '1/ui/composer-images'))
  expect(drained).toHaveBeenCalledOnce()

  ipc.invoke('hermes:context-menu:edit', sender, 'copy')
  ipc.invoke('hermes:context-menu:copy-image', sender)
  expect(sender.copy).toHaveBeenCalledOnce()
  expect(sender.copyImageAt).toHaveBeenCalledExactlyOnceWith(17, 29)
  expect(window).not.toHaveProperty('copy')
})

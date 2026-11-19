import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { IpcMain } from 'electron'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const native = vi.hoisted(() => ({ execText: vi.fn(), getFileIcon: vi.fn(), fromWebContents: vi.fn() }))

vi.mock('electron', () => ({
  app: { getFileIcon: native.getFileIcon },
  BrowserWindow: { fromWebContents: native.fromWebContents }
}))
vi.mock('./backend-claim', () => ({ execText: native.execText }))

import { registerPreviewBrowserApps } from './preview-browser-apps'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aino-preview-browsers-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
  vi.resetAllMocks()
})

async function bundle(id: string, name: string, exists = true) {
  const bundlePath = path.join(root, 'Applications', `${name}.app`)
  const executable = path.join(bundlePath, 'Contents', 'MacOS', name)

  if (exists) {
    await fs.mkdir(path.dirname(executable), { recursive: true })
    await fs.writeFile(executable, '', { mode: 0o700 })
  }

  return { bundle: bundlePath, id, executable }
}

function setup() {
  type Handler = Parameters<IpcMain['handle']>[1]
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (name: string, handler: Handler) => handlers.set(name, handler) } as Pick<IpcMain, 'handle'>
  const senderFrame = {}
  const sender = { mainFrame: senderFrame }
  const event = { sender, senderFrame } as Parameters<Handler>[0]
  native.fromWebContents.mockReturnValue({ webContents: sender, isDestroyed: () => false })
  const account = path.join(root, 'Account Workspace')
  registerPreviewBrowserApps(
    ipc,
    () => account,
    () => null
  )

  return {
    account,
    list: () => handlers.get('hermes:preview-browser-apps:list')!(event),
    open: (id: unknown, data: unknown) => handlers.get('hermes:preview-browser-apps:open')!(event, id, data)
  }
}

test.runIf(process.platform === 'darwin')(
  'lists only runnable browser bundles with opaque keys and optional icons',
  async () => {
    const { list } = setup()
    const edge = await bundle('com.microsoft.edgemac', 'Microsoft Edge')
    const chrome = await bundle('com.google.Chrome', 'Google Chrome')
    const duplicate = await bundle('com.google.Chrome', 'Google Chrome duplicate')
    const absent = await bundle('com.apple.Safari', 'Safari', false)
    const nonBrowser = await bundle('invalid.other', 'Other')
    const icon = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/awcpWQAAAAASUVORK5CYII='
    native.execText.mockResolvedValue(JSON.stringify([edge, absent, nonBrowser, { ...chrome, icon }, duplicate]))

    await expect(list()).resolves.toEqual([
      { id: 'edge', name: 'Microsoft Edge' },
      { id: 'chrome', name: 'Google Chrome', icon: `data:image/png;base64,${icon}` }
    ])
    expect(native.getFileIcon).not.toHaveBeenCalled()
  }
)

test('rejects an unknown browser key or malformed bytes before trying to discover browsers', async () => {
  const { open } = setup()
  await expect(open('/Applications/Google Chrome.app', new Uint8Array([1]))).rejects.toThrow(/no longer available/)
  await expect(open('chrome', [])).rejects.toMatchObject({ code: 'invalid-image-data' })
  expect(native.execText).not.toHaveBeenCalled()
  expect(await fs.readdir(root)).toEqual([])
})

test.runIf(process.platform === 'darwin')(
  'opens the staged HTML in the selected app and surfaces stale or failed launches',
  async () => {
    const { list, open, account } = setup()
    const chrome = await bundle('com.google.Chrome', 'Google Chrome')
    const edge = await bundle('com.microsoft.edgemac', 'Microsoft Edge')
    native.execText.mockImplementation(async (command, args) => {
      if (command === '/usr/bin/osascript') {
        return JSON.stringify([edge, chrome])
      }

      expect(command).toBe('/usr/bin/open')
      expect(args.slice(0, 2)).toEqual(['-a', chrome.bundle])
      expect(path.dirname(args[2])).toBe(path.join(account, 'composer-images'))
      expect(path.extname(args[2])).toBe('.html')
      expect(await fs.readFile(args[2], 'utf8')).toBe('<main>鹈鹕骑行</main>')
      throw new Error(`browser launch refused: ${args[2]}`)
    })

    const html = new TextEncoder().encode('<main>鹈鹕骑行</main>')
    await expect(list()).resolves.toContainEqual({ id: 'edge', name: 'Microsoft Edge' })
    await fs.rm(edge.executable)
    await expect(open('edge', html)).rejects.toThrow(/no longer available/)
    await expect(fs.readdir(account)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(open('chrome', html)).rejects.toMatchObject({
      message: 'Could not open artifact in the selected browser.'
    })
    expect(native.execText.mock.calls.filter(([command]) => command === '/usr/bin/open')).toHaveLength(1)
  }
)

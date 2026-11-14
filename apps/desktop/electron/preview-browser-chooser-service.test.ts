import { EventEmitter } from 'node:events'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Session, WebContents } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { runPreviewBrowserInteraction } from './preview-browser-interactions'
import { admitPreviewGuestSession } from './preview-guest-owner'

const native = vi.hoisted(() => ({ choose: vi.fn(), release: vi.fn(async () => {}) }))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => ({ isDestroyed: () => false }) },
  dialog: { showOpenDialog: (...args: unknown[]) => native.choose(...args) }
}))
vi.mock('./preview-approval', () => ({
  createPreviewApproval: async () => ({ validate: vi.fn(), release: native.release })
}))

class Contents extends EventEmitter {
  id = 91
  hostWebContents?: Contents
  session = new EventEmitter()
  getURL = () => 'https://upload.example/'
  getType = () => (this.hostWebContents ? 'webview' : 'window')
  isDestroyed = () => false
  send = vi.fn()
  debugger = Object.assign(new EventEmitter(), {
    attached: false,
    isAttached: () => this.debugger.attached,
    attach: () => {
      this.debugger.attached = true
    },
    detach: () => {
      this.debugger.attached = false
      this.debugger.emit('detach')
    },
    sendCommand: vi.fn(async (method: string) => {
      if (method === 'DOM.resolveNode') {
        return { object: { objectId: 'hidden-input' } }
      }

      if (method === 'DOM.describeNode') {
        return { node: { localName: 'input', attributes: ['type', 'file'] } }
      }

      if (method === 'Runtime.callFunctionOn') {
        return { result: { value: true } }
      }

      return {}
    })
  })
}
let directory: string
let owner: Contents
let guest: Contents

const request = (action: string, fields: Record<string, unknown> = {}) =>
  runPreviewBrowserInteraction(
    owner as unknown as WebContents,
    guest as unknown as WebContents,
    { action, scope: 'chooser-service', authorization: 'session-a', ...fields } as never
  )

beforeEach(async () => {
  vi.clearAllMocks()
  directory = await realpath(await mkdtemp(path.join(tmpdir(), 'aino-chooser-service-')))
  owner = new Contents()
  guest = new Contents()
  guest.hostWebContents = owner
  admitPreviewGuestSession(guest.session as unknown as Session)
  await request('watch')
  guest.debugger.emit('message', {}, 'Page.fileChooserOpened', { backendNodeId: 75, mode: 'selectSingle' })
})
afterEach(async () => {
  await request('release')
  await rm(directory, { recursive: true, force: true })
})

it('uploads exactly approved files into the intercepted hidden input without a page locator', async () => {
  const file = path.join(directory, 'approved.txt')
  await writeFile(file, 'approved fixture bytes')
  const chooser = (await request('dialog_status')).file_chooser!
  expect(chooser).toMatchObject({ state: 'pending', multiple: false })
  const prepared = await request('upload_prepare', { paths: [file], chooserId: chooser.id })
  await request('upload_commit', { ticket: prepared.ticket })
  expect(guest.debugger.sendCommand).toHaveBeenCalledWith('DOM.setFileInputFiles', {
    files: [file],
    objectId: 'hidden-input'
  })
  expect(guest.debugger.sendCommand.mock.calls.some(([method]) => method === 'Runtime.evaluate')).toBe(false)
  expect((await request('dialog_status')).file_chooser).toMatchObject({ id: chooser.id, state: 'completed' })
  await expect(request('upload_prepare', { paths: [file], chooserId: chooser.id })).rejects.toThrow('no longer pending')
})

it('rejects manual files after control changes while the OS chooser is open', async () => {
  const file = path.join(directory, 'manual.txt')
  await writeFile(file, 'manual fixture bytes')
  let finish!: (value: unknown) => void
  native.choose.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const chooser = (await request('dialog_status')).file_chooser!
  const manual = request('chooser_manual', { chooserId: chooser.id })
  await vi.waitFor(() => expect(native.choose).toHaveBeenCalledOnce())
  await request('watch', { authorization: 'session-b' })
  finish({ canceled: false, filePaths: [file] })
  await expect(manual).rejects.toThrow('control changed')
  expect(native.release).toHaveBeenCalledOnce()
  expect(guest.debugger.sendCommand.mock.calls.some(([method]) => method === 'DOM.setFileInputFiles')).toBe(false)
})

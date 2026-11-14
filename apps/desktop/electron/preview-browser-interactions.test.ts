import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Session, WebContents } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { PreviewBrowserFiles } from './preview-browser-files'
import { runPreviewBrowserInteraction } from './preview-browser-interactions'
import { admitPreviewGuestSession } from './preview-guest-owner'

const approval = vi.hoisted(() => ({ release: vi.fn(async () => {}) }))
vi.mock('./preview-approval', () => ({
  createPreviewApproval: async () => ({ validate: vi.fn(), release: approval.release })
}))
vi.mock('./preview-native-dialog-adapter', () => ({
  installPreviewNativeDialogAdapter: (_owner: unknown, guest: EventEmitter, open: (...args: unknown[]) => void) => {
    guest.on('fixture:dialog', open)

    return () => { guest.removeListener('fixture:dialog', open) }
  }
}))

class Contents extends EventEmitter {
  id = 7
  destroyed = false
  hostWebContents?: Contents
  session = new EventEmitter()
  getURL = () => 'https://example.com/upload'
  getType = () => (this.hostWebContents ? 'webview' : 'window')
  isDestroyed = () => this.destroyed
  send = vi.fn()
  debugger = Object.assign(new EventEmitter(), {
    attached: false,
    isAttached: () => this.debugger.attached,
    attach: vi.fn(() => {
      this.debugger.attached = true
    }),
    detach: vi.fn(() => {
      this.debugger.attached = false
      this.debugger.emit('detach')
    }),
    sendCommand: vi.fn(async (method: string, _params?: unknown) => {
      if (method === 'Runtime.evaluate') {
        return { result: { objectId: 'file-node' } }
      }

      if (method === 'DOM.describeNode') {
        return { node: { localName: 'input', attributes: ['type', 'file', 'multiple', ''] } }
      }

      if (method === 'Runtime.callFunctionOn') {
        return { result: { value: true } }
      }

      return {}
    })
  })
}

class Download extends EventEmitter {
  save = ''
  getURL = () => 'https://example.com/file'
  getFilename = () => 'report.txt'
  getReceivedBytes = () => 12
  getTotalBytes = () => 12
  getSavePath = () => this.save
  setSavePath = vi.fn((value: string) => {
    this.save = value
  })
  cancel = vi.fn(() => this.emit('done', {}, 'cancelled'))
}

let owner: Contents
let guest: Contents
let directory: string
const scope = 'profile-a/session-a/tab-a'

const request = (action: string, params: Record<string, unknown> = {}) =>
  runPreviewBrowserInteraction(
    owner as unknown as WebContents,
    guest as unknown as WebContents,
    { action, scope, ...params } as never
  )

function nativeDialog(params: { type: string; url?: string; message: string; defaultPrompt?: string }) {
  const respond = vi.fn()
  guest.emit('fixture:dialog', { type: params.type, message: params.message, defaultText: params.defaultPrompt ?? '', url: params.url ?? guest.getURL(), respond })

  return respond
}

beforeEach(async () => {
  directory = await realpath(await mkdtemp(path.join(tmpdir(), 'aino-browser-files-')))
  owner = new Contents()
  guest = new Contents()
  guest.hostWebContents = owner
  admitPreviewGuestSession(guest.session as unknown as Session)
})
afterEach(async () => {
  if (!guest.destroyed) {await request('release')}
  await rm(directory, { recursive: true, force: true })
})

it('reads a blocked dialog without guest JavaScript, hides prompt defaults and refuses model-supplied secrets', async () => {
  await request('watch')

  const respond = nativeDialog({
    type: 'prompt',
    url: guest.getURL(),
    message: 'Enter password',
    defaultPrompt: 'private-default'
  })

  const status = await request('dialog_status')
  expect(JSON.stringify(status)).not.toContain('private-default')
  expect(await request('dialog_manual_status', { dialogId: status.dialogs![0].id })).toMatchObject({
    default_text: 'private-default'
  })
  expect(status.dialogs?.[0]).toMatchObject({ type: 'prompt', state: 'pending', sensitive: true })
  await expect(
    request('dialog_respond', { dialogId: status.dialogs![0].id, accept: true, promptText: 'secret' })
  ).rejects.toThrow('directly')
  expect(guest.debugger.sendCommand).not.toHaveBeenCalledWith('Runtime.evaluate', expect.anything())
  await request('dialog_manual', { dialogId: status.dialogs![0].id, accept: true, promptText: 'typed-by-user' })
  expect(respond).toHaveBeenCalledWith(true, 'typed-by-user')
  expect(JSON.stringify(await request('dialog_status'))).not.toContain('typed-by-user')
})

it('binds upload authorization to exact unchanged files and the current page', async () => {
  const input = path.join(directory, 'upload.txt')
  await writeFile(input, 'approved')
  const prepared = await request('upload_prepare', { paths: [input] })
  expect(prepared.upload).toMatchObject({ state: 'prepared', paths: [input] })
  await writeFile(input, 'changed after approval')
  await expect(request('upload_commit', { ticket: prepared.ticket })).rejects.toThrow('changed')
  expect(guest.debugger.sendCommand).not.toHaveBeenCalledWith('DOM.setFileInputFiles', expect.anything(), undefined)
  const retry = await request('upload_prepare', { paths: [input] })
  guest.emit('did-navigate')
  await expect(request('upload_commit', { ticket: retry.ticket })).rejects.toThrow('unavailable')
})

it('sets an approved download destination once and reports completion while manual downloads keep their picker', async () => {
  const destination = path.join(directory, 'saved.txt')
  const prepared = await request('download_prepare', { downloadPath: destination })
  await request('download_commit', { ticket: prepared.ticket })
  const first = new Download()
  guest.session.emit('will-download', {}, first, guest)
  expect(first.setSavePath).toHaveBeenCalledWith(destination)
  await writeFile(destination, 'finished')
  first.emit('done', {}, 'completed')
  const manual = new Download()
  guest.session.emit('will-download', {}, manual, guest)
  expect(manual.setSavePath).not.toHaveBeenCalled()
  const status = await request('downloads_status')
  expect(status.downloads).toEqual(
    expect.arrayContaining([expect.objectContaining({ state: 'completed', path: destination })])
  )
  const pending = status.downloads!.find(item => item.state === 'progressing')!
  await request('download_cancel', { downloadId: pending.id })
  expect(manual.cancel).toHaveBeenCalledOnce()
  expect(await readFile(destination, 'utf8')).toBe('finished')
})

it('rejects existing destinations and authorizations from another page generation', async () => {
  const files = new PreviewBrowserFiles()
  const destination = path.join(directory, 'existing.txt')
  await writeFile(destination, 'keep')
  await expect(files.prepareDownload(destination, 1)).rejects.toThrow('already exists')
  await expect(files.prepareUpload([directory], 1)).rejects.toThrow('regular files')
  await expect(request('upload_prepare', { paths: [directory] })).rejects.toThrow('regular files')
  expect(guest.debugger.sendCommand).toHaveBeenCalledWith('Runtime.releaseObject', { objectId: 'file-node' })
  const grant = await files.prepareUpload([destination], 1)
  await expect(files.consumeUpload(grant.ticket, 2)).rejects.toThrow('page changed')
})

it('rejects another window without attaching its debugger', async () => {
  const foreign = new Contents()
  await expect(
    runPreviewBrowserInteraction(foreign as unknown as WebContents, guest as unknown as WebContents, {
      action: 'watch',
      scope
    })
  ).rejects.toThrow('owner')
  expect(guest.debugger.attach).not.toHaveBeenCalled()
})

it('cancels an automatic download if its approved parent folder is replaced by a symlink', async () => {
  const parent = path.join(directory, 'approved')
  await mkdir(parent)
  const prepared = await request('download_prepare', { downloadPath: path.join(parent, 'saved.txt') })
  await request('download_commit', { ticket: prepared.ticket })
  await rename(parent, path.join(directory, 'original'))
  await symlink(path.join(directory, 'original'), parent, 'dir')
  const item = new Download()
  guest.session.emit('will-download', {}, item, guest)
  expect(item.setSavePath).not.toHaveBeenCalled()
  expect(item.cancel).toHaveBeenCalledOnce()
  expect((await request('downloads_status')).downloads).toEqual([expect.objectContaining({ state: 'cancelled' })])
})

it('binds each response to one native dialog callback and retires it after navigation', async () => {
  await request('watch')
  const respond = nativeDialog({ type: 'confirm', message: 'Continue embedded action?', url: 'https://embedded.example/' })
  const initial = (await request('dialog_status')).dialogs![0]
  await request('dialog_respond', { dialogId: initial.id, accept: false })
  expect(respond).toHaveBeenCalledWith(false, undefined)
  expect(respond).toHaveBeenCalledOnce()
  const staleResponse = nativeDialog({ type: 'alert', message: 'Before navigation' })
  const stale = (await request('dialog_status')).dialogs!.at(-1)!
  guest.emit('did-navigate')
  expect(staleResponse).toHaveBeenCalledWith(false)
  await expect(request('dialog_respond', { dialogId: stale.id, accept: true })).rejects.toThrow('no longer pending')
})

it('keeps sibling frame dialogs queued with their own callbacks and defaults until native cancellation', async () => {
  await request('watch')
  owner.send.mockClear()
  const firstResponse = nativeDialog({ type: 'prompt', message: 'First frame', defaultPrompt: 'first-private' })
  const secondResponse = nativeDialog({ type: 'prompt', message: 'Second frame', defaultPrompt: 'second-private' })
  const pending = (await request('dialog_status')).dialogs!
  expect(owner.send.mock.calls.filter(([channel]) => channel === 'hermes:preview-browser-dialog')).toEqual([
    ['hermes:preview-browser-dialog', expect.objectContaining({ dialog: pending[0], defaultText: 'first-private' })]
  ])
  guest.debugger.emit('message', {}, 'Page.frameNavigated', { frame: { id: 'sibling', url: 'https://sibling.example/' } })
  guest.debugger.emit('message', {}, 'Page.frameDetached', { frameId: 'sibling', reason: 'remove' })
  expect(firstResponse).not.toHaveBeenCalled()
  expect(secondResponse).not.toHaveBeenCalled()
  await request('dialog_manual', { dialogId: pending[0].id, accept: true })
  expect(firstResponse).toHaveBeenCalledExactlyOnceWith(true, 'first-private')
  expect(owner.send).toHaveBeenLastCalledWith('hermes:preview-browser-dialog', expect.objectContaining({
    dialog: pending[1], defaultText: 'second-private'
  }))
  guest.emit('-cancel-dialogs')
  guest.emit('-cancel-dialogs')
  expect(secondResponse).toHaveBeenCalledExactlyOnceWith(false)
  expect((await request('dialog_status')).dialogs).toEqual([
    expect.objectContaining({ id: pending[0].id, state: 'accepted' }),
    expect.objectContaining({ id: pending[1].id, state: 'closed' })
  ])
  await expect(request('dialog_manual', { dialogId: pending[1].id, accept: true })).rejects.toThrow('no longer pending')
  expect(secondResponse).toHaveBeenCalledOnce()
})

it('releases and consumes only the cancelled upload ticket without setting input files', async () => {
  const file = path.join(directory, 'cancelled-upload.txt')
  await writeFile(file, 'approved fixture bytes')
  const prepared = await request('upload_prepare', { paths: [file] })
  const priorReleases = approval.release.mock.calls.length
  await request('upload_cancel', { ticket: prepared.ticket })
  expect(approval.release.mock.calls.length).toBe(priorReleases + 1)
  await expect(request('upload_commit', { ticket: prepared.ticket })).rejects.toThrow('unavailable')
  expect(guest.debugger.sendCommand.mock.calls.some(([method]) => method === 'DOM.setFileInputFiles')).toBe(false)
})


it('disposes an already destroyed guest without reading its invalid native session or debugger accessors', async () => {
  const session = guest.session
  const debuggerClient = guest.debugger
  Object.defineProperty(guest, 'session', { get: () => {
    if (guest.destroyed) {throw new Error('Object has been destroyed')}

    return session
  } })
  Object.defineProperty(guest, 'debugger', { get: () => {
    if (guest.destroyed) {throw new Error('Object has been destroyed')}

    return debuggerClient
  } })
  await request('watch')
  guest.destroyed = true
  expect(() => guest.emit('destroyed')).not.toThrow()
  expect(session.listenerCount('will-download')).toBe(0)
  expect(debuggerClient.listenerCount('message')).toBe(0)
})

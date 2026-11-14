import { EventEmitter } from 'node:events'

import type { Session, WebContents } from 'electron'
import { expect, it, vi } from 'vitest'

import { admitPreviewGuestSession } from './preview-guest-owner'
import { installPreviewNativeDialogAdapter, type PreviewNativeDialogRequest } from './preview-native-dialog-adapter'

class Contents extends EventEmitter {
  hostWebContents?: Contents
  session = {} as Session
  destroyed = false
  getType = () => (this.hostWebContents ? 'webview' : 'window')
  isDestroyed = () => this.destroyed
  getLastWebPreferences = () => ({ disableDialogs: false })
  showMessageBox = vi.fn((_info, callback) => callback(false, 'manual fallback'))
}

function electronDialog(this: Contents, info: any, callback: (accept: boolean, text: string) => void) {
  const preferences = this.getLastWebPreferences()

  if (preferences.disableDialogs || info.dialogType === 'prompt') {
    callback(false, '')

    return
  }

  this.showMessageBox(info, callback)
}

function fixture() {
  const owner = new Contents()
  const guest = new Contents()
  guest.hostWebContents = owner
  admitPreviewGuestSession(guest.session)
  guest.on('-run-dialog', electronDialog)

  return {
    owner,
    guest,
    install: (open: (request: PreviewNativeDialogRequest) => void) =>
      installPreviewNativeDialogAdapter(owner as unknown as WebContents, guest as unknown as WebContents, open)
  }
}

const info = {
  dialogType: 'prompt',
  messageText: 'Name',
  defaultPromptText: 'private default',
  frame: { url: 'https://child.example/form', detached: false, isDestroyed: () => false }
}

it('routes the one owned native handler exactly once and restores it while stale responders cannot accept', () => {
  const { owner, guest, install } = fixture()
  const pending: PreviewNativeDialogRequest[] = []
  const dispose = install(request => pending.push(request))!
  expect(dispose).toBeTypeOf('function')
  expect(guest.listenerCount('-run-dialog')).toBe(1)
  expect(install(() => {})).toBeUndefined()
  const first = vi.fn()
  guest.emit('-run-dialog', info, first)
  expect(pending[0]).toMatchObject({
    type: 'prompt',
    message: 'Name',
    defaultText: 'private default',
    url: 'https://child.example/form'
  })
  expect(guest.showMessageBox).not.toHaveBeenCalled()
  pending[0].respond(true)
  pending[0].respond(false)
  expect(first).toHaveBeenCalledExactlyOnceWith(true, 'private default')
  const stale = vi.fn()
  guest.emit('-run-dialog', info, stale)
  guest.hostWebContents = new Contents()
  pending[1].respond(true, 'must not reach page')
  expect(stale).toHaveBeenCalledExactlyOnceWith(false, '')
  guest.hostWebContents = owner
  const destroyed = vi.fn()
  guest.emit('-run-dialog', info, destroyed)
  guest.destroyed = true
  pending[2].respond(true, 'must not reach destroyed page')
  expect(destroyed).not.toHaveBeenCalled()
  dispose()
  dispose()
  expect(guest.listeners('-run-dialog')).toEqual([electronDialog])

  const retiredFixture = fixture()
  let retiredRequest: PreviewNativeDialogRequest
  const retire = retiredFixture.install(request => {
    retiredRequest = request
  })!
  const retired = vi.fn()
  retiredFixture.guest.emit('-run-dialog', info, retired)
  retire()
  retiredRequest!.respond(true, 'must not reach a retired adapter')
  expect(retired).toHaveBeenCalledExactlyOnceWith(false, '')
})

it('keeps unknown handlers intact and forwards an invalid native event to the exact captured fallback', () => {
  const { guest, install } = fixture()
  const foreign = new Contents()
  expect(
    installPreviewNativeDialogAdapter(foreign as unknown as WebContents, guest as unknown as WebContents, () => {})
  ).toBeUndefined()
  expect(guest.listeners('-run-dialog')).toEqual([electronDialog])

  const additional = () => {}
  guest.on('-run-dialog', additional)
  expect(install(() => {})).toBeUndefined()
  guest.removeListener('-run-dialog', additional)
  guest.removeListener('-run-dialog', electronDialog)
  const unknown = vi.fn()
  guest.on('-run-dialog', unknown)
  expect(install(() => {})).toBeUndefined()
  expect(guest.listeners('-run-dialog')).toEqual([unknown])
  guest.removeListener('-run-dialog', unknown)
  guest.on('-run-dialog', electronDialog)
  const open = vi.fn()
  const dispose = install(open)!
  const callback = vi.fn()
  const unsupported = { dialogType: 'alert', messageText: 'Manual alert without a live frame' }
  guest.emit('-run-dialog', unsupported, callback)
  expect(open).not.toHaveBeenCalled()
  expect(guest.showMessageBox).toHaveBeenCalledExactlyOnceWith(unsupported, callback)
  expect(callback).toHaveBeenCalledExactlyOnceWith(false, 'manual fallback')
  dispose()
  expect(guest.listeners('-run-dialog')).toEqual([electronDialog])
})

it('pins the native frame and refuses accepted responses after navigation, detachment or destruction', () => {
  for (const state of ['url', 'detached', 'destroyed'] as const) {
    const { guest, install } = fixture()
    let pending: PreviewNativeDialogRequest
    const dispose = install(request => {
      pending = request
    })!
    const frame = { url: 'https://child.example/form', detached: false, isDestroyed: () => false }
    const callback = vi.fn()
    guest.emit('-run-dialog', { ...info, frame }, callback)

    if (state === 'url') {
      frame.url = 'https://child.example/another'
    }

    if (state === 'detached') {
      frame.detached = true
    }

    if (state === 'destroyed') {
      frame.isDestroyed = () => true
    }
    expect(() => pending!.respond(true, 'stale response')).toThrow('The website dialog frame changed')
    pending!.respond(false)

    if (state === 'url') {
      expect(callback).toHaveBeenCalledExactlyOnceWith(false, '')
    } else {
      expect(callback).not.toHaveBeenCalled()
    }

    dispose()
  }

  const { guest, install } = fixture()
  let pending: PreviewNativeDialogRequest
  const dispose = install(request => {
    pending = request
  })!
  const frame = { url: 'https://child.example/form', detached: false, isDestroyed: () => false }
  const callback = vi.fn()
  guest.emit('-run-dialog', { ...info, frame }, callback)
  frame.isDestroyed = () => true
  pending!.respond(false)
  expect(callback).not.toHaveBeenCalled()
  dispose()
})

import { EventEmitter } from 'node:events'

import type { Session, WebContents } from 'electron'
import { expect, it, vi } from 'vitest'

import { acquirePreviewGuestCdp } from './preview-guest-cdp'
import { admitPreviewGuestSession } from './preview-guest-owner'

class Contents extends EventEmitter {
  hostWebContents?: Contents
  session = new EventEmitter()
  getType = () => (this.hostWebContents ? 'webview' : 'window')
  isDestroyed = () => false
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
    sendCommand: vi.fn(async (method: string, _params?: unknown, _sessionId?: string): Promise<any> => {
      if (method === 'Target.attachToTarget') {return { sessionId: 'shared-child' }}

      return {}
    })
  })
}

function fixture() {
  const owner = new Contents()
  const guest = new Contents()
  guest.hostWebContents = owner
  admitPreviewGuestSession(guest.session as unknown as Session)
  const acquire = () => acquirePreviewGuestCdp(owner as unknown as WebContents, guest as unknown as WebContents)

  return { guest, acquire }
}

it('shares one owned iframe session across native features and keeps it alive until the final client releases', async () => {
  const { guest, acquire } = fixture()
  const chooser = acquire()
  const approval = acquire()
  const intercept = vi.fn(async () => {})
  await chooser.watchFrames(intercept)
  guest.debugger.emit('message', {}, 'Target.attachedToTarget', {
    sessionId: 'auto-child',
    targetInfo: { type: 'iframe', targetId: 'frame-target' }
  })
  await vi.waitFor(() => expect(intercept).toHaveBeenCalledWith('auto-child'))
  expect(await approval.attachOwnedFrame('frame-target')).toBe('auto-child')
  expect(guest.debugger.sendCommand.mock.calls.some(([method]) => method === 'Target.attachToTarget')).toBe(false)
  chooser.release()
  expect(approval.frameSessions().get('frame-target')).toBe('auto-child')
  expect(guest.debugger.detach).not.toHaveBeenCalled()
  approval.release()
  expect(guest.debugger.detach).toHaveBeenCalledOnce()
})

it('resumes unsupported owned child targets and never initializes a foreign target session', async () => {
  const { guest, acquire } = fixture()
  const client = acquire()

  const intercept = vi.fn(async () => {
    throw new Error('unsupported interception')
  })

  await client.watchFrames(intercept)
  guest.debugger.emit('message', {}, 'Target.attachedToTarget', {
    sessionId: 'unsupported',
    targetInfo: { type: 'iframe', targetId: 'child-target' }
  })
  await vi.waitFor(() =>
    expect(guest.debugger.sendCommand).toHaveBeenCalledWith('Runtime.runIfWaitingForDebugger', {}, 'unsupported')
  )
  guest.debugger.emit(
    'message',
    {},
    'Target.attachedToTarget',
    {
      sessionId: 'foreign',
      targetInfo: { type: 'iframe', targetId: 'foreign-target' }
    },
    'foreign-parent'
  )
  expect(client.frameSessions().has('foreign-target')).toBe(false)
  client.release()
})

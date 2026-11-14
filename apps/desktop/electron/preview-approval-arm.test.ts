import { EventEmitter } from 'node:events'

import { afterEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ create: vi.fn(async () => ({ release: vi.fn() })) }))
vi.mock('./preview-approval', () => ({ createPreviewApproval: fixture.create }))

import { admitPreviewGuestSession } from './preview-guest-owner'
import { armPreviewGuestApproval, beginPreviewGuestActivity, endPreviewGuestActivity } from './preview-guest-throttle'

afterEach(() => vi.clearAllMocks())

function browser() {
  const owner = Object.assign(new EventEmitter(), { getType: () => 'window', isDestroyed: () => false })
  const session = {}
  admitPreviewGuestSession(session as never)

  const guest = Object.assign(new EventEmitter(), {
    getType: () => 'webview',
    hostWebContents: owner,
    session,
    isDestroyed: () => false,
    getBackgroundThrottling: () => false,
    setBackgroundThrottling: vi.fn(),
    getURL: () => 'https://fixture.test/',
    isLoadingMainFrame: () => false
  })

  const token = beginPreviewGuestActivity(owner as never, guest as never, () => () => {})

  return { owner: owner as never, token, guest }
}

it('binds the confirmed pointer in CSS coordinates to the same native activity', async () => {
  const { owner, token, guest } = browser()
  await armPreviewGuestApproval(owner, token, { x: 40, y: 20 })
  expect(fixture.create).toHaveBeenCalledExactlyOnceWith(owner, guest, { x: 40, y: 20 })
  await endPreviewGuestActivity(owner, token)
})

it('releases the native guard when takeover cancels its pending input acknowledgement', async () => {
  const { owner, token } = browser()
  const input = Promise.withResolvers<Awaited<ReturnType<typeof fixture.create>>>()
  fixture.create.mockReturnValueOnce(input.promise)
  const pending = armPreviewGuestApproval(owner, token)
  const rejected = expect(pending).rejects.toThrow('ended')
  await endPreviewGuestActivity(owner, token)
  const release = vi.fn()
  input.resolve({ release })
  await rejected
  expect(release).toHaveBeenCalledOnce()
})

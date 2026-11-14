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
  const input = Promise.withResolvers<void>()

  const guest = Object.assign(new EventEmitter(), {
    getType: () => 'webview',
    hostWebContents: owner,
    session,
    isDestroyed: () => false,
    getBackgroundThrottling: () => false,
    setBackgroundThrottling: vi.fn(),
    getURL: () => 'https://fixture.test/',
    isLoadingMainFrame: () => false,
    executeJavaScript: vi.fn(() => input.promise)
  })

  const token = beginPreviewGuestActivity(owner as never, guest as never, () => () => {})

  return { owner: owner as never, token, input }
}

it('binds the approval snapshot only after pending native input has rendered', async () => {
  const { owner, token, input } = browser()
  const pending = armPreviewGuestApproval(owner, token)
  await Promise.resolve()
  expect(fixture.create).not.toHaveBeenCalled()
  input.resolve()
  await pending
  expect(fixture.create).toHaveBeenCalledOnce()
  await endPreviewGuestActivity(owner, token)
})

it('does not arm an approval when takeover cancels its pending render', async () => {
  const { owner, token, input } = browser()
  const pending = armPreviewGuestApproval(owner, token)
  const rejected = expect(pending).rejects.toThrow('ended')
  await endPreviewGuestActivity(owner, token)
  await rejected
  input.resolve()
  expect(fixture.create).not.toHaveBeenCalled()
})

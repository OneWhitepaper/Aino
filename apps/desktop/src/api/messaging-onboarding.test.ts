import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { resolveOwnerNow, setApiRequestConnection, setApiRequestProfile } from './client'
import { updateMessagingPlatform } from './messaging'
import { cancelMessagingOnboarding, connectMessagingPlatform, startMessagingOnboarding } from './messaging-onboarding'

const api = vi.fn(async (_request: { connectionId?: string; profile?: string }) => ({}))
beforeEach(() => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
  setApiRequestConnection('original-host')
  setApiRequestProfile('original-profile')
})
afterEach(() => {
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  api.mockClear()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it('keeps QR cleanup and activation on the original owner after switching connections', async () => {
  const owner = resolveOwnerNow()
  await startMessagingOnboarding('weixin', owner)
  setApiRequestConnection('other-host')
  setApiRequestProfile('other-profile')
  await cancelMessagingOnboarding('weixin', 'opaque-pairing', owner)
  await connectMessagingPlatform('weixin', owner)

  for (const [request] of api.mock.calls) {
    expect(request).toEqual(expect.objectContaining({ connectionId: 'original-host', profile: 'original-profile' }))
  }
})

it('requests guarded activation when saving instead of rebuilding busy secondary profiles', async () => {
  await updateMessagingPlatform('qqbot', { enabled: false }, 'worker')
  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      body: { enabled: false, apply_live: true },
      profile: 'worker',
      path: '/api/messaging/platforms/qqbot',
      method: 'PUT'
    })
  )
})

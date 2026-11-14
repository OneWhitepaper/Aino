import { EventEmitter } from 'node:events'

import type { Session, WebContents } from 'electron'
import { expect, it, vi } from 'vitest'

import { createPreviewApproval } from './preview-approval'
import { admitPreviewGuestSession, registerNativePreviewGuest } from './preview-guest-owner'
import {
  armPreviewGuestApproval,
  beginPreviewGuestActivity,
  endPreviewGuestActivity,
  hasPreviewGuestApproval
} from './preview-guest-throttle'

vi.mock('./preview-approval', () => ({ createPreviewApproval: vi.fn() }))

it('blocks automatic fitting from approval preparation through release using the exact existing guest lease', async () => {
  const session = {} as Session
  admitPreviewGuestSession(session)
  const owner = Object.assign(new EventEmitter(), {
    getType: () => 'window',
    isDestroyed: () => false
  }) as unknown as WebContents

  const guest = Object.assign(new EventEmitter(), {
    session,
    getType: () => 'browserView',
    isDestroyed: () => false,
    getBackgroundThrottling: () => true,
    setBackgroundThrottling: vi.fn()
  }) as unknown as WebContents

  const unregister = registerNativePreviewGuest(guest, owner)
  const release = vi.fn(async () => {})
  let finish!: (value: {
    validate: () => Promise<void>
    send: () => Promise<void>
    release: () => Promise<void>
  }) => void
  vi.mocked(createPreviewApproval).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  const token = beginPreviewGuestActivity(owner, guest, () => () => {})

  try {
    expect(hasPreviewGuestApproval(guest)).toBe(false)
    const preparing = armPreviewGuestApproval(owner, token)
    expect(hasPreviewGuestApproval(guest)).toBe(true)
    await expect(armPreviewGuestApproval(owner, token)).rejects.toThrow('being prepared')
    finish({ validate: async () => {}, send: async () => {}, release })
    await preparing
    expect(hasPreviewGuestApproval(guest)).toBe(true)
    await endPreviewGuestActivity(owner, token)
    expect(hasPreviewGuestApproval(guest)).toBe(false)
    expect(release).toHaveBeenCalledOnce()
  } finally {
    endPreviewGuestActivity(owner, token)
    unregister()
  }
})

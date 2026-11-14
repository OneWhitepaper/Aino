import type { Session } from 'electron'
import { expect, it, vi } from 'vitest'

import {
  admitPreviewGuestSession,
  isOwnedPreviewGuest,
  registerNativePreviewGuest,
  setNativePreviewOwner,
  watchNativePreviewOwner
} from './preview-guest-owner'

function owner() {
  return { getType: () => 'window', isDestroyed: () => false }
}

function nativeGuest() {
  const session = {} as Session
  admitPreviewGuestSession(session)

  return { getType: () => 'browserView', isDestroyed: () => false, session }
}

it('admits only the registered owner and notifies transfer, detach and unregister exactly once', () => {
  const first = owner()
  const second = owner()
  const guest = nativeGuest()
  expect(isOwnedPreviewGuest(first, guest)).toBe(false)
  const unregister = registerNativePreviewGuest(guest, first)
  const changed = vi.fn()
  const stop = watchNativePreviewOwner(guest, changed)

  expect(isOwnedPreviewGuest(first, guest)).toBe(true)
  expect(isOwnedPreviewGuest(second, guest)).toBe(false)
  setNativePreviewOwner(guest, first)
  expect(changed).not.toHaveBeenCalled()
  setNativePreviewOwner(guest, second)
  expect(changed).toHaveBeenCalledOnce()
  expect(isOwnedPreviewGuest(first, guest)).toBe(false)
  expect(isOwnedPreviewGuest(second, guest)).toBe(true)
  setNativePreviewOwner(guest, null)
  expect(changed).toHaveBeenCalledTimes(2)
  expect(isOwnedPreviewGuest(second, guest)).toBe(false)
  unregister()
  unregister()
  expect(changed).toHaveBeenCalledTimes(3)
  stop()
  expect(() => setNativePreviewOwner(guest, first)).toThrow('not registered')
})

it('rejects invalid owners and unadmitted sessions without replacing a live registration', () => {
  const first = owner()
  const guest = nativeGuest()
  expect(() => registerNativePreviewGuest({ ...guest, session: {} as Session }, first)).toThrow('session')
  expect(() => registerNativePreviewGuest(guest, { ...first, isDestroyed: () => true })).toThrow('owner')
  const unregister = registerNativePreviewGuest(guest, first)

  try {
    expect(() => registerNativePreviewGuest(guest, owner())).toThrow('already registered')
    expect(() => setNativePreviewOwner(guest, { ...first, getType: () => 'browserView' })).toThrow('owner')
    expect(isOwnedPreviewGuest(first, guest)).toBe(true)
    guest.isDestroyed = () => true
    expect(isOwnedPreviewGuest(first, guest)).toBe(false)
  } finally {
    unregister()
  }
})

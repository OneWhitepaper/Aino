import type { Session } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'

import { captureOwnedPreviewContents } from './preview-capture'
import { admitPreviewGuestSession, registerNativePreviewGuest, setNativePreviewOwner } from './preview-guest-owner'

afterEach(() => vi.useRealTimers())

function browser() {
  const owner = { getType: () => 'window', isDestroyed: () => false }
  const session = {} as Session
  admitPreviewGuestSession(session)

  const guest = {
    getType: () => 'webview',
    hostWebContents: owner,
    session,
    isDestroyed: () => false,
    capturePage: vi.fn(async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('recovered') }))
  }

  return { owner, guest }
}

it('retries a transient compositor startup failure and returns the next real capture', async () => {
  vi.useFakeTimers()
  const { owner, guest } = browser()
  guest.capturePage.mockRejectedValueOnce(new Error('UnknownVizError'))
  const pending = captureOwnedPreviewContents(owner, guest)
  const expected = expect(pending).resolves.toBe('data:image/png;base64,cmVjb3ZlcmVk')
  await vi.runAllTimersAsync()
  await expected
  expect(guest.capturePage).toHaveBeenCalledTimes(2)
})

it.each([
  ['UnknownVizError', 3],
  ['Browser page is unavailable', 1]
])('ends capture recovery for %s after %i attempts', async (message, attempts) => {
  vi.useFakeTimers()
  const { owner, guest } = browser()
  guest.capturePage.mockRejectedValue(new Error(message))
  const pending = captureOwnedPreviewContents(owner, guest)
  const expected = expect(pending).rejects.toThrow(message)
  await vi.runAllTimersAsync()
  await expected
  expect(guest.capturePage).toHaveBeenCalledTimes(attempts)
})

it('does not retry reading pixels after native ownership changes during recovery', async () => {
  vi.useFakeTimers()
  const { owner, guest } = browser()
  guest.getType = () => 'browserView'
  const next = { getType: () => 'window', isDestroyed: () => false }
  const unregister = registerNativePreviewGuest(guest, owner)
  guest.capturePage.mockRejectedValue(new Error('UnknownVizError'))

  try {
    const pending = captureOwnedPreviewContents(owner, guest)
    const expected = expect(pending).rejects.toThrow('belong')
    await Promise.resolve()
    setNativePreviewOwner(guest, next)
    await vi.runAllTimersAsync()
    await expected
    expect(guest.capturePage).toHaveBeenCalledOnce()
  } finally {
    unregister()
  }
})

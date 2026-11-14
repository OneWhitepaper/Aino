import assert from 'node:assert/strict'

import type { Session } from 'electron'
import { expect, test, vi } from 'vitest'

import {
  captureOwnedPreviewContents,
  capturePreviewContents,
  mapViewportRectToImage,
  normalizeCaptureRect
} from './preview-capture'
import { registerNativePreviewGuest, setNativePreviewOwner } from './preview-guest-owner'
import { applyPreviewGuestAttachPrefs, previewPartitionForProfile } from './preview-guest-throttle'

function ownedPreview() {
  const owner = { getType: () => 'window', isDestroyed: () => false }
  const session = {} as Session
  applyPreviewGuestAttachPrefs({}, previewPartitionForProfile('work'), '/preload.js', () => session)

  const guest = {
    getType: () => 'webview',
    isDestroyed: () => false,
    hostWebContents: owner,
    session,
    capturePage: vi.fn(async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('preview') }))
  }

  return { owner, guest }
}

test('captureOwnedPreviewContents captures an admitted sibling preview jar belonging to its sender', async () => {
  const { owner, guest } = ownedPreview()
  expect(await captureOwnedPreviewContents(owner, guest)).toBe('data:image/png;base64,cHJldmlldw==')
  expect(guest.capturePage).toHaveBeenCalledOnce()
})

test('native preview captures require the registered current owner across transfer and detach', async () => {
  const { owner, guest } = ownedPreview()
  guest.getType = () => 'browserView'
  const next = { getType: () => 'window', isDestroyed: () => false }
  await expect(captureOwnedPreviewContents(owner, guest)).rejects.toThrow('belong')
  const unregister = registerNativePreviewGuest(guest, owner)

  try {
    await expect(captureOwnedPreviewContents(owner, guest)).resolves.toContain('data:image/png')
    setNativePreviewOwner(guest, next)
    await expect(captureOwnedPreviewContents(owner, guest)).rejects.toThrow('belong')
    await expect(captureOwnedPreviewContents(next, guest)).resolves.toContain('data:image/png')
    setNativePreviewOwner(guest, null)
    await expect(captureOwnedPreviewContents(next, guest)).rejects.toThrow('belong')
    expect(guest.capturePage).toHaveBeenCalledTimes(2)
  } finally {
    unregister()
  }
})

test('a capture started before native ownership changes never returns pixels to the old sender', async () => {
  const { owner, guest } = ownedPreview()
  guest.getType = () => 'browserView'
  const next = { getType: () => 'window', isDestroyed: () => false }
  const capture = Promise.withResolvers<Awaited<ReturnType<typeof guest.capturePage>>>()
  guest.capturePage.mockReturnValueOnce(capture.promise)
  const unregister = registerNativePreviewGuest(guest, owner)

  try {
    const pending = captureOwnedPreviewContents(owner, guest)
    setNativePreviewOwner(guest, next)
    setNativePreviewOwner(guest, owner)
    capture.resolve({ isEmpty: () => false, toPNG: () => Buffer.from('stale') })
    await expect(pending).rejects.toThrow('belong')
  } finally {
    unregister()
  }
})

test.each([
  'destroyed owner',
  'non-window owner',
  'destroyed guest',
  'non-webview guest',
  'another owner',
  'unadmitted session'
])('captureOwnedPreviewContents refuses %s before reading pixels', async reason => {
  const { owner, guest } = ownedPreview()

  if (reason === 'destroyed owner') {
    owner.isDestroyed = () => true
  }

  if (reason === 'non-window owner') {
    owner.getType = () => 'webview'
  }

  if (reason === 'destroyed guest') {
    guest.isDestroyed = () => true
  }

  if (reason === 'non-webview guest') {
    guest.getType = () => 'window'
  }

  if (reason === 'another owner') {
    guest.hostWebContents = { getType: () => 'window', isDestroyed: () => false }
  }

  if (reason === 'unadmitted session') {
    guest.session = {} as Session
  }

  await expect(captureOwnedPreviewContents(owner, guest)).rejects.toThrow(/belong/)
  expect(guest.capturePage).not.toHaveBeenCalled()
})

test('captureOwnedPreviewContents refuses an absent guest', async () => {
  const { owner } = ownedPreview()
  await expect(captureOwnedPreviewContents(owner, undefined)).rejects.toThrow(/belong/)
})

test('normalizeCaptureRect floors origin and ceils size, never zero', () => {
  assert.deepEqual(normalizeCaptureRect({ height: 10.2, width: 0.4, x: -3.2, y: 1.8 }), {
    height: 11,
    width: 1,
    x: 0,
    y: 1
  })
})

test('mapViewportRectToImage scales CSS pixels onto a DPR bitmap and clamps', () => {
  assert.deepEqual(
    mapViewportRectToImage(
      { height: 20, width: 40, x: 10, y: 8 },
      { height: 100, width: 200 },
      { height: 200, width: 400 }
    ),
    { height: 40, width: 80, x: 20, y: 16 }
  )
  assert.equal(
    mapViewportRectToImage(
      { height: 20, width: 40, x: 500, y: 8 },
      { height: 100, width: 200 },
      { height: 200, width: 400 }
    ),
    null
  )
})

test('capturePreviewContents captures the visible page then crops in bitmap space', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  const dataUrl = await capturePreviewContents(
    {
      capturePage: async rect => {
        assert.equal(rect, undefined)

        return {
          crop: mapped => {
            assert.deepEqual(mapped, { height: 40, width: 80, x: 4, y: 8 })

            return { isEmpty: () => false, toPNG: () => png }
          },
          getSize: () => ({ height: 200, width: 400 }),
          isEmpty: () => false,
          toPNG: () => {
            throw new Error('should crop first')
          }
        }
      },
      isDestroyed: () => false
    },
    { height: 20, width: 40, x: 2, y: 4 },
    { height: 100, width: 200 }
  )

  assert.equal(dataUrl, `data:image/png;base64,${png.toString('base64')}`)
})

test('capturePreviewContents keeps the visible page when the CSS rect misses the bitmap', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  const dataUrl = await capturePreviewContents(
    {
      capturePage: async () => ({
        crop: () => {
          throw new Error('should not crop an off-screen rect')
        },
        getSize: () => ({ height: 200, width: 400 }),
        isEmpty: () => false,
        toPNG: () => png
      }),
      isDestroyed: () => false
    },
    { height: 20, width: 40, x: 10, y: 800 },
    { height: 100, width: 200 }
  )

  assert.equal(dataUrl, `data:image/png;base64,${png.toString('base64')}`)
})

test('capturePreviewContents fails closed on a destroyed guest', async () => {
  await assert.rejects(
    capturePreviewContents({
      capturePage: async () => {
        throw new Error('should not run')
      },
      isDestroyed: () => true
    }),
    /gone/
  )
})

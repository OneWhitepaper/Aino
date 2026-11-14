import type { Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { commandFocusedGuest, notePreviewGuestHidden } from './preview-guest-offscreen'
import { admitPreviewGuestSession, registerNativePreviewGuest, setNativePreviewOwner } from './preview-guest-owner'

let nextId = 1

function fakeContents(type: 'webview' | 'window' | 'browserView', hostWebContents?: unknown) {
  const history = {
    canGoBack: vi.fn(() => true),
    canGoForward: vi.fn(() => true),
    goBack: vi.fn(),
    goForward: vi.fn()
  }

  const session = {} as Session
  admitPreviewGuestSession(session)

  return {
    id: nextId++,
    hostWebContents,
    session,
    navigationHistory: history,
    reload: vi.fn(),
    getType: () => type,
    isDestroyed: () => false,
    once: vi.fn()
  }
}

type Fake = ReturnType<typeof fakeContents>
const asContents = (fake: Fake) => fake as never

describe('focused preview guest gestures', () => {
  it('follows the current native view owner and ignores a detached or unregistered view', () => {
    const host = fakeContents('window')
    const next = fakeContents('window')
    const guest = fakeContents('browserView')
    expect(commandFocusedGuest('back', asContents(guest))).toBe(false)
    const unregister = registerNativePreviewGuest(asContents(guest), asContents(host))

    try {
      notePreviewGuestHidden(asContents(host), asContents(guest), false)
      expect(commandFocusedGuest('back', asContents(guest))).toBe(true)
      setNativePreviewOwner(asContents(guest), asContents(next))
      notePreviewGuestHidden(asContents(host), asContents(guest), true)
      expect(commandFocusedGuest('back', asContents(guest))).toBe(true)
      notePreviewGuestHidden(asContents(next), asContents(guest), true)
      expect(commandFocusedGuest('back', asContents(guest))).toBe(false)
      notePreviewGuestHidden(asContents(next), asContents(guest), false)
      setNativePreviewOwner(asContents(guest), null)
      expect(commandFocusedGuest('back', asContents(guest))).toBe(false)
    } finally {
      unregister()
    }
  })

  it('navigates the focused guest its host reports on screen', () => {
    const host = fakeContents('window')
    const guest = fakeContents('webview', host)

    notePreviewGuestHidden(asContents(host), asContents(guest), false)

    expect(commandFocusedGuest('back', asContents(guest))).toBe(true)
    expect(guest.navigationHistory.goBack).toHaveBeenCalledOnce()
  })

  // A hidden session's kept Browser is still Chromium's focused webContents
  // after the switch: a mouse back on the session now on screen must not walk
  // that page's history (or reload it) — it falls through to the renderer.
  it('leaves a focused guest its host reported hidden untouched', () => {
    const host = fakeContents('window')
    const guest = fakeContents('webview', host)

    notePreviewGuestHidden(asContents(host), asContents(guest), true)

    expect(commandFocusedGuest('back', asContents(guest))).toBe(false)
    expect(commandFocusedGuest('forward', asContents(guest))).toBe(false)
    expect(commandFocusedGuest('reload', asContents(guest))).toBe(false)
    expect(guest.navigationHistory.goBack).not.toHaveBeenCalled()
    expect(guest.navigationHistory.goForward).not.toHaveBeenCalled()
    expect(guest.reload).not.toHaveBeenCalled()

    // Shown again: the user is back in it.
    notePreviewGuestHidden(asContents(host), asContents(guest), false)
    expect(commandFocusedGuest('back', asContents(guest))).toBe(true)
    expect(guest.navigationHistory.goBack).toHaveBeenCalledOnce()
  })

  it('takes visibility only from the renderer that embeds the guest', () => {
    const host = fakeContents('window')
    const stranger = fakeContents('window')
    const guest = fakeContents('webview', host)

    notePreviewGuestHidden(asContents(stranger), asContents(guest), true)

    expect(commandFocusedGuest('back', asContents(guest))).toBe(true)
  })

  it('leaves app chrome focus to the renderer', () => {
    expect(commandFocusedGuest('back', asContents(fakeContents('window')))).toBe(false)
    expect(commandFocusedGuest('back', null)).toBe(false)
  })
})

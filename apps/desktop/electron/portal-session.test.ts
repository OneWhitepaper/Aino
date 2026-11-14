import { EventEmitter } from 'node:events'

import type { BrowserWindow, Session } from 'electron'
import { expect, test, vi } from 'vitest'

import { NativeAuthChangedError } from './native-access-token'
import { createPortalSession } from './portal-session'

vi.mock('./window-renderer-lifecycle', () => ({
  installWindowRendererLifecycle: () => {}
}))

class PortalWindow extends EventEmitter {
  readonly webContents = new EventEmitter()
  readonly loadURL: ReturnType<typeof vi.fn>
  private destroyed = false

  constructor(error: Error) {
    super()
    this.loadURL = vi.fn().mockRejectedValue(error)
  }

  isDestroyed() {
    return this.destroyed
  }

  destroy() {
    this.destroyed = true
    this.emit('closed')
  }
}

function portalWithRejectedInitialLoad(error: Error) {
  const win = new PortalWindow(error)
  const cookies: { name: string; value: string }[] = []
  const session = { cookies: { get: async () => cookies } } as unknown as Session

  const portal = createPortalSession({
    isReady: () => true,
    getOauthSession: () => session,
    resolvePortalBaseUrl: () => 'https://portal.example.test',
    warmOauthCookieStore: async () => {},
    createWindow: () => win as unknown as BrowserWindow,
    rememberLog: () => {}
  })

  return { portal, win, cookies }
}

test('a superseded portal navigation stays open until the new access cookie lands', async () => {
  const error = Object.assign(new Error('ERR_ABORTED (-3) loading the portal'), { code: -3 })
  const { portal, win, cookies } = portalWithRejectedInitialLoad(error)

  const result = portal.openPortalLoginWindow().then(
    () => 'landed',
    (failure: Error) => failure.message
  )

  await vi.waitFor(() => expect(win.loadURL).toHaveBeenCalledOnce())
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(win.isDestroyed()).toBe(false)

  cookies.push({ name: 'nas-session', value: 'new-access' })
  win.webContents.emit('did-redirect-navigation')

  expect(await result).toBe('landed')
  expect(win.isDestroyed()).toBe(true)
})

test('a real portal load failure still ends sign-in', async () => {
  const error = Object.assign(new Error('ERR_FAILED (-2) loading the portal'), { code: -2 })
  const { portal, win } = portalWithRejectedInitialLoad(error)

  await expect(portal.openPortalLoginWindow()).rejects.toThrow(error.message)
  expect(win.isDestroyed()).toBe(true)
})

test('retirement during a cookie read cannot create a late login window in the next account', async () => {
  let releaseCookies!: (cookies: { name: string; value: string }[]) => void

  const oldRead = new Promise<{ name: string; value: string }[]>(resolve => {
    releaseCookies = resolve
  })

  let session = { cookies: { get: () => oldRead } } as unknown as Session
  const createWindow = vi.fn()

  const portal = createPortalSession({
    isReady: () => true,
    getOauthSession: () => session,
    resolvePortalBaseUrl: () => 'https://portal.example.test',
    warmOauthCookieStore: async () => {},
    createWindow,
    rememberLog: () => {}
  })

  const old = portal.openPortalLoginWindow()
  const rejection = expect(old).rejects.toBeInstanceOf(NativeAuthChangedError)
  portal.retire()
  session = { cookies: { get: async () => [{ name: 'nas-session', value: 'other-account' }] } } as unknown as Session
  portal.retire()
  releaseCookies([])
  await rejection
  expect(createWindow).not.toHaveBeenCalled()
})

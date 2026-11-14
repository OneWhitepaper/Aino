import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'

import type { BrowserWindow, IpcMain, Session, WebContents, WebContentsView } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { NativePreviewMountRequest, NativePreviewSnapshot } from '../shared/preview-native'

import { admitPreviewGuestSession, isOwnedPreviewGuest } from './preview-guest-owner'
import { authorizeNativePreviewPopout, registerNativePreviewIpc } from './preview-native'

const websiteDialog = vi.hoisted(() => ({ pending: false }))
vi.mock('./preview-browser-interactions', () => ({
  assertPreviewBrowserDialogResolved: () => {
    if (websiteDialog.pending) {
      throw new Error('Resolve the website dialog before moving this Browser tab')
    }
  }
}))

class Contents extends EventEmitter {
  static nextId = 1
  id = Contents.nextId++
  destroyed = false
  url = ''
  state = { unsaved: 'Draft text', scroll: 817, script: Math.random(), route: '/one' }
  session = {} as Session
  getType = () => this.kind
  isDestroyed = () => this.destroyed
  getURL = () => this.url
  getTitle = () => 'Retained page'
  isLoadingMainFrame = vi.fn(() => false)
  zoom = 1
  viewportWidth = 600
  contentWidth = 0
  guestWindow: { __hermesAnnotate?: { teardown: () => void } | null; __hermesAnnotateSession?: number } = {}
  executeJavaScript = vi.fn(async (code: string) =>
    runInNewContext(code, {
      window: this.guestWindow,
      innerWidth: this.viewportWidth / this.zoom,
      document: {
        documentElement: { scrollWidth: Math.max(this.contentWidth, this.viewportWidth / this.zoom) },
        body: null
      }
    })
  )
  getZoomFactor = () => this.zoom
  setZoomFactor = vi.fn((factor: number) => {
    this.zoom = factor
  })
  setZoomMode = vi.fn()
  isAudioMuted = () => false
  send = vi.fn()
  sendInputEvent = vi.fn()
  focus = vi.fn()
  navigationHistory = {
    canGoBack: () => true,
    canGoForward: () => false,
    goBack: vi.fn(),
    goForward: vi.fn()
  }
  loadURL = vi.fn(async (url: string) => {
    this.url = url
  })
  close = vi.fn(() => {
    this.destroyed = true
    this.emit('destroyed')
  })

  constructor(private kind = 'window') {
    super()
  }
}

class View {
  webContents = new Contents('browserView')
  bounds = { x: 0, y: 0, width: 0, height: 0 }
  visible = false
  setBounds = (bounds: typeof this.bounds) => {
    this.bounds = bounds
    this.webContents.viewportWidth = bounds.width
  }
  setVisible = (visible: boolean) => {
    this.visible = visible
  }
}

class Window extends EventEmitter {
  webContents = new Contents()
  views = new Set<View>()
  isDestroyed = () => this.webContents.destroyed
  getContentSize = () => [1200, 800]
  contentView = {
    addChildView: (view: View) => {
      this.views.add(view)
    },
    removeChildView: (view: View) => {
      this.views.delete(view)
    }
  }
  close = () => {
    const event = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      }
    }
    this.emit('close', event)

    if (!event.defaultPrevented) {
      this.webContents.close()
    }
  }
}

const bounds = { x: 400, y: 80, width: 600, height: 600 }

const request: NativePreviewMountRequest = {
  tabId: 'tab-one',
  partition: 'persist:hermes-preview-worker',
  url: 'https://example.com/start',
  bounds
}

let source: Window
let popup: Window
let foreign: Window
let created: View[]
let handlers: Map<string, (...args: any[]) => any>
let sends: Map<string, (...args: any[]) => any>
let dispose: () => void
let windows: Window[]

const invoke = (name: string, owner: Window, ...args: unknown[]) =>
  handlers.get(`hermes:preview-native:${name}`)!({ sender: owner.webContents }, ...args)
const send = (name: string, owner: Window, ...args: unknown[]) =>
  sends.get(`hermes:preview-native:${name}`)!({ sender: owner.webContents }, ...args)
const mount = (owner: Window, options = request): NativePreviewSnapshot => invoke('mount', owner, options)
const authorize = () =>
  authorizeNativePreviewPopout(
    source.webContents as unknown as WebContents,
    popup as unknown as BrowserWindow,
    request.tabId
  )

beforeEach(() => {
  vi.useFakeTimers()
  websiteDialog.pending = false
  source = new Window()
  popup = new Window()
  foreign = new Window()
  created = []
  handlers = new Map()
  sends = new Map()
  windows = [source, popup, foreign]
  dispose = registerNativePreviewIpc(
    {
      handle: (name, handler) => handlers.set(name, handler),
      on: (name, handler) => {
        sends.set(name, handler)
      }
    } as unknown as IpcMain,
    {
      fromWebContents: contents =>
        windows.find(window => window.webContents === (contents as unknown as Contents)) as unknown as BrowserWindow,
      resolvePartition: partition => partition + '-account-A',
      createView: () => {
        const view = new View()
        admitPreviewGuestSession(view.webContents.session)
        created.push(view)

        return view as unknown as WebContentsView
      }
    }
  )
})

afterEach(() => {
  dispose()
  vi.useRealTimers()
})

it('keeps a pending website dialog and its page attached when pop-out is requested', () => {
  const first = mount(source)
  websiteDialog.pending = true
  expect(authorize).toThrow('Resolve the website dialog')
  expect(created[0].webContents.close).not.toHaveBeenCalled()
  expect(() => invoke('command', source, first.token, 'focus', [])).not.toThrow()
  websiteDialog.pending = false
  expect(authorize).not.toThrow()
})

it('waits for the website dialog before a popped-out page can close back to its source', () => {
  const first = mount(source)
  authorize()
  const popped = mount(popup)
  websiteDialog.pending = true
  popup.close()
  expect(popup.webContents.isDestroyed()).toBe(false)
  expect(() => invoke('command', popup, popped.token, 'focus', [])).not.toThrow()
  expect(created[0].webContents.close).not.toHaveBeenCalled()
  websiteDialog.pending = false
  popup.close()
  expect(popup.webContents.isDestroyed()).toBe(true)
  expect(mount(source).webContentsId).toBe(first.webContentsId)
})

it('keeps the unchanged page usable when a navigation becomes a download, without readying a newly committed document', () => {
  mount(source)
  const guest = created[0].webContents
  guest.emit('did-start-navigation', {}, 'https://example.com/early-download', false, true)
  guest.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/early-download', true)
  guest.emit('did-stop-loading')
  expect(source.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({ snapshot: expect.objectContaining({ ready: false }) })
  )
  guest.emit('dom-ready')
  guest.emit('did-start-navigation', {}, 'https://example.com/report.txt', false, true)
  guest.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/report.txt', true)
  guest.emit('did-stop-loading')
  expect(source.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({ snapshot: expect.objectContaining({ ready: true, loadFailure: undefined }) })
  )
  guest.emit('did-start-navigation', {}, 'https://example.com/new-document', false, true)
  guest.url = 'https://example.com/new-document'
  guest.emit('did-navigate', {}, guest.url)
  guest.emit('did-stop-loading')
  expect(source.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({ snapshot: expect.objectContaining({ ready: false }) })
  )
  guest.emit('dom-ready')
  expect(source.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({ snapshot: expect.objectContaining({ ready: true }) })
  )
  guest.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: guest.url + '#draft' })
  expect(source.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({ snapshot: expect.objectContaining({ ready: true }) })
  )
  guest.isLoadingMainFrame.mockReturnValue(true)
  guest.emit('did-stop-loading')
  expect(source.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({ snapshot: expect.objectContaining({ ready: false }) })
  )
  guest.isLoadingMainFrame.mockReturnValue(false)
  guest.emit('did-fail-load', {}, -118, 'ERR_CONNECTION_TIMED_OUT', 'https://example.com/failed', true)
  guest.emit('did-stop-loading')
  expect(source.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({
      snapshot: expect.objectContaining({ ready: false, loadFailure: expect.objectContaining({ code: -118 }) })
    })
  )
})

it('moves one page through pop-out and close-to-dock without loading the saved URL or losing live state', () => {
  const first = mount(source)
  const view = created[0]
  const state = view.webContents.state
  view.webContents.url = 'https://example.com/live#unsaved'
  view.webContents.emit('dom-ready')
  authorize()
  invoke('release', source, first.token)
  expect(view.webContents.close).not.toHaveBeenCalled()

  const popped = mount(popup, { ...request, partition: 'persist:hermes-preview' })
  expect(popped.webContentsId).toBe(first.webContentsId)
  expect(popped.url).toBe('https://example.com/live#unsaved')
  expect(popped.ready).toBe(true)
  expect(created).toHaveLength(1)
  expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
  expect(view.webContents.state).toBe(state)
  expect(source.views.size).toBe(0)
  expect(popup.views.has(view)).toBe(true)
  expect(isOwnedPreviewGuest(popup.webContents, view.webContents)).toBe(true)
  expect(isOwnedPreviewGuest(source.webContents, view.webContents)).toBe(false)

  invoke('release', source, first.token)
  send('layout', source, first.token, bounds, false)
  expect(view.visible).toBe(true)
  expect(() => invoke('command', source, first.token, 'sendInputEvent', [{ type: 'char', keyCode: 'x' }])).toThrow(
    'does not belong'
  )
  state.unsaved = 'Edited in popup'
  popup.close()
  expect(view.webContents.close).not.toHaveBeenCalled()
  expect(popup.views.size).toBe(0)
  // The person may stay in another chat before revisiting this tab.
  vi.advanceTimersByTime(60_001)
  expect(view.webContents.close).not.toHaveBeenCalled()

  const docked = mount(source)
  expect(docked.webContentsId).toBe(first.webContentsId)
  expect(view.webContents.state).toBe(state)
  expect(view.webContents.state.unsaved).toBe('Edited in popup')
  expect(view.webContents.loadURL).toHaveBeenCalledTimes(1)
  expect(source.views.has(view)).toBe(true)
  expect(isOwnedPreviewGuest(source.webContents, view.webContents)).toBe(true)
  invoke('release', popup, popped.token)
  expect(view.webContents.close).not.toHaveBeenCalled()
})

it('fits an overflowing desktop document and preserves explicit page zoom through the same-page pop-out', async () => {
  const first = mount(source)
  const guest = created[0].webContents
  guest.contentWidth = 1000
  guest.emit('dom-ready')
  await Promise.resolve()
  await Promise.resolve()
  expect(guest.zoom).toBeCloseTo(0.6)
  expect(guest.setZoomMode).toHaveBeenCalledWith('isolated')
  expect(source.webContents.send).toHaveBeenCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({
      type: 'page-zoom-changed',
      snapshot: expect.objectContaining({ zoom: 0.6, zoomMode: 'fit' })
    })
  )

  await invoke('command', source, first.token, 'setPageZoom', [1.25])
  const state = guest.state
  authorize()
  invoke('release', source, first.token)
  const moved = mount(popup)
  expect(moved).toMatchObject({ webContentsId: guest.id, zoom: 1.25, zoomMode: 'manual' })
  send('layout', popup, moved.token, { ...bounds, width: 900 }, true)
  expect(guest.zoom).toBe(1.25)
  expect(guest.state).toBe(state)
  expect(guest.loadURL).toHaveBeenCalledOnce()
})

it('keeps a responsive document at actual size and rejects invalid zoom commands without changing it', async () => {
  const first = mount(source)
  const guest = created[0].webContents
  guest.emit('dom-ready')
  await Promise.resolve()
  await Promise.resolve()
  expect(guest.zoom).toBe(1)
  expect(() => invoke('command', source, first.token, 'setPageZoom', [NaN])).toThrow('zoom')
  expect(() => invoke('command', source, first.token, 'setPageZoom', ['javascript:1'])).toThrow('zoom')
  expect(guest.zoom).toBe(1)
})

it('rejects window, profile, token and unrelated-tab theft while allowing only the authorized popup', () => {
  const first = mount(source)
  expect(() => mount(foreign)).toThrow('belongs to another')
  expect(() => mount(source, { ...request, partition: 'persist:hermes-preview-other' })).toThrow('belongs to another')
  expect(() => invoke('command', foreign, first.token, 'focus', [])).toThrow('does not belong')
  authorize()
  expect(() => mount(popup, { ...request, tabId: 'another-tab' })).toThrow('different tab')
  const moved = mount(popup)
  expect(moved.token).not.toBe(first.token)
  expect(() => mount(source)).toThrow('belongs to another')
  expect(() => invoke('command', popup, moved.token, 'executeJavaScript', ['alert(1)'])).toThrow('Unsupported')
  expect(() => invoke('command', popup, moved.token, 'loadURL', ['javascript:alert(1)'])).toThrow('script-bearing')
})

it('bounds abandoned handoffs, normal releases and account renderer reloads without retaining guests', () => {
  const first = mount(source)
  invoke('release', source, first.token)
  expect(created[0].webContents.close).toHaveBeenCalledOnce()
  const pending = mount(source)
  authorize()
  invoke('release', source, pending.token)
  vi.advanceTimersByTime(30_001)
  expect(created[1].webContents.close).not.toHaveBeenCalled()
  expect(source.webContents.send).toHaveBeenLastCalledWith('hermes:browser-popout:closed', request.tabId)
  const recovered = mount(source)
  expect(recovered.webContentsId).toBe(created[1].webContents.id)
  invoke('release', source, recovered.token)
  expect(created[1].webContents.close).toHaveBeenCalledOnce()

  mount(source)
  authorizeNativePreviewPopout(
    source.webContents as unknown as WebContents,
    foreign as unknown as BrowserWindow,
    request.tabId
  )
  mount(foreign)
  source.webContents.emit('did-start-navigation', { isMainFrame: true, isInPlace: false })
  expect(created[2].webContents.close).toHaveBeenCalledOnce()
  expect(foreign.views.size).toBe(0)
})

it('routes live events to the current owner and releases held input when hidden or moved', () => {
  const first = mount(source)
  const view = created[0]
  invoke('command', source, first.token, 'sendInputEvent', [{ type: 'keyDown', keyCode: 'Shift' }])
  send('layout', source, first.token, bounds, false)
  expect(view.webContents.sendInputEvent).toHaveBeenLastCalledWith({ type: 'keyUp', keyCode: 'Shift' })
  expect(() => invoke('command', source, first.token, 'sendInputEvent', [{ type: 'char', keyCode: 'x' }])).toThrow(
    'hidden'
  )
  authorize()
  mount(popup)
  source.webContents.send.mockClear()
  popup.webContents.send.mockClear()
  view.webContents.emit('context-menu', {}, { x: 10, y: 20 })
  expect(popup.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({ type: 'context-menu', params: expect.objectContaining({ x: 410, y: 100 }) })
  )
  expect(source.webContents.send).not.toHaveBeenCalled()
  view.webContents.emit('ipc-message', {}, 'hermes:preview-native:external', 'preview-open-external', [
    'file:///etc/passwd'
  ])
  expect(popup.webContents.send).toHaveBeenCalledTimes(1)
  view.webContents.emit('ipc-message', {}, 'hermes:preview-native:external', 'preview-open-external', [
    'https://example.com/new'
  ])
  expect(popup.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({
      type: 'ipc-message',
      channel: 'preview-open-external',
      args: ['https://example.com/new']
    })
  )
})

it('defers native focus until an overlay-hidden page is visible again', () => {
  const first = mount(source)
  const view = created[0]
  const focusedVisibility: boolean[] = []
  view.webContents.focus.mockImplementation(() => {
    focusedVisibility.push(view.visible)
  })
  send('layout', source, first.token, bounds, false)

  invoke('command', source, first.token, 'focus', [])
  send('layout', source, first.token, bounds, false)
  expect(view.webContents.focus).not.toHaveBeenCalled()

  send('layout', source, first.token, bounds, true)
  expect(focusedVisibility).toEqual([true])
  send('layout', source, first.token, { ...bounds, width: 500 }, true)
  expect(view.webContents.focus).toHaveBeenCalledOnce()
})

it('retires pending focus when a hidden page moves to a different window', () => {
  const first = mount(source)
  const view = created[0]
  send('layout', source, first.token, bounds, false)
  invoke('command', source, first.token, 'focus', [])
  view.webContents.focus.mockClear()

  authorize()
  const moved = mount(popup)
  send('layout', source, first.token, bounds, true)
  send('layout', popup, moved.token, bounds, true)
  expect(view.webContents.focus).not.toHaveBeenCalled()
  invoke('command', popup, moved.token, 'focus', [])
  expect(view.webContents.focus).toHaveBeenCalledOnce()
})

it('retains a failed main-frame load across transfer and clears it only on a new main-frame navigation', () => {
  mount(source)
  const view = created[0]
  view.webContents.emit('did-fail-load', {}, -118, 'ERR_CONNECTION_TIMED_OUT', 'https://example.com/unreachable', true)
  view.webContents.emit('dom-ready')
  authorize()
  const moved = mount(popup)
  expect(moved.ready).toBe(false)
  expect(moved.loadFailure).toEqual({
    code: -118,
    description: 'ERR_CONNECTION_TIMED_OUT',
    url: 'https://example.com/unreachable'
  })
  view.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/unreachable', true)
  view.webContents.emit('did-start-navigation', { isMainFrame: false, isInPlace: false })
  expect(popup.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({ snapshot: expect.objectContaining({ loadFailure: moved.loadFailure }) })
  )
  view.webContents.emit('did-start-navigation', { isMainFrame: true, isInPlace: false })
  view.webContents.emit('dom-ready')
  expect(popup.webContents.send).toHaveBeenLastCalledWith(
    'hermes:preview-native:event',
    expect.objectContaining({ snapshot: expect.objectContaining({ ready: true, loadFailure: undefined }) })
  )
})

it('caps parked tabs by the shared retention limit and closes a parked tab only for its source', () => {
  const ids: string[] = []

  for (let index = 0; index < 9; index++) {
    const options = { ...request, tabId: `parked-${index}` }
    const destination = new Window()
    windows.push(destination)
    mount(source, options)
    ids.push(options.tabId)
    authorizeNativePreviewPopout(
      source.webContents as unknown as WebContents,
      destination as unknown as BrowserWindow,
      options.tabId
    )
    mount(destination, options)
    destination.close()
  }

  expect(created[0].webContents.close).toHaveBeenCalledOnce()

  for (const view of created.slice(1)) {
    expect(view.webContents.close).not.toHaveBeenCalled()
  }
  vi.advanceTimersByTime(120_000)
  expect(created[1].webContents.close).not.toHaveBeenCalled()
  expect(() => invoke('closeTab', foreign, ids[1])).toThrow('Cannot close')
  invoke('closeTab', source, ids[1])
  expect(created[1].webContents.close).toHaveBeenCalledOnce()
  const returned = mount(source, { ...request, tabId: ids[2] })
  expect(returned.webContentsId).toBe(created[2].webContents.id)
  expect(created).toHaveLength(9)
})

it('keeps an active popup when its source window closes and disposes the orphan when that popup closes', () => {
  mount(source)
  authorize()
  const moved = mount(popup)
  const view = created[0]
  source.close()
  expect(view.webContents.close).not.toHaveBeenCalled()
  expect(() => invoke('command', popup, moved.token, 'focus', [])).not.toThrow()
  popup.close()
  expect(view.webContents.close).toHaveBeenCalledOnce()
})

it('retires old annotation overlays and session counters after cancelling the old owner, without changing the page', () => {
  const first = mount(source)
  const guest = created[0].webContents
  const state = guest.state

  const teardown = vi.fn(() => {
    expect(isOwnedPreviewGuest(source.webContents, guest)).toBe(false)
  })

  guest.guestWindow = { __hermesAnnotate: { teardown }, __hermesAnnotateSession: 99 }
  guest.emit('dom-ready')
  authorize()
  invoke('release', source, first.token)
  mount(popup)
  expect(teardown).toHaveBeenCalledOnce()
  expect(guest.guestWindow.__hermesAnnotate).toBeNull()
  expect(guest.guestWindow.__hermesAnnotateSession).toBe(0)
  expect(guest.state).toBe(state)
  expect(guest.state.unsaved).toBe('Draft text')
})

it('does not queue an annotation teardown into a loading replacement document', () => {
  mount(source)
  const guest = created[0].webContents
  guest.emit('dom-ready')
  guest.executeJavaScript.mockClear()
  guest.isLoadingMainFrame.mockReturnValue(true)
  authorize()
  mount(popup)
  expect(guest.executeJavaScript).not.toHaveBeenCalled()
})

it('arms initial native page observation before loading a page that may open a dialog', async () => {
  dispose()
  let ready!: () => void
  const preparation = new Promise<void>(resolve => {
    ready = resolve
  })
  const prepare = vi.fn(() => preparation)
  dispose = registerNativePreviewIpc(
    {
      handle: (name, handler) => handlers.set(name, handler),
      on: (name, handler) => {
        sends.set(name, handler)
      }
    } as unknown as IpcMain,
    {
      fromWebContents: () => source as unknown as BrowserWindow,
      resolvePartition: partition => partition,
      createView: () => {
        const view = new View()
        admitPreviewGuestSession(view.webContents.session)
        created.push(view)

        return view as unknown as WebContentsView
      },
      preparePage: prepare
    }
  )
  mount(source)
  const guest = created[0].webContents
  expect(prepare).toHaveBeenCalledWith(source.webContents, guest, request.tabId)
  expect(guest.loadURL).not.toHaveBeenCalled()
  ready()
  await preparation
  await Promise.resolve()
  expect(guest.loadURL).toHaveBeenCalledWith(request.url)
})

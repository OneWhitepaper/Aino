/** One native page per Browser tab; windows move the view instead of reloading its URL. */
import { randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'

import type { BrowserWindow, IpcMain, WebContents, WebContentsView } from 'electron'

import { NATIVE_PREVIEW_RETAIN_LIMIT } from '../shared/preview-native'
import type {
  NativePreviewBounds,
  NativePreviewEvent,
  NativePreviewMountRequest,
  NativePreviewSnapshot
} from '../shared/preview-native'

import { assertPreviewBrowserDialogResolved } from './preview-browser-interactions'
import { registerNativePreviewGuest, setNativePreviewOwner } from './preview-guest-owner'
import { GUEST_EXTERNAL_CHANNEL } from './preview-guest-preload'
import { hasPreviewGuestApproval, isPreviewPartition } from './preview-guest-throttle'
import { createPreviewPageZoom, type PreviewPageZoom } from './preview-page-zoom'

const PREFIX = 'hermes:preview-native:'
const HANDOFF_MS = 30_000

// The annotation UI belongs to the renderer being retired, not to the persistent webpage.
const RETIRE_ANNOTATIONS = `(() => {
  if (window.__hermesAnnotate?.teardown) window.__hermesAnnotate.teardown();
  window.__hermesAnnotate = null;
  window.__hermesAnnotateSession = 0;
})()`

interface NativePreviewDeps {
  fromWebContents: (sender: WebContents) => BrowserWindow | null
  createView: (partition: string) => WebContentsView
  resolvePartition: (partition: string) => string
  preparePage?: (owner: WebContents, guest: WebContents, tabId: string) => Promise<void>
}

interface NativePage {
  tabId: string
  partition: string
  view: WebContentsView
  source: WebContents | null
  owner: WebContents | null
  window: BrowserWindow | null
  popup: BrowserWindow | null
  token: string
  ready: boolean
  loadFailure?: { code?: number; description: string; url: string }
  bounds: NativePreviewBounds
  awaitingPopup: boolean
  parkedAt: number
  visible: boolean
  focusPending: boolean
  zoom: PreviewPageZoom
  pressed: Map<string, NativeInput>
  timer?: ReturnType<typeof setTimeout>
  cleanups: Array<() => void>
  unregister: () => void
}

let nativeService: NativePreviewService | undefined

function browserUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32_768) {
    throw new Error('Invalid Browser URL')
  }

  const url = new URL(value)

  // Match the existing address bar: navigation is not a script injection API.
  if (url.protocol === 'javascript:' || url.protocol === 'data:') {
    throw new Error('The Browser does not accept script-bearing URLs')
  }

  return url.href
}

function validBounds(value: NativePreviewBounds, window: BrowserWindow): NativePreviewBounds {
  if (!value || ![value.x, value.y, value.width, value.height].every(Number.isFinite)) {
    throw new Error('Invalid native Browser bounds')
  }

  const [width, height] = window.getContentSize()
  const x = Math.max(0, Math.min(width, Math.round(value.x)))
  const y = Math.max(0, Math.min(height, Math.round(value.y)))

  return {
    x,
    y,
    width: Math.max(0, Math.min(width - x, Math.round(value.width))),
    height: Math.max(0, Math.min(height - y, Math.round(value.height)))
  }
}

function snapshot(page: NativePage): NativePreviewSnapshot {
  const guest = page.view.webContents

  return {
    token: page.token,
    webContentsId: guest.id,
    url: guest.getURL(),
    title: guest.getTitle(),
    back: guest.navigationHistory.canGoBack(),
    forward: guest.navigationHistory.canGoForward(),
    loading: guest.isLoadingMainFrame(),
    ready: page.ready,
    loadFailure: page.loadFailure,
    zoom: guest.getZoomFactor(),
    zoomMode: page.zoom.mode,
    muted: guest.isAudioMuted()
  }
}

function guestContext(params: Electron.ContextMenuParams, bounds: NativePreviewBounds): Record<string, unknown> {
  return {
    x: params.x + bounds.x,
    y: params.y + bounds.y,
    dictionarySuggestions: params.dictionarySuggestions,
    editFlags: params.editFlags,
    hasImageContents: params.hasImageContents,
    isEditable: params.isEditable,
    linkURL: params.linkURL,
    misspelledWord: params.misspelledWord,
    selectionText: params.selectionText,
    srcURL: params.srcURL
  }
}

function retireAnnotations(page: NativePage): void {
  const guest = page.view.webContents

  if (!page.owner || !page.ready || guest.isDestroyed() || guest.isLoadingMainFrame()) {
    return
  }

  // Queue before any new-owner script on this same WebContents. Do not await a loading
  // document: its replacement must never inherit an old renderer's deferred cleanup.
  // Navigation/destruction can retire the fixed cleanup before it executes.
  void guest.executeJavaScript(RETIRE_ANNOTATIONS).catch(() => undefined)
}

function finiteArgument(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Invalid native Browser coordinate')
  }

  return Math.round(value)
}

type NativeInput = Electron.KeyboardInputEvent | Electron.MouseInputEvent | Electron.MouseWheelInputEvent

function nativeInput(value: unknown): NativeInput {
  const event = value as NativeInput
  const allowed = new Set(['mouseMove', 'mouseDown', 'mouseUp', 'mouseWheel', 'keyDown', 'keyUp', 'char'])

  if (!event || typeof event !== 'object' || !allowed.has(event.type)) {
    throw new Error('Invalid native Browser input event')
  }

  return event
}

function releaseInputs(page: NativePage): void {
  const guest = page.view.webContents

  if (!guest.isDestroyed()) {
    for (const event of page.pressed.values()) {
      guest.sendInputEvent({ ...event, type: event.type === 'keyDown' ? 'keyUp' : 'mouseUp' } as NativeInput)
    }
  }

  page.pressed.clear()
}

function dispatchInput(page: NativePage, value: unknown): void {
  if (!page.visible) {
    throw new Error('Native Browser is hidden')
  }

  const event = nativeInput(value)
  const key = 'keyCode' in event ? `key:${event.keyCode}` : `mouse:${'button' in event ? event.button : 'left'}`
  page.view.webContents.sendInputEvent(event)

  if (event.type === 'keyDown' || event.type === 'mouseDown') {
    page.pressed.set(key, event)
  } else if (event.type === 'keyUp' || event.type === 'mouseUp') {
    page.pressed.delete(key)
  }
}

function focusPage(page: NativePage): void {
  // Renderer menus hide the native child; focus can return only after layout exposes it.
  page.focusPending = !page.visible

  if (page.visible) {
    page.view.webContents.focus()
  }
}

const commands: Record<string, (guest: WebContents, args: unknown[], page: NativePage) => unknown> = {
  loadURL: (guest, args) => guest.loadURL(browserUrl(args[0])),
  reload: guest => guest.reload(),
  reloadIgnoringCache: guest => guest.reloadIgnoringCache(),
  goBack: guest => guest.navigationHistory.canGoBack() && guest.navigationHistory.goBack(),
  goForward: guest => guest.navigationHistory.canGoForward() && guest.navigationHistory.goForward(),
  focus: (_guest, _args, page) => focusPage(page),
  sendInputEvent: (_guest, args, page) => dispatchInput(page, args[0]),
  openDevTools: guest => guest.openDevTools({ mode: 'detach' }),
  closeDevTools: guest => guest.closeDevTools(),
  copy: guest => guest.copy(),
  cut: guest => guest.cut(),
  paste: guest => guest.paste(),
  selectAll: guest => guest.selectAll(),
  inspectElement: (guest, args) => guest.inspectElement(finiteArgument(args[0]), finiteArgument(args[1])),
  replaceMisspelling: (guest, args) => guest.replaceMisspelling(String(args[0] ?? '').slice(0, 1024)),
  setAudioMuted: (guest, args) => guest.setAudioMuted(args[0] === true),
  setPageZoom: (_guest, args, page) => page.zoom.set(args[0])
}

class NativePreviewService {
  private pages = new Map<string, NativePage>()
  private tokens = new Map<string, NativePage>()
  private popupTabs = new WeakMap<WebContents, string>()
  private parkSequence = 0

  constructor(private deps: NativePreviewDeps) {}

  private host(sender: WebContents): BrowserWindow {
    const window = this.deps.fromWebContents(sender)

    if (sender.isDestroyed() || sender.getType() !== 'window' || !window || window.isDestroyed()) {
      throw new Error('Native Browser owner is not a live desktop window')
    }

    return window
  }

  private live(sender: WebContents, token: unknown): NativePage {
    const page = typeof token === 'string' ? this.tokens.get(token) : undefined

    if (!page || page.owner !== sender || sender.isDestroyed() || page.view.webContents.isDestroyed()) {
      throw new Error('Native Browser attachment does not belong to this window')
    }

    return page
  }

  private emit(page: NativePage, type: string, detail: Record<string, unknown> = {}): void {
    if (!page.owner || page.owner.isDestroyed() || page.view.webContents.isDestroyed()) {
      return
    }

    page.owner.send(PREFIX + 'event', {
      ...detail,
      token: page.token,
      type,
      snapshot: snapshot(page)
    } satisfies NativePreviewEvent)
  }

  private listen(page: NativePage, emitter: EventEmitter, type: string, handler: (...args: any[]) => void): () => void {
    emitter.on(type, handler)

    const cleanup = () => {
      emitter.removeListener(type, handler)
      const index = page.cleanups.indexOf(cleanup)

      if (index >= 0) {
        page.cleanups.splice(index, 1)
      }
    }

    page.cleanups.push(cleanup)

    return cleanup
  }

  private watchGuest(page: NativePage): void {
    const guest = page.view.webContents
    let documentReady = false
    const events = ['did-start-loading', 'devtools-opened', 'devtools-closed']

    for (const type of events) {
      this.listen(page, guest, type, () => this.emit(page, type))
    }

    this.listen(page, guest, 'dom-ready', () => {
      documentReady = !page.loadFailure
      page.ready = documentReady
      this.emit(page, 'dom-ready')
      void page.zoom.refresh()
    })
    this.listen(page, guest, 'did-stop-loading', () => {
      // A download aborts only the provisional navigation; the existing document stays usable.
      page.ready = documentReady && !page.loadFailure && !guest.isLoadingMainFrame()
      this.emit(page, 'did-stop-loading')
      void page.zoom.refresh()
    })
    this.listen(page, guest, 'did-finish-load', () => {
      void page.zoom.refresh()
    })
    this.listen(page, guest, 'page-title-updated', (_event, title) => this.emit(page, 'page-title-updated', { title }))
    this.listen(page, guest, 'did-start-navigation', (event, url, isInPlace, isMainFrame) => {
      const detail = {
        url: event.url ?? url,
        isInPlace: event.isSameDocument ?? event.isInPlace ?? isInPlace,
        isMainFrame: event.isMainFrame ?? isMainFrame
      }

      if (detail.isMainFrame) {
        page.zoom.invalidate()
        page.loadFailure = undefined
        page.ready = detail.isInPlace === true
      }

      this.emit(page, 'did-start-navigation', detail)
    })
    this.listen(page, guest, 'did-navigate', (_event, url) => {
      documentReady = false
      page.zoom.invalidate(true)
      this.emit(page, 'did-navigate', { url })
    })
    this.listen(page, guest, 'did-navigate-in-page', (_event, url, isMainFrame) => {
      this.emit(page, 'did-navigate-in-page', { url, isMainFrame })

      if (isMainFrame !== false) {
        page.zoom.invalidate(true)
        void page.zoom.refresh()
      }
    })
    this.listen(page, guest, 'did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame !== false && errorCode !== -3) {
        documentReady = false
        page.ready = false
        page.zoom.invalidate(true)
        page.loadFailure = {
          code: errorCode,
          description: errorDescription || 'Page could not be loaded',
          url: validatedURL || guest.getURL()
        }
      }

      this.emit(page, 'did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame })
    })
    this.listen(page, guest, 'console-message', (event, level, message, line, sourceId) =>
      this.emit(page, 'console-message', {
        level: level ?? event.level,
        message: event.message ?? message,
        line: event.lineNumber ?? line,
        sourceId: event.sourceId ?? sourceId
      })
    )
    this.listen(page, guest, 'context-menu', (_event, params) =>
      this.emit(page, 'context-menu', { params: guestContext(params, page.bounds) })
    )
    this.listen(page, guest, 'ipc-message', (_event, channel, ...args) => {
      if (channel === PREFIX + 'external') {
        this.external(page, args[0], args[1])
      }
    })
    this.listen(page, guest, 'render-process-gone', (_event, details) =>
      this.emit(page, 'render-process-gone', details)
    )
    this.listen(page, guest, 'destroyed', () => this.disposePage(page))
  }

  private watchSource(page: NativePage, source: WebContents): void {
    this.listen(page, source, 'destroyed', () => {
      page.source = null

      if (!page.owner || page.owner === source) {
        this.disposePage(page)
      }
    })
    this.listen(page, source, 'did-start-navigation', (event, _url, isInPlace, isMainFrame) => {
      if ((event.isMainFrame ?? isMainFrame) && !(event.isInPlace ?? isInPlace)) {
        this.disposePage(page)
      }
    })
    this.listen(page, source, 'render-process-gone', () => this.disposePage(page))
  }

  private detach(page: NativePage): void {
    page.zoom.invalidate()
    page.focusPending = false
    releaseInputs(page)
    this.tokens.delete(page.token)
    setNativePreviewOwner(page.view.webContents, null)
    retireAnnotations(page)

    if (page.window && !page.window.isDestroyed()) {
      page.window.contentView.removeChildView(page.view)
    }

    page.view.setVisible(false)
    page.visible = false
    page.owner = null
    page.window = null
  }

  private park(page: NativePage): void {
    this.detach(page)
    clearTimeout(page.timer)
    page.parkedAt = ++this.parkSequence

    const parked = [...this.pages.values()]
      .filter(candidate => candidate.source === page.source && candidate.parkedAt > 0 && !candidate.owner)
      .sort((first, second) => first.parkedAt - second.parkedAt)

    for (const stale of parked.slice(0, -NATIVE_PREVIEW_RETAIN_LIMIT)) {
      this.disposePage(stale)
    }
  }

  private armHandoff(page: NativePage): void {
    clearTimeout(page.timer)
    page.timer = setTimeout(() => {
      if (page.awaitingPopup) {
        this.recoverPopout(page)
      }
    }, HANDOFF_MS)
    page.timer.unref?.()
  }

  private recoverPopout(page: NativePage): void {
    const popup = page.popup
    page.awaitingPopup = false
    page.popup = null

    if (popup && !popup.isDestroyed()) {
      popup.close()
    }

    if (!page.source || page.source.isDestroyed()) {
      this.disposePage(page)

      return
    }

    if (!page.owner) {
      this.park(page)
    }

    // Another chat may be active; park under the same retention cap until revisited.
    page.source.send('hermes:browser-popout:closed', page.tabId)
  }

  private disposePage(page: NativePage): void {
    if (this.pages.get(page.tabId) !== page) {
      return
    }

    this.pages.delete(page.tabId)
    page.zoom.dispose()
    clearTimeout(page.timer)
    this.emit(page, 'destroyed')
    this.detach(page)
    page.cleanups.splice(0).forEach(cleanup => cleanup())
    page.unregister()

    if (!page.view.webContents.isDestroyed()) {
      page.view.webContents.close()
    }

    if (page.popup && !page.popup.isDestroyed()) {
      page.popup.close()
    }
  }

  private create(sender: WebContents, request: NativePreviewMountRequest, partition: string): NativePage {
    const view = this.deps.createView(partition)

    const zoom = createPreviewPageZoom(view.webContents, {
      width: () => page.bounds.width,
      canFit: () =>
        page.ready &&
        page.visible &&
        Boolean(page.owner) &&
        !view.webContents.isDestroyed() &&
        !view.webContents.isLoadingMainFrame() &&
        !hasPreviewGuestApproval(view.webContents),
      changed: () => this.emit(page, 'page-zoom-changed')
    })

    const page: NativePage = {
      tabId: request.tabId,
      partition,
      view,
      source: sender,
      owner: null,
      window: null,
      popup: null,
      token: '',
      ready: false,
      bounds: request.bounds,
      awaitingPopup: false,
      parkedAt: 0,
      visible: false,
      focusPending: false,
      zoom,
      pressed: new Map(),
      cleanups: [],
      unregister: registerNativePreviewGuest(view.webContents, sender)
    }

    this.pages.set(page.tabId, page)
    this.watchGuest(page)
    this.watchSource(page, sender)

    return page
  }

  private attach(
    page: NativePage,
    owner: WebContents,
    window: BrowserWindow,
    bounds: NativePreviewBounds,
    visible: boolean
  ): void {
    clearTimeout(page.timer)
    const previous = page.owner
    this.tokens.delete(page.token)

    if (previous) {
      this.emit(page, 'detached')
      this.detach(page)
    }

    page.token = randomUUID()
    page.owner = owner
    page.window = window
    page.bounds = bounds
    page.parkedAt = 0

    if (owner === page.popup?.webContents) {
      page.awaitingPopup = false
    }

    window.contentView.addChildView(page.view)
    setNativePreviewOwner(page.view.webContents, owner)
    this.tokens.set(page.token, page)
    page.view.setBounds(bounds)
    page.visible = visible && bounds.width > 0 && bounds.height > 0
    page.view.setVisible(page.visible)
    void page.zoom.refresh()

    if (page.awaitingPopup) {
      this.armHandoff(page)
    }
  }

  mount(sender: WebContents, request: NativePreviewMountRequest): NativePreviewSnapshot {
    const window = this.host(sender)

    if (
      !request ||
      typeof request.tabId !== 'string' ||
      !request.tabId ||
      request.tabId.length > 512 ||
      !isPreviewPartition(request.partition)
    ) {
      throw new Error('Invalid native Browser tab or partition')
    }

    const popupTab = this.popupTabs.get(sender)

    if (popupTab && popupTab !== request.tabId) {
      throw new Error('This Browser window is authorized for a different tab')
    }

    const url = browserUrl(request.url)
    const bounds = validBounds(request.bounds, window)
    const partition = this.deps.resolvePartition(request.partition)
    let page = this.pages.get(request.tabId)
    const existing = Boolean(page)

    if (page) {
      const returning = !page.owner && page.source === sender
      const receiving = page.awaitingPopup && page.popup?.webContents === sender

      const authorizedPopup = page.popup?.webContents === sender && popupTab === page.tabId

      if ((!authorizedPopup && page.partition !== partition) || (page.owner !== sender && !returning && !receiving)) {
        throw new Error('This Browser tab belongs to another window or profile')
      }
    } else {
      if (popupTab) {
        throw new Error('The Browser tab being transferred is unavailable')
      }

      page = this.create(sender, request, partition)
    }

    this.attach(page, sender, window, bounds, request.visible !== false)

    // A transfer never loads the stored URL: it may name an earlier SPA route.
    if (!existing) {
      // Native did-fail-load is the authoritative failure event for the pane.
      const initial = page

      if (!this.deps.preparePage) {
        void initial.view.webContents.loadURL(url).catch(() => undefined)

        return snapshot(page)
      }

      void this.deps
        .preparePage(sender, initial.view.webContents, initial.tabId)
        .then(() => {
          if (!initial.view.webContents.isDestroyed()) {
            return initial.view.webContents.loadURL(url)
          }
        })
        .catch(error => {
          if (!initial.view.webContents.isDestroyed()) {
            initial.loadFailure = { description: String(error), url }
            this.emit(initial, 'did-fail-load', {
              errorDescription: String(error),
              validatedURL: url,
              isMainFrame: true
            })
          }
        })
    }

    return snapshot(page)
  }

  layout(sender: WebContents, token: string, bounds: NativePreviewBounds, visible: boolean): void {
    const page = this.tokens.get(token)

    if (!page || page.owner !== sender || sender.isDestroyed() || page.view.webContents.isDestroyed()) {
      return
    }

    const previousWidth = page.bounds.width
    const wasVisible = page.visible
    page.bounds = validBounds(bounds, this.host(sender))
    page.view.setBounds(page.bounds)
    page.visible = visible === true && page.bounds.width > 0 && page.bounds.height > 0

    if (!page.visible) {
      releaseInputs(page)
    }

    page.view.setVisible(page.visible)

    if (previousWidth !== page.bounds.width || wasVisible !== page.visible) {
      page.zoom.invalidate()
      void page.zoom.refresh()
    }

    if (page.visible && page.focusPending) {
      focusPage(page)
    }
  }

  command(sender: WebContents, token: string, command: string, args: unknown[]): unknown {
    const page = this.live(sender, token)
    const handler = Object.hasOwn(commands, command) ? commands[command] : undefined

    if (!handler || !Array.isArray(args)) {
      throw new Error('Unsupported native Browser command')
    }

    return handler(page.view.webContents, args, page)
  }

  release(sender: WebContents, token: string): void {
    const page = this.tokens.get(token)

    // An old renderer's late cleanup cannot destroy a page already moved elsewhere.
    if (!page || page.owner !== sender) {
      return
    }

    if (page.awaitingPopup) {
      this.detach(page)
      this.armHandoff(page)

      return
    }

    if (page.popup?.webContents === sender && page.source && !page.source.isDestroyed()) {
      assertPreviewBrowserDialogResolved(page.view.webContents)
      this.park(page)

      return
    }

    this.disposePage(page)
  }

  authorize(source: WebContents, popup: BrowserWindow, tabId: string): void {
    const page = this.pages.get(tabId)
    this.host(source)

    if (!page || page.owner !== source || page.source !== source || popup.isDestroyed() || page.popup) {
      throw new Error('Cannot move a Browser tab not owned by this window')
    }

    assertPreviewBrowserDialogResolved(page.view.webContents)
    this.popupTabs.set(popup.webContents, tabId)
    page.popup = popup
    page.awaitingPopup = true
    this.armHandoff(page)
    const popupCleanup: Array<() => void> = []
    popupCleanup.push(
      this.listen(page, popup, 'close', (event: Electron.Event) => {
        if (page.owner === popup.webContents) {
          try {
            assertPreviewBrowserDialogResolved(page.view.webContents)
          } catch {
            // Preserve the blocking dialog and its exact native callback until answered.
            event.preventDefault()

            return
          }

          this.park(page)
        }
      })
    )
    popupCleanup.push(
      this.listen(page, popup.webContents, 'destroyed', () => {
        popupCleanup.splice(0).forEach(cleanup => cleanup())

        if (page.popup !== popup && page.owner !== popup.webContents) {
          return
        }

        page.popup = null
        page.awaitingPopup = false
        clearTimeout(page.timer)

        if (page.owner === popup.webContents || !page.owner) {
          if (page.source && !page.source.isDestroyed()) {
            this.park(page)
          } else {
            this.disposePage(page)
          }
        }
      })
    )
  }

  closeTab(sender: WebContents, tabId: string): void {
    this.host(sender)
    const page = this.pages.get(tabId)

    if (!page) {
      return
    }

    if (page.source !== sender && page.owner !== sender) {
      throw new Error("Cannot close another window's Browser tab")
    }

    this.disposePage(page)
  }

  private external(page: NativePage, channel: unknown, args: unknown): void {
    if (channel !== GUEST_EXTERNAL_CHANNEL || !Array.isArray(args) || typeof args[0] !== 'string') {
      return
    }

    try {
      const { protocol } = new URL(args[0])

      if (protocol === 'http:' || protocol === 'https:') {
        this.emit(page, 'ipc-message', { channel, args: [args[0]] })
      }
    } catch {
      // The untrusted page supplied an invalid URL; no handoff is admitted.
    }
  }

  dispose(): void {
    for (const page of this.pages.values()) {
      this.disposePage(page)
    }
  }
}

/** The calling main-process window factory grants exactly one tab to its new popup. */
export function authorizeNativePreviewPopout(source: WebContents, popup: BrowserWindow, tabId: string): void {
  if (!nativeService) {
    throw new Error('Native Browser service is unavailable')
  }

  nativeService.authorize(source, popup, tabId)
}

export function registerNativePreviewIpc(ipc: Pick<IpcMain, 'handle' | 'on'>, deps: NativePreviewDeps): () => void {
  const service = new NativePreviewService(deps)
  nativeService = service
  ipc.handle(PREFIX + 'mount', (event, request) => service.mount(event.sender, request))
  ipc.on(PREFIX + 'layout', (event, token, bounds, visible) => service.layout(event.sender, token, bounds, visible))
  ipc.handle(PREFIX + 'command', (event, token, command, args) => service.command(event.sender, token, command, args))
  ipc.handle(PREFIX + 'release', (event, token) => service.release(event.sender, token))
  ipc.handle(PREFIX + 'closeTab', (event, tabId) => service.closeTab(event.sender, tabId))

  return () => {
    service.dispose()

    if (nativeService === service) {
      nativeService = undefined
    }
  }
}

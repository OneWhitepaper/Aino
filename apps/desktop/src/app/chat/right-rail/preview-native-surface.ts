import type {
  NativePreviewBridge,
  NativePreviewCommand,
  NativePreviewEvent,
  NativePreviewSnapshot
} from '../../../../shared/preview-native'

import { runPreviewGuestScript } from './preview-drive-channels'
import { watchNativePreviewPlacement } from './preview-native-placement'

export function createPreviewGuestSurface(tabId: string | undefined, partition: string, url: string, browser: boolean): HTMLElement {
  return browser && tabId && window.hermesDesktop?.nativePreview
    ? createNativePreviewSurface(tabId, partition, url)
    : document.createElement('webview')
}

/** Keep PreviewPane's existing guest interface; native owns the page, this node only its placement. */
export function createNativePreviewSurface(tabId: string, partition: string, url: string): HTMLElement {
  const element = document.createElement('div')
  element.dataset.nativePreview = tabId
  element.className = 'relative h-full w-full flex-1 bg-white bg-cover bg-no-repeat'
  let state: NativePreviewSnapshot | undefined
  let start: Promise<NativePreviewSnapshot> | undefined
  let bridge: NativePreviewBridge
  let disposed = false
  let stopEvents: (() => void) | undefined
  let stopPlacement: (() => void) | undefined
  const pendingInput = new Set<Promise<unknown>>()
  let inputError: unknown

  const dispatch = (type: string, detail: Record<string, unknown> = {}) =>
    element.dispatchEvent(Object.assign(new Event(type), detail))

  const receive = (event: NativePreviewEvent) => {
    if (disposed || event.token !== state?.token) {
      return
    }

    const wasReady = state?.ready
    state = event.snapshot ?? state
    const { type, token: _token, snapshot: _snapshot, ...detail } = event
    dispatch(type, detail)

    // Attachment navigation can retain the ready document without another
    // Chromium dom-ready. Publish native's recovery to document-bound tools.
    if (type === 'did-stop-loading' && state?.ready && !wasReady) {
      dispatch('dom-ready')
    }
  }

  const command = async (name: NativePreviewCommand, ...args: unknown[]) => {
    const attached = await start

    if (disposed || !attached) {
      throw new Error('Native Browser surface is no longer attached')
    }

    return bridge.command(attached.token, name, args)
  }

  const forget = () => {
    disposed = true
    stopEvents?.()
    stopPlacement?.()
    // Mount can finish after its React pane unmounts. Release its exact token,
    // never the tab id now potentially attached to another window.
    void start?.then(attached => bridge.release(attached.token)).catch(error => console.error('Browser release failed', error))
    element.remove()
  }

  Object.assign(element, {
    canGoBack: () => state?.back ?? false,
    canGoForward: () => state?.forward ?? false,
    getTitle: () => state?.title ?? '',
    getURL: () => state?.url ?? url,
    getWebContentsId: () => {
      if (!state) {
        throw new Error('Native Browser surface is not ready')
      }

      return state.webContentsId
    },
    getZoomFactor: () => state?.zoom ?? 1,
    getPageZoomMode: () => state?.zoomMode ?? 'fit',
    setPageZoom: (value: 'fit' | number) => command('setPageZoom', value),
    isAudioMuted: () => state?.muted ?? false,
    isDevToolsOpened: () => element.dataset.devtools === 'true',
    settleInput: async () => {
      await Promise.allSettled([...pendingInput])

      if (inputError) {
        const error = inputError
        inputError = undefined
        throw error
      }
    },
    executeJavaScript: async (code: string) => {
      await start

      if (disposed) {
        throw new Error('Native Browser surface is no longer attached')
      }

      return runPreviewGuestScript(element, code)
    },
    connectNativePreview: () => {
      bridge = window.hermesDesktop!.nativePreview!
      stopEvents = bridge.onEvent(receive)
      start = bridge.mount({
        tabId, partition, url,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        visible: false
      })
      void start.then(attached => {
        if (disposed) {
          return
        }

        state = attached
        stopPlacement = watchNativePreviewPlacement(element, bridge, attached.token)
        dispatch('did-navigate-in-page', { url: attached.url })
        dispatch(attached.loading ? 'did-start-loading' : 'did-stop-loading')

        if (attached.loadFailure) {
          dispatch('did-fail-load', {
            errorCode: attached.loadFailure.code, errorDescription: attached.loadFailure.description,
            validatedURL: attached.loadFailure.url, isMainFrame: true
          })
        } else if (attached.ready) {
          dispatch('dom-ready')
        }
      }).catch(error => {
        if (!disposed) {
          dispatch('did-fail-load', { errorDescription: String(error), isMainFrame: true, validatedURL: url })
        }
      })

      return forget
    }
  })

  const commands = ['loadURL', 'reload', 'reloadIgnoringCache', 'goBack', 'goForward', 'focus',
    'sendInputEvent', 'openDevTools', 'closeDevTools', 'copy', 'cut', 'paste', 'selectAll',
    'inspectElement', 'replaceMisspelling', 'setAudioMuted'] as const

  for (const name of commands) {
    Object.assign(element, { [name]: (...args: unknown[]) => {
      const pending = command(name, ...args)

      if (name === 'sendInputEvent') {
        pendingInput.add(pending)
        void pending.then(() => pendingInput.delete(pending), error => {
          pendingInput.delete(pending)
          inputError = error
        })
      }

      if (name === 'setAudioMuted' && state) {
        state = { ...state, muted: Boolean(args[0]) }
      }

      // Most of the webview interface is synchronous. Keep rejected stale commands
      // observed while loadURL still returns its promise to the navigation handler.
      if (name !== 'loadURL') {
        void pending.catch(error => console.error('Browser command failed', error))
      }

      return pending
    } })
  }

  element.addEventListener('devtools-opened', () => { element.dataset.devtools = 'true' })
  element.addEventListener('devtools-closed', () => { element.dataset.devtools = 'false' })

  return element
}

export function connectNativePreviewSurface(element: HTMLElement): (() => void) | undefined {
  return (element as HTMLElement & { connectNativePreview?: () => () => void }).connectNativePreview?.()
}

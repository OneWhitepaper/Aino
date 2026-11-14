/**
 * The channels the agent acts on a live preview page through, published per
 * tab while the pane's surface is an Electron `<webview>`: the script runner
 * and the trusted-input channel (preview-act.ts drives the page with both).
 * The browser-hosted iframe is opaque to this renderer, so it publishes none.
 */

import { type RefObject, useEffect } from 'react'

import { isElementInHiddenPane } from '@/components/pane-shell/pane-visibility'

import { beginPreviewApproval } from './preview-approval'
import { type PreviewInputEvent, registerPreviewInput, toWebviewInputSpace } from './preview-input'
import { installPreviewNativeActions } from './preview-native-actions'
import {
  type PreviewLoadFailure,
  type PreviewScriptRunner,
  registerPreviewScriptRunner,
  setPreviewLoadFailure
} from './preview-script-runner'

export type PreviewDriveGuest = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>
  getWebContentsId?: () => number
  getZoomFactor?: () => number
  sendInputEvent?: (event: PreviewInputEvent) => void
  settleInput?: () => Promise<void>
}

/** A script can await a frame even when its page is hidden. Wake only for that
 * round trip, never for the guest's lifetime or for a detached cosmetic loop. */
export async function withPreviewGuestActivity<T>(
  guest: PreviewDriveGuest,
  operation: (token: number) => Promise<T>,
  signal?: AbortSignal,
  releaseSignal = signal
) {
  if (!guest.executeJavaScript) {
    throw new Error('preview webview is not ready')
  }

  signal?.throwIfAborted()
  releaseSignal?.throwIfAborted()

  const desktop = window.hermesDesktop
  const begin = desktop?.beginPreviewGuestActivity
  const end = desktop?.endPreviewGuestActivity

  if (!begin || !end || !guest.getWebContentsId) {
    throw new Error('preview guest activity is unavailable')
  }

  const cancelled = Promise.withResolvers<never>()
  const acquisition = begin(guest.getWebContentsId())
  let token: number | undefined
  let started = false
  let released: Promise<void> | undefined

  const release = () => {
    if (token !== undefined) {
      released ??= end(token)
      // Observe an early release failure now; the finally below still reports it.
      void released.catch(() => {})
    }
  }

  const abort = () => {
    if (!started || signal?.aborted) {
      const reason = signal?.aborted ? signal.reason : releaseSignal?.reason
      cancelled.reject(reason ?? new DOMException('Preview script cancelled', 'AbortError'))
    }

    release()
  }

  signal?.addEventListener('abort', abort, { once: true })
  releaseSignal?.addEventListener('abort', abort, { once: true })

  try {
    token = await Promise.race([acquisition, cancelled.promise])
    signal?.throwIfAborted()
    releaseSignal?.throwIfAborted()
    started = true

    return await Promise.race([operation(token), cancelled.promise])
  } finally {
    signal?.removeEventListener('abort', abort)
    releaseSignal?.removeEventListener('abort', abort)

    if (token === undefined) {
      // Cancellation must not wait for IPC. A late token still has one owner
      // responsible for releasing it, without dispatching the cancelled work.
      // Acquisition rejection is already observed by the race.
      void acquisition.then(end, () => {}).catch(error => console.error('Could not release preview activity', error))
    } else {
      release()
      await released
    }
  }
}

export async function runPreviewGuestScript(guest: PreviewDriveGuest, code: string, signal?: AbortSignal) {
  if (guest.settleInput) {
    await guest.settleInput()
  }

  const execute = window.hermesDesktop?.executePreviewGuestScript

  if (!execute) {
    return Promise.reject(new Error('preview script activity is unavailable'))
  }

  return withPreviewGuestActivity(guest, token => execute(token, code), signal)
}

/** First-party reads/crops are bounded; approved plugin scripts keep their own lifetime. */
export async function withPreviewDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  lifetime?: AbortSignal
): Promise<T> {
  lifetime?.throwIfAborted()
  const deadline = new AbortController()
  const signal = lifetime ? AbortSignal.any([lifetime, deadline.signal]) : deadline.signal
  // Match the page-read bridge's response deadline, without leaving an idle timer.
  const timer = setTimeout(() => deadline.abort(new DOMException('Preview operation timed out', 'TimeoutError')), 8_000)

  try {
    return await operation(signal)
  } finally {
    clearTimeout(timer)
    deadline.abort()
  }
}

export function usePreviewDriveChannels(
  webviewRef: RefObject<null | PreviewDriveGuest>,
  tabId: string | undefined,
  usesWebview: boolean,
  loadFailure: PreviewLoadFailure | null = null
) {
  // Publish the SCRIPT runner for this tab: the one channel into the guest
  // page, shared by the tour tool (injected driver.js walkthroughs) and the
  // drive_preview tool (clicking, typing, scrolling the page the user sees).
  useEffect(() => {
    if (!usesWebview || !tabId) {
      return
    }

    const lifetime = new AbortController()

    const runner: PreviewScriptRunner = async (code, signal) => {
      const webview = webviewRef.current

      if (!webview?.executeJavaScript) {
        throw new Error('preview webview is not ready')
      }

      await runner.nativeAction?.({ action: 'watch' }, signal)

      return runPreviewGuestScript(webview, code, signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal)
    }

    installPreviewNativeActions(runner, () => webviewRef.current, tabId, lifetime.signal)

    runner.beginApproval = signal => {
      const webview = webviewRef.current

      if (!webview) {throw new Error('preview webview is not ready')}

      return beginPreviewApproval(webview, signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal)
    }

    runner.withActivity = (operation, signal) => {
      const webview = webviewRef.current

      if (!webview) {
        throw new Error('preview webview is not ready')
      }

      // A typing action reports how many characters landed on cancellation.
      // Release its lease immediately, but let it return that existing result
      // rather than racing it away with an AbortError.
      return withPreviewGuestActivity(webview, operation, lifetime.signal, signal)
    }

    runner.capture = async signal => {
      const webview = webviewRef.current

      if (webview?.settleInput) {
        await webview.settleInput()
      }

      const webContentsId = webview?.getWebContentsId?.()

      if (!webview || typeof webContentsId !== 'number' || !window.hermesDesktop.capturePreview) {
        throw new Error('Native browser capture is unavailable')
      }

      return withPreviewGuestActivity(
        webview,
        async () => {
          const data = await window.hermesDesktop.capturePreview!({ webContentsId })
          signal?.throwIfAborted()

          return data
        },
        signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
      )
    }

    const unregister = registerPreviewScriptRunner(tabId, runner)

    return () => {
      lifetime.abort()
      unregister()
    }
  }, [tabId, usesWebview, webviewRef])

  // Rejected loadURL/module loads share the registered runner's native failure state.
  useEffect(() => {
    if (tabId) {
      setPreviewLoadFailure(tabId, loadFailure)
    }
  }, [loadFailure, tabId, usesWebview])

  // Publish the INPUT channel for this tab. Same idea as the script runner, but
  // it carries real Chromium input rather than script — the agent's clicks and
  // keystrokes arrive as trusted events, so the page hovers, focuses and reacts
  // exactly as it would under a human hand.
  useEffect(() => {
    if (!usesWebview || !tabId) {
      return
    }

    return registerPreviewInput(tabId, {
      focus: () => {
        const webview = webviewRef.current

        // Trusted input still reaches the guest while hidden. Focusing the
        // webview element would steal the host's composer focus even when inert.
        if (webview && !isElementInHiddenPane(webview)) {
          webview.focus?.()
        }
      },
      send: event => {
        const webview = webviewRef.current

        // Never optional-chain this call away: a missing method would make every
        // agent click a silent no-op that still reports success, because the
        // overlay and the read-back both run on the separate script channel.
        if (typeof webview?.sendInputEvent !== 'function') {
          throw new Error('preview webview cannot take input events')
        }

        // The guest keeps its own (per-host) zoom, which the act engine's CSS
        // measurements do not include — ask the webview, not the window.
        webview.sendInputEvent(toWebviewInputSpace(event, webview.getZoomFactor?.()))
      }
    })
  }, [tabId, usesWebview, webviewRef])
}

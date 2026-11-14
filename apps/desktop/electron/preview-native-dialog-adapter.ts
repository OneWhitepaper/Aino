import type { EventEmitter } from 'node:events'

import type { WebContents } from 'electron'

import { isOwnedPreviewGuest } from './preview-guest-owner'

const CHANNEL = '-run-dialog'
const BUILTIN_MARKERS = ['dialogType', 'getLastWebPreferences', 'disableDialogs', 'showMessageBox']

export interface PreviewNativeDialogRequest {
  type: string
  message: string
  defaultText: string
  url: string
  respond: (accept: boolean, text?: string) => void
}

interface NativeDialogFrame {
  url: string
  detached: boolean
  isDestroyed: () => boolean
}

interface NativeDialogInfo {
  dialogType: string
  messageText: string
  defaultPromptText: string
  frame: NativeDialogFrame
}

function dialogDetails(value: unknown): Omit<PreviewNativeDialogRequest, 'respond'> | undefined {
  if (!value || typeof value !== 'object') {
    return
  }
  const info = value as NativeDialogInfo

  if (
    !['alert', 'confirm', 'prompt'].includes(info.dialogType) ||
    typeof info.messageText !== 'string' ||
    typeof info.defaultPromptText !== 'string' ||
    !info.frame
  ) {
    return
  }

  let url: unknown

  try {
    if (typeof info.frame.isDestroyed !== 'function' || typeof info.frame.detached !== 'boolean') {
      return
    }
    url = info.frame.url
  } catch {
    return
  }

  if (typeof url !== 'string') {
    return
  }

  return { type: info.dialogType, message: info.messageText, defaultText: info.defaultPromptText, url }
}

function dialogFrameState(frame: NativeDialogFrame, url: string): 'live' | 'changed' | 'destroyed' {
  try {
    if (frame.isDestroyed() || frame.detached) {
      return 'destroyed'
    }

    return frame.url === url ? 'live' : 'changed'
  } catch {
    return 'destroyed'
  }
}

/** Replace only Electron's known per-guest handler; unknown runtimes retain their native fallback. */
export function installPreviewNativeDialogAdapter(
  owner: WebContents,
  guest: WebContents,
  open: (request: PreviewNativeDialogRequest) => void
): (() => void) | undefined {
  if (!isOwnedPreviewGuest(owner, guest)) {
    return
  }
  // The guarded Electron-internal event is intentionally absent from WebContents' public overloads.
  const events = guest as unknown as EventEmitter
  const listeners = events.listeners(CHANNEL)

  if (listeners.length !== 1) {
    return
  }
  const original = listeners[0] as (...args: unknown[]) => unknown
  const source = Function.prototype.toString.call(original)

  if (!BUILTIN_MARKERS.every(marker => source.includes(marker))) {
    return
  }
  let disposed = false

  const adapter = function (this: WebContents, ...args: unknown[]) {
    const details = dialogDetails(args[0])
    const callback = args[1]

    if (args.length !== 2 || !details || typeof callback !== 'function') {
      return original.apply(this, args)
    }

    const frame = (args[0] as NativeDialogInfo).frame
    let answered = false

    const respond = (accept: boolean, text?: string) => {
      if (answered) {
        return
      }
      answered = true

      if (guest.isDestroyed()) {
        return
      }
      const allowed = !disposed && isOwnedPreviewGuest(owner, guest) && accept === true
      const frameState = dialogFrameState(frame, details.url)

      if (allowed && frameState !== 'live') {
        if (frameState === 'changed') {
          callback(false, '')
        }
        throw new Error('The website dialog frame changed')
      }

      if (frameState === 'destroyed') {
        return
      }
      callback(allowed, allowed && details.type === 'prompt' ? (text ?? details.defaultText) : '')
    }

    if (disposed || !isOwnedPreviewGuest(owner, guest)) {
      respond(false)

      return
    }

    try {
      open({ ...details, respond })
    } catch (error) {
      console.warn('Could not open Browser dialog', error)
      respond(false)
    }
  }

  events.removeListener(CHANNEL, original)
  events.on(CHANNEL, adapter)

  return () => {
    if (disposed) {
      return
    }
    disposed = true
    events.removeListener(CHANNEL, adapter)
    events.on(CHANNEL, original)
  }
}

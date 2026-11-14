import type { WebContents } from 'electron'

import { isOwnedPreviewGuest, watchNativePreviewOwner } from './preview-guest-owner'

export type PreviewCdpListener = (method: string, params: Record<string, unknown>, sessionId?: string) => void

interface Connection {
  guest: WebContents
  debugger: WebContents['debugger']
  owner: WebContents
  clients: number
  live: boolean
  listeners: Set<PreviewCdpListener>
  frames: Map<string, string>
  frameInitializers: Set<(sessionId: string) => Promise<void>>
  frameReady: Map<string, Promise<void>>
  close: () => void
}

export interface PreviewGuestCdp {
  sendCommand: (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<any>
  listen: (listener: PreviewCdpListener) => () => void
  release: () => void
  frameSessions: () => ReadonlyMap<string, string>
  attachOwnedFrame: (targetId: string) => Promise<string>
  watchFrames: (initialize: (sessionId: string) => Promise<void>) => Promise<() => void>
}

const connections = new WeakMap<WebContents, Connection>()

const frameAutoAttach = {
  autoAttach: true,
  flatten: true,
  waitForDebuggerOnStart: true,
  filter: [{ type: 'iframe', exclude: false }, { exclude: true }]
}

async function initializeFrame(connection: Connection, sessionId: string): Promise<void> {
  const active = connection.frameReady.get(sessionId)

  if (active) {
    return active
  }

  const ready = (async () => {
    try {
      await connection.debugger.sendCommand('Page.enable', {}, sessionId)

      for (const initialize of connection.frameInitializers) {
        await initialize(sessionId)
      }

      await connection.debugger.sendCommand('Target.setAutoAttach', frameAutoAttach, sessionId)
    } finally {
      if (connection.live) {
        await connection.debugger
          .sendCommand('Runtime.runIfWaitingForDebugger', {}, sessionId)
          .catch(() => undefined)
      }
    }
  })()

  connection.frameReady.set(sessionId, ready)

  return ready
}

/** One debugger attachment shared by preview features, never an arbitrary-CDP IPC door. */
export function acquirePreviewGuestCdp(owner: WebContents, guest: WebContents): PreviewGuestCdp {
  if (!isOwnedPreviewGuest(owner, guest)) {
    throw new Error('Browser page does not belong to this window')
  }

  let connection = connections.get(guest)

  if (connection && connection.owner !== owner) {
    connection.close()
    connection = undefined
  }

  if (!connection?.live) {
    if (guest.debugger.isAttached()) {
      throw new Error('Browser debugger is in use. Close Developer Tools and retry.')
    }

    guest.debugger.attach('1.3')

    const current: Connection = {
      guest,
      debugger: guest.debugger,
      owner,
      clients: 0,
      live: true,
      listeners: new Set(),
      frames: new Map(),
      frameInitializers: new Set(),
      frameReady: new Map(),
      close: () => {}
    }

    connection = current

    const debuggerClient = current.debugger

    const message = (_event: Electron.Event, method: string, params: Record<string, unknown>, sessionId?: string) => {
      if (method === 'Target.attachedToTarget' && (!sessionId || [...current.frames.values()].includes(sessionId))) {
        const target = params.targetInfo as { type?: string; targetId?: string } | undefined

        if (target?.type === 'iframe' && target.targetId && typeof params.sessionId === 'string') {
          current.frames.set(target.targetId, params.sessionId)
          void initializeFrame(current, params.sessionId).catch(() => undefined)
        }
      }

      if (method === 'Target.detachedFromTarget') {
        for (const [targetId, attached] of current.frames) {
          if (attached === params.sessionId) {
            current.frames.delete(targetId)
          }
        }

        current.frameReady.delete(String(params.sessionId))
      }

      for (const listener of [...current.listeners]) {
        listener(method, params, sessionId)
      }
    }

    const detached = () => close(false)
    const destroyed = () => close(false)

    const close = (detach = true) => {
      if (!current.live) {
        return
      }

      current.live = false
      current.listeners.clear()
      current.frameInitializers.clear()
      current.frames.clear()
      current.frameReady.clear()
      stopOwner()
      guest.removeListener('destroyed', destroyed)
      owner.removeListener('destroyed', destroyed)
      debuggerClient.removeListener('message', message)
      debuggerClient.removeListener('detach', detached)
      connections.delete(guest)

      if (detach && !guest.isDestroyed() && debuggerClient.isAttached()) {
        debuggerClient.detach()
      }
    }

    const stopOwner = watchNativePreviewOwner(guest, () => close())
    current.close = close
    debuggerClient.on('message', message)
    debuggerClient.on('detach', detached)
    guest.once('destroyed', destroyed)
    owner.once('destroyed', destroyed)
    connections.set(guest, current)
  }

  const current = connection
  current.clients++
  let released = false
  const localListeners = new Set<PreviewCdpListener>()
  const localInitializers = new Set<(sessionId: string) => Promise<void>>()

  return {
    async sendCommand(method, params = {}, sessionId) {
      if (released || !current.live || !isOwnedPreviewGuest(owner, guest)) {
        throw new Error('Browser debugger ownership changed')
      }

      return sessionId
        ? current.debugger.sendCommand(method, params, sessionId)
        : current.debugger.sendCommand(method, params)
    },
    frameSessions: () => new Map(current.frames),
    async attachOwnedFrame(targetId) {
      if (released || !current.live || !isOwnedPreviewGuest(owner, guest)) {
        throw new Error('Browser debugger ownership changed')
      }

      let sessionId = current.frames.get(targetId)

      if (!sessionId) {
        const attached = await current.debugger.sendCommand('Target.attachToTarget', { targetId, flatten: true })
        sessionId = current.frames.get(targetId) ?? (attached.sessionId as string)

        if (!sessionId) {
          throw new Error('The embedded browser frame is unavailable')
        }

        current.frames.set(targetId, sessionId)
      }

      await initializeFrame(current, sessionId)

      return sessionId
    },
    async watchFrames(initialize) {
      if (released || !current.live) {
        throw new Error('Browser debugger is unavailable')
      }

      current.frameInitializers.add(initialize)
      localInitializers.add(initialize)

      for (const sessionId of current.frames.values()) {
        await initialize(sessionId)
      }

      await current.debugger.sendCommand('Target.setAutoAttach', frameAutoAttach)

      return () => {
        current.frameInitializers.delete(initialize)
        localInitializers.delete(initialize)
      }
    },
    listen(listener) {
      if (released || !current.live) {
        throw new Error('Browser debugger is unavailable')
      }

      current.listeners.add(listener)
      localListeners.add(listener)

      return () => {
        current.listeners.delete(listener)
        localListeners.delete(listener)
      }
    },
    release() {
      if (released) {
        return
      }

      released = true

      for (const listener of localListeners) {
        current.listeners.delete(listener)
      }

      for (const initialize of localInitializers) {
        current.frameInitializers.delete(initialize)
      }

      if (--current.clients === 0) {
        current.close()
      }
    }
  }
}

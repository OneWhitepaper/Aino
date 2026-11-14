import fs from 'node:fs'
import path from 'node:path'

import type { PlatformAccountSnapshot, PlatformAccountWindowOwner } from '../shared/platform-contract'

import { resolveDesktopHermesHome } from './data-paths'

export interface AccountWorkspace {
  key: string
  home: string
  ui: string
  userId: string | null
}

export function accountWorkspace(userData: string, origin: string, userId: string | null): AccountWorkspace {
  const home = resolveDesktopHermesHome({ home: userData, accountWorkspace: { userData, origin, userId } })

  return { home, key: path.basename(path.dirname(home)), ui: path.join(path.dirname(home), 'desktop'), userId }
}

export function prepareAccountWorkspace(workspace: AccountWorkspace): void {
  for (const directory of [workspace.home, workspace.ui]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  }
}

export function matchesAccountWindowOwner(
  snapshot: PlatformAccountSnapshot,
  expected?: PlatformAccountWindowOwner
): boolean {
  return Boolean(
    expected &&
    snapshot.account?.id === expected.userId &&
    snapshot.mode === expected.mode &&
    snapshot.revision === expected.revision
  )
}

/** Auth stays in the native process; no session-only credential crosses disk during a re-home. */
export function createAccountWorkspaceSwitch({
  initial,
  resolve,
  retire,
  activate,
  ready
}: {
  initial: AccountWorkspace
  resolve: (userId: string | null) => AccountWorkspace
  retire: () => Promise<void>
  activate: (workspace: AccountWorkspace) => void | Promise<void>
  ready: () => void
}) {
  let current = initial
  let requested = initial
  let switching: Promise<void> | null = null
  let blocked = false

  async function settle() {
    await retire()

    do {
      const next = requested

      prepareAccountWorkspace(next)
      await activate(next)
      current = next
    } while (current.key !== requested.key)

    blocked = false
    ready()
  }

  return {
    current: () => current,
    ready: () => !blocked,
    change(userId: string | null): Promise<void> {
      requested = resolve(userId)

      if (switching) {
        return switching
      }

      if (!blocked && requested.key === current.key) {
        return Promise.resolve()
      }

      blocked = true
      switching = settle().finally(() => {
        switching = null
      })

      return switching
    }
  }
}

const PRESENTATION_CHANNELS = new Set([
  'aino:account:windowMode',
  'aino:platform-captcha:get',
  'aino:platform-captcha:submit',
  'hermes:window-control',
  'hermes:window:size',
  'hermes:bootstrap:get',
  'hermes:deep-link-ready',
  'hermes:power-battery:get',
  'hermes:get-remote-display-reason',
  'hermes:embed-host:origin'
])

export function accountWorkspaceAdministrativeChannel(channel: string): boolean {
  return channel.startsWith('aino:platform-account:') || PRESENTATION_CHANNELS.has(channel)
}

/** Every native data IPC is drained before its mutable home changes. */
export function createAccountWorkspaceIpc<T extends object>(
  ipc: T,
  allowed: (senderId: number) => boolean,
  enabled: () => boolean
): { ipc: T; drain(): Promise<void> } {
  const pending = new Set<Promise<unknown>>()
  const listeners = new WeakMap<Function, Function>()

  function wrap(channel: string, listener: (...args: any[]) => unknown, notification = false) {
    const administrative = accountWorkspaceAdministrativeChannel(channel)

    return (...args: any[]) => {
      if (!enabled() || administrative) {
        return listener(...args)
      }

      if (!allowed(args[0]?.sender?.id)) {
        if (notification) {
          args[0].returnValue = null

          return
        }

        throw new Error('account_workspace_unavailable')
      }

      const result = listener(...args)

      if (result && typeof (result as Promise<unknown>).then === 'function') {
        const task = Promise.resolve(result)
        pending.add(task)
        void task.then(
          () => pending.delete(task),
          () => pending.delete(task)
        )
      }

      return result
    }
  }

  const native = ipc as Record<string, any>
  const handle = native.handle.bind(native)
  const on = native.on.bind(native)
  const removeListener = native.removeListener.bind(native)

  native.handle = (channel: string, listener: (...args: any[]) => unknown) => handle(channel, wrap(channel, listener))

  native.on = (channel: string, listener: (...args: any[]) => unknown) => {
    const guarded = wrap(channel, listener, true)
    listeners.set(listener, guarded)

    return on(channel, guarded)
  }

  native.removeListener = (channel: string, listener: (...args: any[]) => unknown) =>
    removeListener(channel, listeners.get(listener) || listener)
  native.off = native.removeListener

  return {
    ipc,
    drain: async () => {
      while (pending.size) {
        await Promise.allSettled([...pending])
      }
    }
  }
}

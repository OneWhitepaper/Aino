import { createBackendShutdownCoordinator } from './backend-ownership'
import { markExpectedTransition } from './crash-forensics'
import { PRODUCT_NAME } from './product-identity'

export const LOCAL_GATEWAY_LIFECYCLE_SCOPE = 'local-gateway'

/** Observe every branch, but never leave quit parked on a lost exit/SSH callback. */
export async function waitForTeardown(tasks: readonly Promise<unknown>[], timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise<void>((resolve: () => void): void => {
        timer = setTimeout(resolve, timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

interface LocalBackendLifecycleDeps<Child> {
  stopChild: (child: Child) => void
  waitForExit: (child: Child) => Promise<void>
  cancelSetup: () => void
  timeoutMs?: number
}

/**
 * Physical ownership outlives routing entries: track starts before their first
 * await and children before their asynchronous identity claim. The permanent
 * shutdown signal and synchronous spawn fence make bounded waiting safe: a late
 * resolver can finish, but can never create another owned backend.
 */
export interface LocalBackendLifecycle<Child> {
  signal: AbortSignal
  assertCanStart: () => void
  hasPending: () => boolean
  drain: () => Promise<void>
  start: <T>(run: () => Promise<T>, scope?: string) => Promise<T>
  recycle: <T>(scope: string, run: () => Promise<T>) => Promise<T>
  pendingRecycle: (scope: string) => Promise<void> | undefined
  spawn: (create: () => Child) => Child
  release: (child: Child) => boolean
  stop: (child: Child | null | undefined) => Promise<void>
  shutdown: () => Promise<void>
}

export function createLocalBackendLifecycle<Child>(
  deps: LocalBackendLifecycleDeps<Child>
): LocalBackendLifecycle<Child> {
  const controller = new AbortController()
  const starts = new Map<Promise<unknown>, string>()
  const recycles = new Map<string, Promise<void>>()
  const children = new Set<Child>()
  const stops = new Map<Child, Promise<void>>()

  function start<T>(run: () => Promise<T>, scope = ''): Promise<T> {
    if (controller.signal.aborted) {
      return Promise.reject(controller.signal.reason)
    }

    const recycling = recycles.get(scope)

    if (recycling) {
      return recycling.then(() => start(run, scope))
    }

    // Register before yielding; recycle drains only starts already admitted.
    const promise = Promise.resolve().then((): Promise<T> => {
      controller.signal.throwIfAborted()

      return run()
    })

    starts.set(promise, scope)

    const release = (): void => {
      starts.delete(promise)
    }

    void promise.then(release, release)

    return promise
  }

  function stop(child: Child | null | undefined): Promise<void> {
    if (child == null) {
      return Promise.resolve()
    }

    const existing = stops.get(child)

    if (existing) {
      return existing
    }

    const stopping = (async (): Promise<void> => {
      deps.stopChild(child)
      await deps.waitForExit(child)
    })()

    stops.set(child, stopping)
    void stopping.then(
      (): boolean => stops.delete(child),
      (): boolean => stops.delete(child)
    )

    return stopping
  }

  const shutdown = createBackendShutdownCoordinator((): Promise<void> => {
    controller.abort(markExpectedTransition(new Error(`${PRODUCT_NAME} is quitting.`)))
    deps.cancelSetup()

    return waitForTeardown(
      [...starts.keys(), ...recycles.values(), ...[...children].map(stop), ...stops.values()],
      deps.timeoutMs ?? 7_000
    )
  })

  return {
    signal: controller.signal,
    drain: async () => {
      while (starts.size || recycles.size) {
        await Promise.allSettled([...starts.keys(), ...recycles.values()])
      }
    },
    assertCanStart: (): void => controller.signal.throwIfAborted(),
    hasPending: (): boolean =>
      starts.size > 0 || recycles.size > 0 || children.size > 0 || stops.size > 0 || shutdown.isPending(),
    pendingRecycle: scope => recycles.get(scope),
    async recycle<T>(scope: string, run: () => Promise<T>): Promise<T> {
      const prior = recycles.get(scope)
      let release!: () => void

      const own = new Promise<void>(resolve => {
        release = resolve
      })

      const barrier = prior ? prior.then(() => own) : own
      recycles.set(scope, barrier)
      const pending = [...starts].filter(([, key]) => key === scope).map(([promise]) => promise)

      try {
        await prior
        await Promise.allSettled(pending)
        controller.signal.throwIfAborted()

        return await run()
      } finally {
        release()

        if (recycles.get(scope) === barrier) {
          recycles.delete(scope)
        }
      }
    },
    start,
    spawn(create: () => Child): Child {
      controller.signal.throwIfAborted()
      const child = create()
      children.add(child)

      return child
    },
    release: (child: Child): boolean => children.delete(child),
    stop,
    shutdown: shutdown.run
  }
}

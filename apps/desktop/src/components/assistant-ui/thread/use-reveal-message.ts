import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

import { onRevealThreadMessageRequest } from '@/store/thread-scroll'

interface RevealMessageOptions {
  sessionId: string | null
  sessionKey: string | null | undefined
  visible: boolean
  scrollRef: RefObject<HTMLElement | null>
  revision: string
  showEarlier: () => Promise<boolean>
  prepareScroll: () => void
}

/** A citation pages through the same store/DOM windows as Show earlier. Each
 * step waits for its request AND a committed window change, never frame-counts
 * network latency. Session/visibility changes cancel the pending navigation. */
export function useRevealMessage(options: RevealMessageOptions) {
  const latest = useRef(options)
  latest.current = options
  const committed = useRef(new Set<() => void>())

  useLayoutEffect(() => {
    for (const wake of committed.current) {
      wake()
    }
  })

  useEffect(() => {
    const controller = new AbortController()

    const cancelled = new Promise<false>(resolve => {
      controller.signal.addEventListener('abort', () => resolve(false), { once: true })
    })

    const unsubscribe = onRevealThreadMessageRequest(async request => {
      const current = () =>
        !controller.signal.aborted &&
        request.isCurrent() &&
        latest.current.visible &&
        Boolean(latest.current.scrollRef.current && request.root.contains(latest.current.scrollRef.current))

      if (!current()) {
        return false
      }

      while (current()) {
        const state = latest.current
        const selector = `[data-durable-row-id="${request.rowId}"], [data-source-row-ids~="${request.rowId}"]`

        if (state.scrollRef.current?.querySelector(selector)) {
          state.prepareScroll()

          return current()
        }

        // Register before triggering the state change so synchronous commits
        // cannot be missed. Cancellation also releases this waiter on unmount.
        let release = () => {}

        const changed = new Promise<boolean>(resolve => {
          const finish = (value: boolean) => {
            committed.current.delete(check)
            controller.signal.removeEventListener('abort', cancel)
            resolve(value)
          }

          const check = () => {
            if (!current()) {
              finish(false)
            } else if (latest.current.revision !== state.revision) {
              finish(true)
            }
          }

          const cancel = () => finish(false)
          release = cancel
          committed.current.add(check)
          controller.signal.addEventListener('abort', cancel, { once: true })
        })

        const expanded = await Promise.race([state.showEarlier(), cancelled])

        if (!expanded || !current()) {
          release()

          return false
        }

        if (!(await changed)) {
          return false
        }

        // assistant-ui publishes its normalized repository from an effect
        // after the store commit. Yield through that paint before reading the
        // next window; HTTP latency was awaited above, independently.
        await Promise.race([
          new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
          cancelled
        ])
      }

      return false
    }, options.sessionId)

    return () => {
      controller.abort()
      unsubscribe()
    }
  }, [options.sessionId, options.sessionKey, options.visible])
}

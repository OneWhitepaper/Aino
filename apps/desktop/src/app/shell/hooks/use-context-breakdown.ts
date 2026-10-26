import { useEffect, useReducer, useState } from 'react'

import type { ContextBreakdown } from '@/types/hermes'

interface ContextBreakdownOptions {
  busy: boolean
  enabled: boolean
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>
  refreshKey?: string
  sessionId: null | string
}

const INITIALIZATION_RETRY_DELAYS_MS = [500, 1000, 2000]

/** The composer's session context breakdown, fetched as soon as the
 *  gauge is on screen rather than when its popover opens.
 *
 *  The backend only reports measured context occupancy (`last_prompt_tokens`)
 *  once a turn has run in THIS process, so a resumed session reports none —
 *  which is why turning the gauge on used to do nothing at all until you sent
 *  a message. `session.context_breakdown` estimates the same figure from the
 *  live system prompt + tools + transcript, so it answers for a session that
 *  hasn't spoken yet. It is a read-only chars/4 pass: no provider call, no
 *  prompt-cache impact.
 *
 *  Refetches when the focused session changes and when a turn ends (the
 *  transcript just grew). Held keyed by the session it describes so switching
 *  sessions drops the previous numbers instead of painting them under the new
 *  session's name.
 *
 *  Two events change the transcript WITHOUT a busy toggle, so the refetch
 *  must be driven explicitly:
 *
 *  - **Compression** — manual `/compress` runs the `session.compress` RPC
 *    outside any turn (busy never flips), and auto-compression can commit
 *    mid-turn. The post-compression transcript measures a fraction of the
 *    pre-compression size, so a served pre-compression breakdown is not
 *    merely stale, it is wrong by 5-10x (#94001).
 *  - **Reclaim** (`session.reclaimed`) — the runtime is reaped and the
 *    session re-resumes; the first refetch can race the agent rebuild.
 *
 *  `invalidateContextBreakdown` bumps a per-session generation that both
 *  call sites (slash.ts after a successful compress, lifecycle.ts on
 *  reclaim) fire, forcing an immediate refetch. An untrustworthy answer —
 *  an outright failure, or a ZEROED breakdown from the backend's
 *  agent-is-None branch (`context_max: 0`) — retries on a bounded backoff;
 *  once the ladder is exhausted the cached breakdown is EVICTED so the
 *  meter goes dark honestly rather than showing numbers known to be
 *  stale. */

/** A breakdown the backend computed from a live agent carries a real
 *  context_max (the compressor's context_length). Zero means the
 *  `agent is None` branch answered from empty metadata — not data. */
function isZeroedBreakdown(breakdown: ContextBreakdown): boolean {
  return !(breakdown.context_max > 0 || breakdown.context_used > 0 || breakdown.categories.length > 0)
}

const RETRY_DELAYS_MS = INITIALIZATION_RETRY_DELAYS_MS

/** Per-session invalidation generations. `invalidateContextBreakdown` bumps
 *  the generation for one session and notifies subscribers; the hook
 *  subscribes for its own session, so a bump re-runs the fetch immediately. */
const invalidationGenerations = new Map<string, number>()
const invalidationListeners = new Set<(sessionId: string, generation: number) => void>()

/** Force a refetch of the context breakdown for `sessionId` on the next
 *  render. Call when the transcript is known to have changed outside a
 *  turn: after a successful `session.compress`, and on
 *  `session.reclaimed`. */
export function invalidateContextBreakdown(sessionId: string): void {
  const id = sessionId.trim()

  if (id) {
    const generation = (invalidationGenerations.get(id) ?? 0) + 1

    invalidationGenerations.set(id, generation)

    for (const listener of invalidationListeners) {
      listener(id, generation)
    }
  }
}

/** Clear all invalidation generations (test isolation — the Map is
 *  module-level and would otherwise leak across tests). */
export function _resetContextBreakdownInvalidationsForTests(): void {
  invalidationGenerations.clear()
}

export function useContextBreakdown({ busy, enabled, requestGateway, refreshKey, sessionId }: ContextBreakdownOptions) {
  const [fetched, setFetched] = useState<{
    breakdown: ContextBreakdown
    requestGateway: ContextBreakdownOptions['requestGateway']
    refreshKey?: string
    sessionId: string
  } | null>(null)

  const [loading, setLoading] = useState(false)
  const [requestVersion, refetch] = useReducer(version => version + 1, 0)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!sessionId) {
      return
    }

    const listener = (id: string, next: number) => {
      if (id === sessionId) {
        setGeneration(next)
      }
    }

    invalidationListeners.add(listener)
    setGeneration(invalidationGenerations.get(sessionId) ?? 0)

    return () => {
      invalidationListeners.delete(listener)
    }
  }, [sessionId])

  useEffect(() => {
    if (!enabled || !sessionId || busy) {
      setFetched(null)
      setLoading(false)

      return
    }

    let cancelled = false
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const runtimeId = sessionId
    setLoading(true)

    const scheduleRetry = () => {
      const delay = RETRY_DELAYS_MS[retry++]

      if (delay !== undefined) {
        timer = setTimeout(() => void fetchBreakdown(), delay)
      } else {
        setFetched(null)
        setLoading(false)
      }
    }

    async function fetchBreakdown() {
      try {
        const breakdown = await requestGateway<ContextBreakdown>('session.context_breakdown', { session_id: runtimeId })

        if (cancelled) {
          return
        }

        // Empty metadata can precede lazy initialization. Missing capacity alone
        // must not discard measured occupancy or restored historical details.
        if (!breakdown || isZeroedBreakdown(breakdown)) {
          scheduleRetry()

          return
        }

        setFetched({ breakdown, requestGateway, refreshKey, sessionId: runtimeId })
        setLoading(false)
      } catch {
        if (!cancelled) {
          scheduleRetry()
        }
      }
    }

    void fetchBreakdown()

    return () => {
      cancelled = true

      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }, [busy, enabled, generation, requestGateway, requestVersion, refreshKey, sessionId])

  return {
    breakdown:
      !busy &&
      fetched &&
      fetched.sessionId === sessionId &&
      fetched.requestGateway === requestGateway &&
      fetched.refreshKey === refreshKey
        ? fetched.breakdown
        : null,
    loading,
    refetch
  }
}

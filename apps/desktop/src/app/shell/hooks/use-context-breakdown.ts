import { useEffect, useReducer, useRef, useState } from 'react'

import type { ContextBreakdown } from '@/types/hermes'

interface ContextBreakdownOptions {
  busy: boolean
  enabled: boolean
  identityKey?: string
  requestGateway: <T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
  refreshKey?: string
  sessionId: null | string
  suspended?: boolean
}

const INITIALIZATION_RETRY_DELAYS_MS = [500, 1000, 2000]
const LIVE_REFRESH_INTERVAL_MS = 2_000

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
 *  Usage events refresh category estimates at most once every two seconds
 *  during a turn, and a turn ending refreshes immediately. Keep the previous
 *  categories visible during same-owner/model refreshes; session, owner, model
 *  and explicit invalidations still discard them immediately. No token delta
 *  starts its own timer or estimates category values in the renderer.
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
 *  an outright failure, or a ZEROED breakdown (`context_max: 0` and no
 *  categories) — retries on a bounded backoff;
 *  once the ladder is exhausted the cached breakdown is EVICTED so the
 *  meter goes dark honestly rather than showing numbers known to be
 *  stale. */

/** Cold runtimes can restore occupancy without a known model window. Only a
 * payload with no capacity, occupancy or categories is uninitialized. */
function isZeroedBreakdown(breakdown: ContextBreakdown): boolean {
  return !(breakdown.context_max > 0 || breakdown.context_used > 0 || breakdown.categories.length > 0)
}

const RETRY_DELAYS_MS = INITIALIZATION_RETRY_DELAYS_MS

/** A prompt-size estimate is useful context, but it must never hold the composer
 *  in a loading state forever when the gateway is reconnecting or the backend is
 *  rebuilding a large session. The request is retried from the popover after a
 *  timeout, so a slow backend does not create an unbounded queue of work. */
export const CONTEXT_BREAKDOWN_TIMEOUT_MS = 5_000

type ContextBreakdownRequester = ContextBreakdownOptions['requestGateway']

/** Composer and statusbar can mount together for the same focused session. Keep
 * one in-flight estimate per gateway/session so both surfaces share the same
 * backend walk instead of starting duplicate prompt builds. WeakMap keeps a
 * disconnected gateway from retaining session keys indefinitely. */
const pendingBreakdowns = new WeakMap<ContextBreakdownRequester, Map<string, Promise<ContextBreakdown>>>()

function requestContextBreakdown(
  requestGateway: ContextBreakdownRequester,
  sessionId: string,
  revision: string
): Promise<ContextBreakdown> {
  let bySession = pendingBreakdowns.get(requestGateway)

  if (!bySession) {
    bySession = new Map()
    pendingBreakdowns.set(requestGateway, bySession)
  }

  const key = JSON.stringify([sessionId, revision])
  const existing = bySession.get(key)

  if (existing) {
    return existing
  }

  let timeout: ReturnType<typeof setTimeout>

  const raw = new Promise<ContextBreakdown>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('context_breakdown_timeout')), CONTEXT_BREAKDOWN_TIMEOUT_MS)
    void requestGateway<ContextBreakdown>(
      'session.context_breakdown',
      { session_id: sessionId },
      CONTEXT_BREAKDOWN_TIMEOUT_MS
    ).then(resolve, reject)
  })

  const request = raw.finally(() => {
    clearTimeout(timeout)

    if (bySession?.get(key) === request) {
      bySession.delete(key)

      if (!bySession.size) {
        pendingBreakdowns.delete(requestGateway)
      }
    }
  })

  bySession.set(key, request)

  return request
}

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

export function useContextBreakdown({
  busy,
  enabled,
  refreshKey,
  identityKey = refreshKey,
  requestGateway,
  sessionId,
  suspended = false
}: ContextBreakdownOptions) {
  const [fetched, setFetched] = useState<{
    breakdown: ContextBreakdown
    generation: number
    requestGateway: ContextBreakdownOptions['requestGateway']
    requestVersion: number
    identityKey?: string
    sessionId: string
  } | null>(null)

  const [loading, setLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [requestVersion, refetch] = useReducer(version => version + 1, 0)
  const [generation, setGeneration] = useState(0)

  const lastRead = useRef<{
    requestGateway: ContextBreakdownOptions['requestGateway']
    sessionId: string
    identityKey?: string
    startedAt: number
  } | null>(null)

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
    if (!busy || !sessionId) {
      return
    }

    const pending = pendingBreakdowns.get(requestGateway)

    for (const key of pending?.keys() ?? []) {
      if (JSON.parse(key)[0] === sessionId) {
        pending?.delete(key)
      }
    }
  }, [busy, requestGateway, sessionId])

  // This ref records RPC start times for throttling, never mirrored atom state.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!enabled || !sessionId || suspended) {
      setFetched(null)
      setLoading(false)
      setUnavailable(false)

      return
    }

    let cancelled = false
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const runtimeId = sessionId
    setLoading(true)
    setUnavailable(false)

    const scheduleRetry = () => {
      const delay = RETRY_DELAYS_MS[retry++]

      if (delay !== undefined) {
        timer = setTimeout(() => void fetchBreakdown(), delay)
      } else {
        setFetched(null)
        setLoading(false)
        setUnavailable(true)
      }
    }

    async function fetchBreakdown() {
      lastRead.current = { requestGateway, sessionId: runtimeId, identityKey, startedAt: Date.now() }

      try {
        const breakdown = await requestContextBreakdown(
          requestGateway,
          runtimeId,
          JSON.stringify([identityKey, refreshKey, generation, requestVersion, busy])
        )

        if (cancelled) {
          return
        }

        // Empty metadata can precede lazy initialization. Missing capacity alone
        // must not discard measured occupancy or restored historical details.
        if (!breakdown || isZeroedBreakdown(breakdown)) {
          scheduleRetry()

          return
        }

        setFetched({
          breakdown,
          generation,
          requestGateway,
          requestVersion,
          identityKey,
          sessionId: runtimeId
        })
        setLoading(false)
      } catch (error) {
        if (cancelled) {
          return
        }

        // A timeout means the backend did not answer this read in time. Stop
        // showing an endless spinner and let the existing popover retry affordance
        // initiate a fresh request. Initialization/transport failures retain their
        // bounded retry ladder because those often recover within a short delay.
        if (error instanceof Error && error.message === 'context_breakdown_timeout') {
          setFetched(null)
          setLoading(false)
          setUnavailable(true)

          return
        }

        scheduleRetry()
      }
    }

    const previous = lastRead.current

    const delay =
      busy &&
      previous?.requestGateway === requestGateway &&
      previous.sessionId === runtimeId &&
      previous.identityKey === identityKey
        ? Math.max(0, LIVE_REFRESH_INTERVAL_MS - (Date.now() - previous.startedAt))
        : 0

    if (delay) {
      timer = setTimeout(() => void fetchBreakdown(), delay)
    } else {
      void fetchBreakdown()
    }

    return () => {
      cancelled = true

      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }, [busy, enabled, generation, identityKey, requestGateway, requestVersion, refreshKey, sessionId, suspended])

  return {
    breakdown:
      !suspended &&
      fetched &&
      fetched.sessionId === sessionId &&
      fetched.requestGateway === requestGateway &&
      fetched.identityKey === identityKey &&
      fetched.generation === generation &&
      fetched.requestVersion === requestVersion
        ? fetched.breakdown
        : null,
    loading,
    refetch,
    unavailable
  }
}

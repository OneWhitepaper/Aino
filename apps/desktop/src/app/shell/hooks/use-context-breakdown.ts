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
 *  session's name. */
export function useContextBreakdown({ busy, enabled, requestGateway, refreshKey, sessionId }: ContextBreakdownOptions) {
  const [fetched, setFetched] = useState<{
    breakdown: ContextBreakdown
    requestGateway: ContextBreakdownOptions['requestGateway']
    refreshKey?: string
    sessionId: string
  } | null>(null)

  const [loading, setLoading] = useState(false)
  const [requestVersion, refetch] = useReducer(version => version + 1, 0)

  useEffect(() => {
    // Mid-turn the transcript changes on every delta and the gateway already
    // streams measured usage, so an estimate would be both stale and wasteful.
    if (!enabled || !sessionId || busy) {
      setLoading(false)

      return
    }

    let cancelled = false
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const runtimeId = sessionId

    setLoading(true)

    async function fetchBreakdown() {
      let breakdown: ContextBreakdown

      try {
        breakdown = await requestGateway<ContextBreakdown>('session.context_breakdown', { session_id: runtimeId })
      } catch {
        if (!cancelled) {
          setLoading(false)
        }

        return
      }

      if (cancelled) {
        return
      }

      if (breakdown && (breakdown.context_max > 0 || breakdown.context_used > 0 || breakdown.categories.length > 0)) {
        setFetched({ breakdown, requestGateway, refreshKey, sessionId: runtimeId })
      } else {
        // An entirely empty response can precede lazy session initialization.
        // A missing capacity alone must not discard known tokens or details.
        setFetched(null)

        const delay = INITIALIZATION_RETRY_DELAYS_MS[retry++]

        if (delay !== undefined) {
          timer = setTimeout(() => void fetchBreakdown(), delay)

          return
        }
      }

      setLoading(false)
    }

    void fetchBreakdown()

    return () => {
      cancelled = true

      if (timer !== undefined) {
        clearTimeout(timer)
      }
    }
  }, [busy, enabled, requestGateway, requestVersion, refreshKey, sessionId])

  return {
    breakdown:
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

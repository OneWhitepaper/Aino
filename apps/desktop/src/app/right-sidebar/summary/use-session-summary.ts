import type { SessionSummaryResult } from '@hermes/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { generateSessionSummary, readSessionSummary } from '@/api/session-summary'
import type { Locale } from '@/i18n'
import { useStoreSelector } from '@/lib/use-session-slice'
import { assertSessionOwnerResolved } from '@/store/session-owner-resolution'
import { $sessionStates } from '@/store/session-states'

import type { SummarySession } from './use-summary-session'

interface SummaryHistoryState {
  historyReady: boolean
  historyUpdatedAt: number
  refreshing: boolean
}

/** Read snapshots at transcript boundaries; generation is deduplicated by the
 * backend's content revision, never by streaming text or a component render. */
export function useSessionSummary(session: SummarySession, history: SummaryHistoryState, language: Locale) {
  const { scope, storedId, owner, busy } = session
  const client = useQueryClient()

  const unsentDraft = useStoreSelector($sessionStates, states =>
    Boolean(session.runtimeId && states[session.runtimeId]?.isUnsentDraft)
  )

  const baseKey = ['session-summary', scope.connectionId, scope.profile, storedId, language, Boolean(owner)] as const
  // Reading an existing summary does not require a full transcript or an idle
  // agent. Only a new model call must wait for a settled turn boundary.
  const canRead = Boolean(storedId && !unsentDraft)
  const canGenerate = canRead && !busy

  const snapshot = useQuery({
    queryKey: [...baseKey, busy, history.historyUpdatedAt],
    enabled: canRead,
    queryFn: () => {
      assertSessionOwnerResolved(owner, { method: 'session.summary', sessionId: storedId })

      return readSessionSummary(storedId!, scope, language)
    },
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey.slice(0, baseKey.length).every((value, index) => value === baseKey[index])
        ? previous
        : undefined,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: query => (query.state.data?.busy && query.state.dataUpdateCount < 6 ? 5_000 : false),
    staleTime: Infinity,
    gcTime: 60_000
  })

  const revision = snapshot.data?.source_revision
  const attemptKey = JSON.stringify([...baseKey, revision])
  const [retryAttempt, setRetryAttempt] = useState({ key: '', count: 0 })
  const attempt = retryAttempt.key === attemptKey ? retryAttempt.count : 0

  const generation = useQuery({
    queryKey: ['session-summary-generation', ...baseKey.slice(1), session.runtimeId, revision, attempt],
    enabled: Boolean(
      canGenerate &&
      !snapshot.isFetching &&
      !snapshot.isPlaceholderData &&
      snapshot.isSuccess &&
      revision &&
      snapshot.data?.eligible &&
      !snapshot.data.busy &&
      (!snapshot.data.error || attempt > 0) &&
      snapshot.data.stale
    ),
    queryFn: async () => {
      assertSessionOwnerResolved(owner, { method: 'session.summary', sessionId: storedId })

      const result = await generateSessionSummary(
        storedId!,
        scope,
        language,
        session.runtimeId ? { id: session.runtimeId, owner } : null,
        attempt > 0
      )

      // Carry the generated snapshot across history refreshes and panel remounts
      // without overwriting another owner or a newer transcript revision.
      client.setQueriesData<SessionSummaryResult>({ queryKey: baseKey }, current =>
        current?.source_revision === result.source_revision ? result : current
      )

      return result
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: query => Boolean(query.state.data?.busy),
    staleTime: query => (query.state.data?.busy ? 0 : Infinity),
    gcTime: 60_000
  })

  // A server may decline to save when another turn changed the transcript
  // during generation. That result cannot replace this revision's snapshot.
  const generated =
    snapshot.data?.stale && !generation.data?.busy && generation.data?.source_revision === revision
      ? generation.data
      : undefined

  const response = generated ?? snapshot.data
  const error = snapshot.error || generation.error || response?.error

  const refresh = async () => {
    if (!canGenerate) {
      return
    }

    const latest = await snapshot.refetch()

    if (latest.data?.eligible && latest.data.stale && !latest.data.busy) {
      const key = JSON.stringify([...baseKey, latest.data.source_revision])
      setRetryAttempt(previous => ({ key, count: previous.key === key ? previous.count + 1 : 1 }))
    }
  }

  return {
    summary: response?.summary ?? null,
    eligible: Boolean(response?.eligible),
    loading: snapshot.isFetching || generation.isFetching,
    stale: Boolean(response?.summary && (response.stale || busy || snapshot.isPlaceholderData)),
    error,
    errorCode: response?.error_code,
    backendBusy: Boolean(response?.busy),
    refresh,
    canRefresh: canGenerate && !snapshot.isFetching && !generation.isFetching
  }
}

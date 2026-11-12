import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getAllSessionMessages } from '@/api/sessions'
import { useSessionSlice, useStoreSelector } from '@/lib/use-session-slice'
import { $artifactRegistry } from '@/store/artifacts'
import { $previewStatusBySession } from '@/store/preview-status'
import { assertSessionOwnerResolved } from '@/store/session-owner-resolution'
import { profileScopeForSessionOwner } from '@/store/session-request-router'
import { $sessionStates } from '@/store/session-states'

import {
  EMPTY_SUMMARY_CONTENT,
  summaryHistoryContent,
  summaryOutputs,
  summaryPreviewSources,
  uniqueSummaryResources
} from './session-content'
import type { useSummarySession } from './use-summary-session'

export function useSummaryContent(session: ReturnType<typeof useSummarySession>) {
  const { busy, owner, runtimeId, scope, storedId } = session
  const artifacts = useSessionSlice($artifactRegistry, runtimeId)
  const previews = useSessionSlice($previewStatusBySession, runtimeId)
  const unsentDraft = useStoreSelector($sessionStates, states => Boolean(runtimeId && states[runtimeId]?.isUnsentDraft))
  const hasHistory = Boolean(storedId) && !unsentDraft
  // A desktop route can serve a differently named backend profile. Its owner
  // already captures that mapping; the visible workspace alias does not.
  const ownerScope = profileScopeForSessionOwner(owner)
  const readScope = typeof ownerScope === 'string' ? { ...scope, profile: ownerScope } : (ownerScope ?? scope)

  const queryKey = ['summary-content', readScope.connectionId, readScope.profile, storedId, Boolean(owner), busy] as const

  const query = useQuery({
    enabled: hasHistory,
    queryKey,
    // Keep this conversation's last snapshot while a turn boundary refreshes
    // it, but never carry data across conversation or ownership changes.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey.slice(0, -1).every((value, index) => value === queryKey[index]) ? previous : undefined,
    queryFn: async () => {
      assertSessionOwnerResolved(owner, { method: 'session.messages', sessionId: storedId })

      return summaryHistoryContent(storedId!, (await getAllSessionMessages(storedId!, readScope)).messages)
    },
    refetchOnWindowFocus: false,
    retry: false,
    // Returning to the idle key must read the completed turn, even when
    // the shared client's minute-long freshness window has not elapsed.
    staleTime: 0,
    gcTime: 60_000
  })

  const history = (hasHistory && query.data) || EMPTY_SUMMARY_CONTENT

  const outputs = useMemo(
    () => summaryOutputs(history.outputs, artifacts, previews),
    [artifacts, history.outputs, previews]
  )

  const sources = useMemo(
    () => uniqueSummaryResources([...history.sources, ...summaryPreviewSources(previews, outputs)]),
    [history.sources, outputs, previews]
  )

  return {
    ...history,
    outputs,
    sources,
    loading: hasHistory && query.isPending,
    historyReady: hasHistory && query.isSuccess && !query.isPlaceholderData,
    historyUpdatedAt: query.dataUpdatedAt,
    refreshing: query.isFetching,
    error: hasHistory ? query.error : null,
    refetch: query.refetch
  }
}

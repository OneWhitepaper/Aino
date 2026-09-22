import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getAllSessionMessages } from '@/api/sessions'
import { useSessionSlice, useStoreSelector } from '@/lib/use-session-slice'
import { $artifactRegistry } from '@/store/artifacts'
import { $previewStatusBySession } from '@/store/preview-status'
import { assertSessionOwnerResolved } from '@/store/session-owner-resolution'
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

  const queryKey = ['summary-content', scope.connectionId, scope.profile, storedId, Boolean(owner), busy] as const

  const query = useQuery({
    enabled: hasHistory,
    queryKey,
    // Keep this conversation's last snapshot while a turn boundary refreshes
    // it, but never carry data across conversation or ownership changes.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey.slice(0, -1).every((value, index) => value === queryKey[index]) ? previous : undefined,
    queryFn: async () => {
      assertSessionOwnerResolved(owner, { method: 'session.messages', sessionId: storedId })

      return summaryHistoryContent(storedId!, (await getAllSessionMessages(storedId!, scope)).messages)
    },
    refetchOnWindowFocus: false,
    retry: false,
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

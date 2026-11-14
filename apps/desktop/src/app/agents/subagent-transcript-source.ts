import type { RuntimeDescribeResult, StoredTranscriptResult } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getLatestSessionMessages } from '@/api/sessions'
import type { DelegateRow } from '@/components/assistant-ui/tool/delegate-model'
import { isMissingRpcMethod } from '@/lib/gateway-rpc'
import { useGatewayActivationEpoch } from '@/store/gateway-activation-epoch'
import { $notificationEpoch } from '@/store/notifications'
import { sessionOwnerIsKnown } from '@/store/session-owner-resolution'
import {
  profileScopeForSessionOwner,
  requestForSessionProfile,
  type SessionOwnerScope
} from '@/store/session-request-router'
import type { SessionMessage } from '@/types/hermes'

const unavailableOwner = async <T>(): Promise<T> => {
  throw new Error('Subagent owner is unavailable')
}

function canonicalMessages(pages: readonly StoredTranscriptResult[] = []): SessionMessage[] {
  // A reset after a cursor replaces every page held before that response.
  const current = pages.slice(
    Math.max(
      0,
      pages.findLastIndex(page => page.reset)
    )
  )

  const rows = current.toReversed().flatMap(page => (page.available ? page.rows : []))

  return rows
    .filter(row => row.row_kind === 'message')
    .map(row => ({
      ...row,
      content: row.content ?? row.text ?? ''
    })) as SessionMessage[]
}

function childReadInterval(visible: boolean, row: DelegateRow, pages: readonly StoredTranscriptResult[] = []) {
  // Read-only roster discoveries have no control lease but still need live output.
  const running = pages.at(-1)?.running ?? ['running', 'queued', 'dispatched'].includes(row.status)

  return visible && running ? 2000 : false
}

function childAwaitingOutput(row: DelegateRow, pages: readonly StoredTranscriptResult[] = []) {
  return pages.at(-1)?.running ?? ['running', 'queued', 'dispatched'].includes(row.status)
}

interface QueryReadState {
  isPending: boolean
  isError: boolean
  isFetching: boolean
}

function transcriptReadState(capability: QueryReadState, content: QueryReadState, tail: boolean) {
  return {
    pending: capability.isPending || (!tail && content.isPending),
    error: capability.isError || (!tail && content.isError),
    fetching: capability.isFetching || content.isFetching
  }
}

export interface SubagentTranscriptSource {
  row: DelegateRow
  parentRuntimeId: string | null
  owner: SessionOwnerScope
  live: boolean
  visible: boolean
}

/** Negotiate on the captured owner; only a proven older peer gets the legacy read. */
export function useSubagentTranscriptSource({ row, parentRuntimeId, owner, live, visible }: SubagentTranscriptSource) {
  const accountEpoch = useStore($notificationEpoch)
  const activation = useGatewayActivationEpoch()
  const ownerKnown = sessionOwnerIsKnown(owner)
  const scope = profileScopeForSessionOwner(owner)
  const key = [accountEpoch, activation, owner] as const

  const checkAccount = () => {
    if (accountEpoch !== $notificationEpoch.get()) {
      throw new Error('Subagent account changed')
    }
  }

  const request = async <T>(method: string, params: Record<string, unknown>, signal: AbortSignal) => {
    checkAccount()
    const result = await requestForSessionProfile<T>(owner, unavailableOwner, method, params, undefined, signal)
    checkAccount()

    return result
  }

  const capability = useQuery({
    queryKey: ['subagent-transcript-capability', ...key],
    enabled: visible && ownerKnown,
    queryFn: async ({ signal }) => {
      try {
        const description = await request<RuntimeDescribeResult>('runtime.describe', {}, signal)

        return description.capabilities?.includes('session-transcript-v1') === true
      } catch (error) {
        if (isMissingRpcMethod(error)) {
          return false
        }

        throw error
      }
    },
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 60_000,
    gcTime: 60_000
  })

  const childId = row.subagentId ?? row.id

  const canonical = useInfiniteQuery({
    queryKey: ['subagent-panel-transcript', ...key, parentRuntimeId, childId],
    enabled: visible && ownerKnown && Boolean(parentRuntimeId) && capability.data === true,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      request<StoredTranscriptResult>(
        'session.transcript',
        {
          session_id: parentRuntimeId,
          subagent_id: childId,
          order: 'latest',
          limit: 120,
          ...(scope ? { profile: typeof scope === 'string' ? scope : scope.profile } : {}),
          ...(pageParam ? { cursor: pageParam } : {})
        },
        signal
      ),
    getNextPageParam: last => last.next_cursor ?? undefined,
    refetchInterval: query => childReadInterval(visible, row, query.state.data?.pages),
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
    gcTime: 60_000
  })

  const useLiveTail = capability.data === false && live && Boolean(parentRuntimeId)

  const legacy = useQuery({
    queryKey: ['subagent-panel-transcript-legacy', ...key, scope, row.sessionId],
    enabled: visible && ownerKnown && Boolean(row.sessionId) && capability.data === false && !useLiveTail,
    queryFn: async () => {
      checkAccount()
      const result = await getLatestSessionMessages(row.sessionId!, scope, { passive: true })
      checkAccount()

      return result
    },
    refetchInterval: live && visible ? 2000 : false,
    refetchOnWindowFocus: false,
    retry: false,
    gcTime: 60_000,
    staleTime: 0
  })

  const native = capability.data === true
  const query = native ? canonical : legacy

  const messages = useMemo(
    () => (native ? canonicalMessages(canonical.data?.pages) : (legacy.data?.messages ?? [])),
    [native, legacy.data, canonical.data]
  )

  return {
    messages,
    ownerKnown,
    useLiveTail,
    awaitingOutput: native && childAwaitingOutput(row, canonical.data?.pages),
    unavailable: capability.isSuccess && (native ? !parentRuntimeId : !row.sessionId && !useLiveTail),
    ...transcriptReadState(capability, query, useLiveTail),
    retry: () => (capability.isError ? capability.refetch() : query.refetch()),
    hasEarlier: native && canonical.hasNextPage,
    fetchingEarlier: canonical.isFetchingNextPage,
    loadEarlier: () => canonical.fetchNextPage()
  }
}

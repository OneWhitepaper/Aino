import { JsonRpcGatewayError } from '@hermes/shared'
import type { ConversationListResult } from '@hermes/shared/gateway-events'
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { $connectionsRegistry } from '@/store/connection-registry-state'
import { $conversationRecords } from '@/store/conversations'
import { $activeGatewayConnectionId, requestGatewayForAgent } from '@/store/gateway'

import type { ConversationListRow } from './conversation-list'

/** List ownership comes from the issuing connection, never the next responder. */
export function useConversationList(includeArchived: boolean) {
  const registry = useStore($connectionsRegistry)
  const active = useStore($activeGatewayConnectionId)
  const records = useStore($conversationRecords)
  const [rows, setRows] = useState<ConversationListRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const sources = JSON.stringify([
    ...new Set([active, ...(registry?.connections ?? []).map(row => row.id)].filter((id): id is string => Boolean(id)))
  ])

  useEffect(() => {
    let cancelled = false
    const ids: string[] = JSON.parse(sources)
    setError(null)
    void Promise.allSettled(
      ids.map(async connectionId => {
        const found: ConversationListRow[] = []
        let cursor: string | null = null
        const visited = new Set<string>()

        do {
          let page: ConversationListResult

          try {
            page = await requestGatewayForAgent<ConversationListResult>(connectionId, 'default', 'conversations.list', {
              cursor,
              limit: 100,
              include_archived: true
            })
          } catch (error) {
            if (error instanceof JsonRpcGatewayError && error.code === -32601) {
              return []
            }
            throw error
          }

          found.push(
            ...page.conversations.map(record => ({
              kind: 'conversation' as const,
              owner: { connectionId, installId: record.general.install_id, conversationId: record.conversation_id },
              record
            }))
          )

          if (!page.has_more) {
            break
          }

          if (!page.cursor || visited.has(page.cursor)) {
            throw new Error('Conversation history cursor did not advance')
          }
          visited.add(page.cursor)
          cursor = page.cursor
        } while (!cancelled)

        return found
      })
    ).then(groups => {
      if (cancelled) {
        return
      }
      setRows(previous =>
        groups.flatMap((group, index) =>
          group.status === 'fulfilled' ? group.value : previous.filter(row => row.owner.connectionId === ids[index])
        )
      )
      const failures = groups.filter(group => group.status === 'rejected')

      if (failures.length) {
        setError(failures.map(group => String(group.reason)).join('; '))
      }
    })

    return () => {
      cancelled = true
    }
  }, [sources, includeArchived, attempt, records])

  return {
    rows: rows.filter(row => row.record.archived === includeArchived),
    mappings: rows,
    error,
    retry: useCallback(() => setAttempt(value => value + 1), [])
  }
}

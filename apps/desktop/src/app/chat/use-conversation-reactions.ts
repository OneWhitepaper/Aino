import { JsonRpcGatewayError } from '@hermes/shared'
import type { ConversationReactionState, ConversationReactParams } from '@hermes/shared/gateway-events'
import { useEffect, useMemo, useRef, useState } from 'react'

import { type ConversationOwner, conversationOwnerKey } from '@/store/conversation-owner'

import { createConversationHistoryActions } from './conversation-history-actions'

export function useConversationReactions(owner: ConversationOwner, eventIds: string[]) {
  const key = conversationOwnerKey(owner)
  const ownerKey = useRef(key)
  ownerKey.current = key
  const actions = useMemo(() => createConversationHistoryActions(owner), [key])
  const [states, setStates] = useState<Record<string, ConversationReactionState>>({})
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const pending = useRef(new Map<string, ConversationReactParams>())
  const ids = JSON.stringify(eventIds)
  useEffect(() => {
    let cancelled = false
    void actions
      .reactions(JSON.parse(ids))
      .then(rows => {
        if (cancelled) {
          return
        }
        setStates(previous =>
          Object.fromEntries(
            rows.map(row => [
              row.event_id,
              previous[row.event_id]?.revision > row.revision ? previous[row.event_id] : row
            ])
          )
        )
        setError(null)
      })
      .catch(reason => {
        if (!cancelled) {
          setError(String(reason))
        }
      })

    return () => {
      cancelled = true
    }
  }, [actions, ids, attempt])

  async function react(eventId: string, emoji: string | null) {
    const operationKey = JSON.stringify([key, eventId, emoji])
    let params = pending.current.get(operationKey)

    if (!params) {
      if (!states[eventId]) {
        throw new Error('Reaction metadata is unavailable')
      }
      params = {
        conversation_id: owner.conversationId,
        event_id: eventId,
        emoji,
        operation_id: crypto.randomUUID(),
        expected_reaction_revision: states[eventId].revision
      }
      pending.current.set(operationKey, params)
    }

    try {
      const result = await actions.rpc('conversations.react', params)

      if (result.reaction.event_id !== eventId) {
        throw new Error('Reaction response belongs to another event')
      }
      pending.current.delete(operationKey)

      if (ownerKey.current !== key) {
        return
      }
      setStates(previous =>
        previous[eventId]?.revision > result.reaction.revision ? previous : { ...previous, [eventId]: result.reaction }
      )
      setError(null)
    } catch (reason) {
      if (reason instanceof JsonRpcGatewayError && reason.code === 4120) {
        pending.current.delete(operationKey)
      }

      if (ownerKey.current !== key) {
        throw reason
      }
      setError(String(reason))
      setAttempt(value => value + 1)
      throw reason
    }
  }

  return { states, react, error, retry: () => setAttempt(value => value + 1) }
}

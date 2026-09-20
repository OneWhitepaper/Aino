import { Loader } from '@/components/ui/loader'
import type { ConversationCapabilities, ConversationCatalogEntry } from '@hermes/shared/gateway-events'
import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { $activeGatewayConnectionId, requestGatewayForAgent } from '@/store/gateway'

import { conversationRoute } from '../routes'

import { createConversationActions } from './conversation-actions'
import { ConversationView } from './conversation-view'

/** Explicit A-phase entry. Ordinary New Chat continues to use the legacy session route. */
export function ConversationRoute() {
  const connectionId = useStore($activeGatewayConnectionId)
  const { conversationId } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const copy = t.composer.conversation
  const [loadedConnection, setLoadedConnection] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [catalog, setCatalog] = useState<ConversationCatalogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const creations = useRef(new Map<string, Promise<string>>())
  const creationIds = useRef(new Map<string, string>())

  useEffect(() => {
    let disposed = false
    if (conversationId !== 'new') {
      creations.current.clear()
      creationIds.current.clear()
    }
    setCatalog(null)
    setError(null)

    if (!connectionId) {
      return
    }

    void (async () => {
      const capabilities = await requestGatewayForAgent<ConversationCapabilities>(
        connectionId,
        'default',
        'conversations.capabilities',
        {}
      )

      if (capabilities.protocol_version !== 1 || (conversationId === 'new' && !capabilities.enabled)) {
        throw new Error(capabilities.reason || copy.unavailable)
      }

      const result = await requestGatewayForAgent<{ participants: ConversationCatalogEntry[] }>(
        connectionId,
        'default',
        'conversations.participants',
        {}
      )

      if (conversationId === 'new') {
        const general = result.participants.find(entry => entry.participant.is_general && entry.available)
        if (!general) throw new Error(copy.unavailable)
        const sourceKey = JSON.stringify([connectionId, general.participant.install_id])
        let creating = creations.current.get(sourceKey)
        if (!creating) {
          const id = creationIds.current.get(sourceKey) ?? crypto.randomUUID()
          creationIds.current.set(sourceKey, id)
          const next = { connectionId, installId: general.participant.install_id, conversationId: id }
          creating = createConversationActions(next)
            .create({ title: copy.title, general_participant_id: general.participant.participant_id })
            .then(() => next.conversationId)
            .catch(error => {
              creations.current.delete(sourceKey)
              throw error
            })
          creations.current.set(sourceKey, creating)
        }
        const createdId = await creating
        if (!disposed && $activeGatewayConnectionId.get() === connectionId)
          navigate(conversationRoute(createdId), { replace: true })
        return
      }
      if (!disposed) {
        setCatalog(result.participants)
        setLoadedConnection(connectionId)
      }
    })().catch(reason => {
      if (!disposed) {
        setError(String(reason instanceof Error ? reason.message : reason))
      }
    })

    return () => {
      disposed = true
    }
  }, [connectionId, conversationId, copy.unavailable, attempt])

  const general = catalog?.find(entry => entry.participant.is_general)

  if (error) {
    return (
      <div className="p-6" role="alert">
        {error}
        <Button onClick={() => setAttempt(value => value + 1)}>{copy.refresh}</Button>
      </div>
    )
  }

  if (!catalog || !connectionId || loadedConnection !== connectionId) {
    return (
      <div className="grid h-full place-items-center">
        <Loader label={copy.loading} />
      </div>
    )
  }

  if (!general || !conversationId) {
    return (
      <div className="p-6" role="alert">
        {copy.unavailable}
      </div>
    )
  }

  const owner = { connectionId, installId: general.participant.install_id, conversationId }

  return <ConversationView key={JSON.stringify(owner)} owner={owner} />
}

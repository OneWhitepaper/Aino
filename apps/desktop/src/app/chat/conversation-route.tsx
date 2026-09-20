import type { ConversationCapabilities, ConversationCatalogEntry } from '@hermes/shared/gateway-events'
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
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
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let disposed = false
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
      <div className="p-6" role="status">
        {copy.loading}
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

  if (conversationId !== 'new') {
    return <ConversationView key={JSON.stringify(owner)} owner={owner} />
  }

  const create = async () => {
    setCreating(true)

    try {
      const next = { ...owner, conversationId: crypto.randomUUID() }
      await createConversationActions(next).create({
        title: copy.title,
        general_participant_id: general.participant.participant_id
      })

      if ($activeGatewayConnectionId.get() === next.connectionId) {
        navigate(conversationRoute(next.conversationId))
      }
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="grid h-full place-content-center gap-4 p-6">
      <h1>{copy.title}</h1>
      <Button disabled={creating || !general.available} onClick={() => void create()}>
        {copy.create}
      </Button>
    </div>
  )
}

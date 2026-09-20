import { JsonRpcGatewayError } from '@hermes/shared'
import type { ConversationGetResult, ConversationListResult, MigrationReceipt } from '@hermes/shared/gateway-events'

import type { SessionInfo } from '@/hermes'
import type { ConversationOwner } from '@/store/conversation-owner'
import { requestGatewayForAgent } from '@/store/gateway'
import type { SessionOwnerRoute } from '@/store/session-request-router'

/** Reads never adopt. An old link resolves only a completed, exact source binding. */
export async function migratedConversation(
  owner: SessionOwnerRoute,
  sessionId: string,
  request = requestGatewayForAgent
): Promise<ConversationOwner | null> {
  let cursor: string | null = null
  const visited = new Set<string>()

  do {
    let page: ConversationListResult

    try {
      page = await request<ConversationListResult>(owner.connectionId, 'default', 'conversations.list', {
        cursor,
        limit: 100,
        include_archived: true
      })
    } catch (error) {
      if (error instanceof JsonRpcGatewayError && error.code === -32601) {
        return null
      }
      throw error
    }

    const record = page.conversations.find(record => {
      const migration = record.migration

      return (
        migration?.status === 'complete' &&
        migration.source_profile === (owner.targetProfile || owner.profile) &&
        [migration.source_lineage_id, ...(migration.source_session_ids ?? [])].includes(sessionId)
      )
    })

    if (record) {
      return {
        connectionId: owner.connectionId,
        installId: record.general.install_id,
        conversationId: record.conversation_id
      }
    }

    if (!page.has_more) {
      return null
    }

    if (!page.cursor || visited.has(page.cursor)) {
      throw new Error('Conversation history cursor did not advance')
    }
    visited.add(page.cursor)
    cursor = page.cursor
  } while (cursor)

  return null
}

const attempts = new Map<string, { conversationId: string; inputId: string }>()

/** The same explicit adoption retries the same write, including lost acknowledgements. */
export async function adoptLegacyConversation(
  owner: SessionOwnerRoute,
  sessionId: string,
  request = requestGatewayForAgent
): Promise<ConversationOwner> {
  const key = JSON.stringify([owner.connectionId, owner.targetProfile || owner.profile, sessionId])
  const storageKey = `hermes.desktop.conversationAdoption:${key}`
  let saved: { conversationId: string; inputId: string } | null = null

  try {
    const value = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null')

    if (typeof value?.conversationId === 'string' && typeof value?.inputId === 'string') {
      saved = value
    }
  } catch {
    /* Invalid window intent is ignored. */
  }

  const ids = attempts.get(key) ?? saved ?? { conversationId: crypto.randomUUID(), inputId: crypto.randomUUID() }
  attempts.set(key, ids)
  window.sessionStorage.setItem(storageKey, JSON.stringify(ids))

  const { migration } = await request<{ migration: MigrationReceipt }>(
    owner.connectionId,
    owner.targetProfile || owner.profile,
    'conversations.adopt',
    {
      source_profile: owner.targetProfile || owner.profile,
      lineage_id: sessionId,
      conversation_id: ids.conversationId,
      input_id: ids.inputId
    }
  )

  if (migration.status !== 'complete') {
    throw new Error(`Migration ${migration.status}`)
  }

  const { conversation } = await request<ConversationGetResult>(owner.connectionId, 'default', 'conversations.get', {
    conversation_id: migration.conversation_id
  })

  return {
    connectionId: owner.connectionId,
    installId: conversation.general.install_id,
    conversationId: conversation.conversation_id
  }
}

/** Migration discovery is an optional read; the source backend owns its write fence. */
export async function resolveLegacyMigration(
  owner: SessionOwnerRoute,
  sessionId: string,
  session: Pick<SessionInfo, 'source' | 'title'> | undefined,
  onReadError: (error: unknown) => void,
  request = requestGatewayForAgent
): Promise<ConversationOwner | null> {
  if (
    session &&
    (!['cli', 'tui', 'desktop', 'web', 'webui'].includes(session.source ?? '') || session.title === 'Bot Chat')
  ) {
    return null
  }

  try {
    return await migratedConversation(owner, sessionId, request)
  } catch (error) {
    onReadError(error)

    return null
  }
}

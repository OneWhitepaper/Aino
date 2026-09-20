import type { ConversationParticipantRef } from '@hermes/shared/gateway-events'

import type { SessionOwnerRoute } from './session-request-router'

export interface ConversationOwner {
  conversationId: string
  connectionId: string
  installId: string
}

export function conversationOwnerKey(owner: ConversationOwner): string {
  const values = [owner.connectionId, owner.installId, owner.conversationId]

  if (values.some(value => !value.trim())) {
    throw new Error('Conversation requires an exact connection, installation and identity')
  }

  return JSON.stringify(values)
}

export function participantSessionOwner(
  owner: ConversationOwner,
  participant: Pick<ConversationParticipantRef, 'install_id' | 'profile'>
): SessionOwnerRoute {
  conversationOwnerKey(owner)

  if (participant.install_id !== owner.installId || !participant.profile.trim()) {
    throw new Error('Participant does not belong to the conversation installation')
  }

  // All participants are hosted by the conversation service on the default gateway.
  // Selecting an expert changes Profile data, not the process/socket owning its runtime.
  return { connectionId: owner.connectionId, profile: 'default', targetProfile: participant.profile }
}

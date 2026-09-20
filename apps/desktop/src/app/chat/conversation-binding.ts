import type { ConversationModelPreparation, ConversationParticipantRef } from '@hermes/shared/gateway-events'

import type { bindSelectedPlatformSession } from '@/api/platform-session-binding'
import { platformModelStatePatch, type PlatformRuntimeFields } from '@/lib/platform-session-model'
import { type ConversationOwner, participantSessionOwner } from '@/store/conversation-owner'
import { platformModelCatalog } from '@/store/platform-models'

export async function bindConversationParticipant(
  owner: ConversationOwner,
  participant: ConversationParticipantRef,
  prepared: ConversationModelPreparation,
  bind: typeof bindSelectedPlatformSession,
  request: <T>(method: string, params?: Record<string, unknown>, timeout?: number) => Promise<T>
) {
  const sessionOwner = participantSessionOwner(owner, participant)

  if (prepared.profile !== participant.profile) {
    throw new Error('Prepared runtime belongs to another participant')
  }

  const config = prepared.model_config as PlatformRuntimeFields

  if (config.model_source !== 'aino') {
    return
  }

  const selection = platformModelStatePatch(config).platformModel

  if (!selection) {
    throw new Error('Prepared platform model is unavailable')
  }

  const hasOwner = Boolean(config.platform_owner)

  if (!hasOwner) {
    const account = platformModelCatalog().account.get()

    if (account?.phase !== 'signed_in' || !account.account) {
      throw new Error('Platform account is not signed in')
    }

    selection.ownerUserId = account.account.id
  }

  await bind(sessionOwner, prepared.session_id, selection, request, hasOwner)
}

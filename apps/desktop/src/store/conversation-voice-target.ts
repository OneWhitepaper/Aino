import type { GatewayEvent } from '@hermes/shared'
import { atom } from 'nanostores'

import { $foregroundConversationOwner } from './conversation-runtime'
import { $activeGatewayConnectionId } from './gateway'

export interface ConversationVoiceTarget {
  key: string
  connectionId: string
  profile: string
  isCurrent: () => boolean
  start: () => void
  stopCapture: () => void
}
export const $conversationVoiceTarget = atom<ConversationVoiceTarget | null>(null)

/** Managed foreground consumes wake events, including mismatches; never fall through to ambient new-chat. */
export function consumeConversationWake(event: GatewayEvent): boolean {
  if (!$foregroundConversationOwner.get()) {
    return false
  }
  const target = $conversationVoiceTarget.get()
  const profile = (event.payload as { profile?: string } | undefined)?.profile?.trim() || 'default'
  const connection = event.connectionId ?? $activeGatewayConnectionId.get()

  if (target?.isCurrent() && target.connectionId === connection && target.profile === profile) {
    target.stopCapture()
    target.start()
  }

  return true
}

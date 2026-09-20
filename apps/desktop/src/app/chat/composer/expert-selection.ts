import type { ConversationOwner } from '@/store/conversation-owner'
import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationDrafts, setConversationDraft } from '@/store/conversations'

export interface ParticipantOption {
  id: string
  displayName: string
  sourceLabel: string
  sourceId?: string
  isGeneral: boolean
  unavailableReason?: string
}

export interface ConversationComposerContext {
  owner: ConversationOwner
  participants: readonly ParticipantOption[]
}

/** Dropdown and structured @ picks change only the next recipient in this exact draft. */
export function selectConversationExpert(context: ConversationComposerContext, participantId: string): boolean {
  const participant = context.participants.find(option => option.id === participantId)
  const draft = $conversationDrafts.get()[conversationOwnerKey(context.owner)]

  if (!draft || !participant || participant.unavailableReason) {
    return false
  }

  if (draft.selectedParticipantId !== participantId) {
    setConversationDraft(context.owner, { ...draft, selectedParticipantId: participantId })
  }

  return true
}

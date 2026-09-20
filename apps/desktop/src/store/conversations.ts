import type { ConversationRecord } from '@hermes/shared/gateway-events'
import { atom } from 'nanostores'

import { type ConversationOwner, conversationOwnerKey } from './conversation-owner'

export interface ConversationDraft {
  conversationId: string
  selectedParticipantId: string
  text: string
  attachmentIds: string[]
  revision: number
  inputVersion: string
}

export interface FrozenConversationSend {
  conversationId: string
  participantId: string
  text: string
  attachmentIds: readonly string[]
  expectedRevision: number
  inputId: string
  turnId: string
  draftVersion: string
  commandToken?: string
  surface?: 'voice-live'
  voiceContext?: string
  sourceText?: string
}

// Drafts are window intent. Records cache backend truth; public history is never
// persisted as a renderer-owned replacement for the shared event log.
export const $conversationDrafts = atom<Record<string, ConversationDraft>>({})
export const $conversationRecords = atom<Record<string, ConversationRecord>>({})

export function freezeConversationSend(
  draft: ConversationDraft,
  ids: { inputId: string; turnId: string }
): FrozenConversationSend {
  return Object.freeze({
    conversationId: draft.conversationId,
    participantId: draft.selectedParticipantId,
    text: draft.text,
    attachmentIds: Object.freeze([...draft.attachmentIds]),
    expectedRevision: draft.revision,
    draftVersion: draft.inputVersion,
    ...ids
  })
}

export function setConversationDraft(
  owner: ConversationOwner,
  draft: Omit<ConversationDraft, 'inputVersion'>
): ConversationDraft {
  if (owner.conversationId !== draft.conversationId) {
    throw new Error('Draft belongs to another conversation')
  }

  const key = conversationOwnerKey(owner)
  const current = $conversationDrafts.get()[key]

  const unchangedInput =
    current &&
    current.text === draft.text &&
    current.attachmentIds.length === draft.attachmentIds.length &&
    current.attachmentIds.every((value, index) => value === draft.attachmentIds[index])

  if (
    unchangedInput &&
    current.selectedParticipantId === draft.selectedParticipantId &&
    current.revision === draft.revision
  ) {
    return current
  }

  const next = {
    ...draft,
    attachmentIds: [...draft.attachmentIds],
    inputVersion: unchangedInput ? current.inputVersion : crypto.randomUUID()
  }

  $conversationDrafts.set({
    ...$conversationDrafts.get(),
    [key]: next
  })

  return next
}

export function cacheConversation(owner: ConversationOwner, record: ConversationRecord): void {
  if (record.conversation_id !== owner.conversationId || record.general.install_id !== owner.installId) {
    throw new Error('Conversation response belongs to another owner')
  }

  const key = conversationOwnerKey(owner)
  const current = $conversationRecords.get()[key]

  if (current && current.revision >= record.revision) {
    return
  }

  $conversationRecords.set({ ...$conversationRecords.get(), [key]: record })
}

export function acceptConversationSend(owner: ConversationOwner, sent: FrozenConversationSend, revision: number): void {
  if (owner.conversationId !== sent.conversationId) {
    throw new Error('Send acknowledgement belongs to another conversation')
  }

  const draft = $conversationDrafts.get()[conversationOwnerKey(owner)]

  if (!draft) {
    return
  }

  const stillSubmittedInput =
    draft.inputVersion === sent.draftVersion &&
    draft.text === (sent.sourceText ?? sent.text) &&
    draft.attachmentIds.length === sent.attachmentIds.length &&
    draft.attachmentIds.every((value, index) => value === sent.attachmentIds[index])

  setConversationDraft(owner, {
    ...draft,
    revision: Math.max(draft.revision, revision),
    ...(stillSubmittedInput ? { text: '', attachmentIds: [] } : {})
  })
}

import { atom } from 'nanostores'

import { type ConversationOwner, conversationOwnerKey } from './conversation-owner'

export interface ConversationPrivateNotice {
  participantId: string
  displayName: string
  command?: string
  output: string
  error?: boolean
  refreshRequired?: boolean
}
// Selected-participant /prompt or /history output must never enter public events or another model's input.
export const $conversationPrivateNotices = atom<Record<string, ConversationPrivateNotice>>({})

export function setConversationPrivateNotice(owner: ConversationOwner, notice: ConversationPrivateNotice): void {
  $conversationPrivateNotices.set({ ...$conversationPrivateNotices.get(), [conversationOwnerKey(owner)]: notice })
}

export function dismissConversationPrivateNotice(owner: ConversationOwner): void {
  const next = { ...$conversationPrivateNotices.get() }
  delete next[conversationOwnerKey(owner)]
  $conversationPrivateNotices.set(next)
}

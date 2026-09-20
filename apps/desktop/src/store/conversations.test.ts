import { beforeEach, describe, expect, it, vi } from 'vitest'

import { conversationOwnerKey } from './conversation-owner'
import {
  $conversationDrafts,
  acceptConversationSend,
  freezeConversationSend,
  setConversationDraft
} from './conversations'

describe('conversation draft ownership', () => {
  beforeEach(() => $conversationDrafts.set({}))

  it('freezes the submitted recipient and attachments while later selection stays local to its conversation', () => {
    const owner = { conversationId: 'novel', connectionId: 'local', installId: 'host' }
    const other = { ...owner, conversationId: 'media' }

    const draft = {
      conversationId: 'novel',
      selectedParticipantId: 'a',
      text: 'Scene',
      attachmentIds: ['file'],
      revision: 2
    }

    const stored = setConversationDraft(owner, draft)
    setConversationDraft(other, { ...draft, conversationId: 'media', selectedParticipantId: 'general' })
    const sent = freezeConversationSend(stored, { inputId: 'i1', turnId: 't1' })
    draft.selectedParticipantId = 'b'
    draft.attachmentIds.push('later-file')
    setConversationDraft(owner, draft)
    expect(sent.participantId).toBe('a')
    expect(sent.attachmentIds).toEqual(['file'])
    expect(Object.isFrozen(sent)).toBe(true)
    expect($conversationDrafts.get()[conversationOwnerKey(other)].selectedParticipantId).toBe('general')
    acceptConversationSend(owner, sent, 3)
    expect($conversationDrafts.get()[conversationOwnerKey(owner)]).toMatchObject({
      selectedParticipantId: 'b',
      text: 'Scene',
      attachmentIds: ['file', 'later-file'],
      revision: 3
    })
  })

  it('clears only the acknowledged input without changing the next speaker or another connection', () => {
    const owner = { conversationId: 'same-id', connectionId: 'first', installId: 'host' }
    const other = { ...owner, connectionId: 'second' }

    const draft = {
      conversationId: owner.conversationId,
      selectedParticipantId: 'a',
      text: 'Question',
      attachmentIds: [],
      revision: 1
    }

    const stored = setConversationDraft(owner, draft)
    setConversationDraft(other, draft)
    const sent = freezeConversationSend(stored, { inputId: 'i', turnId: 't' })
    setConversationDraft(owner, { ...draft, selectedParticipantId: 'b' })
    acceptConversationSend(owner, sent, 2)
    expect($conversationDrafts.get()[conversationOwnerKey(owner)]).toMatchObject({
      selectedParticipantId: 'b',
      text: ''
    })
    expect($conversationDrafts.get()[conversationOwnerKey(other)].text).toBe('Question')
    // Retyping the same bytes is new intent, even if an old acknowledgement arrives again.
    const next = setConversationDraft(owner, { ...draft, selectedParticipantId: 'b' })
    expect(next.inputVersion).not.toBe(sent.draftVersion)
    acceptConversationSend(owner, sent, 2)
    expect($conversationDrafts.get()[conversationOwnerKey(owner)].text).toBe('Question')
    const second = freezeConversationSend(next, { inputId: 'i2', turnId: 't2' })
    setConversationDraft(owner, { ...next, text: 'Changed' })
    setConversationDraft(owner, next)
    acceptConversationSend(owner, second, 3)
    expect($conversationDrafts.get()[conversationOwnerKey(owner)].text).toBe('Question')
  })
})

it('does not re-notify an unchanged rich draft while preserving recipient and revision changes', () => {
  const owner = { connectionId: 'local', installId: 'install', conversationId: 'rich-noop' }

  const original = setConversationDraft(owner, {
    conversationId: owner.conversationId,
    selectedParticipantId: 'general',
    text: 'Long editor row\n'.repeat(45),
    attachmentIds: [],
    revision: 1
  })

  const updates = vi.fn()
  const off = $conversationDrafts.listen(updates)

  try {
    expect(setConversationDraft(owner, { ...original, attachmentIds: [] })).toBe(original)
    expect(updates).not.toHaveBeenCalled()
    const selected = setConversationDraft(owner, { ...original, selectedParticipantId: 'writer' })
    expect(selected.selectedParticipantId).toBe('writer')
    expect(selected.inputVersion).toBe(original.inputVersion)
    const advanced = setConversationDraft(owner, { ...selected, revision: 2 })
    expect(advanced.revision).toBe(2)
    expect(updates).toHaveBeenCalledTimes(2)
  } finally {
    off()
  }
})

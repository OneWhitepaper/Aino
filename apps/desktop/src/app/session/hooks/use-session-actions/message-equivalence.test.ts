import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '@/lib/chat-messages'

import { chatMessagesEquivalent } from './message-equivalence'

describe('failed-turn notice equivalence', () => {
  it('publishes a resolved error without requiring a text or diagnostic change', () => {
    const failed: ChatMessage = { id: 'failed', role: 'assistant', parts: [], error: 'Model unavailable' }
    expect(chatMessagesEquivalent(failed, { ...failed, errorResolved: 'model_changed' })).toBe(false)
  })

  it('publishes marker changes even when its stored text is unchanged', () => {
    const plain: ChatMessage = {
      id: 'notice',
      role: 'system',
      parts: [{ type: 'text', text: 'This turn failed before producing a response.' }]
    }

    const notice: ChatMessage = { ...plain, failedTurnNotice: true }

    expect(chatMessagesEquivalent(plain, notice)).toBe(false)
    expect(chatMessagesEquivalent(notice, plain)).toBe(false)
    expect(chatMessagesEquivalent(notice, { ...notice })).toBe(true)
  })
})

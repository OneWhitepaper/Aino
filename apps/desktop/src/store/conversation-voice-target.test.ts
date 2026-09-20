import { afterEach, expect, it, vi } from 'vitest'

import { $foregroundConversationOwner } from './conversation-runtime'
import { $conversationVoiceTarget, consumeConversationWake } from './conversation-voice-target'

afterEach(() => {
  $foregroundConversationOwner.set(null)
  $conversationVoiceTarget.set(null)
})
it('consumes managed wake without ambient fallthrough and starts only the exact current source/profile', () => {
  $foregroundConversationOwner.set({ connectionId: 'remote', installId: 'host', conversationId: 'room' })

  const start = vi.fn(),
    stopCapture = vi.fn()

  $conversationVoiceTarget.set({
    key: 'owner:writer:2',
    connectionId: 'remote',
    profile: 'writer',
    isCurrent: () => true,
    start,
    stopCapture
  })
  expect(
    consumeConversationWake({
      type: 'wake.detected',
      connectionId: 'local',
      payload: { profile: 'writer', start_new_session: true }
    })
  ).toBe(true)
  expect(start).not.toHaveBeenCalled()
  expect(
    consumeConversationWake({
      type: 'wake.detected',
      connectionId: 'remote',
      payload: { profile: 'writer', start_new_session: true }
    })
  ).toBe(true)
  expect(stopCapture).toHaveBeenCalledOnce()
  expect(start).toHaveBeenCalledOnce()
  $conversationVoiceTarget.set(null)
  expect(
    consumeConversationWake({ type: 'wake.detected', connectionId: 'remote', payload: { profile: 'writer' } })
  ).toBe(true)
  $foregroundConversationOwner.set(null)
  expect(consumeConversationWake({ type: 'wake.detected' })).toBe(false)
})

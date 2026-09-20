import { act, cleanup, render, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, expect, it, vi } from 'vitest'

import {
  $conversationRuntime,
  $foregroundConversationOwner,
  updateConversationRuntime
} from '@/store/conversation-runtime'
import { requestGatewayForAgent } from '@/store/gateway'

import { ConversationVoiceOwner } from './conversation-voice-owner'
import type { OwnedVoiceContext } from './owned-voice-context'
import { useOwnedVoice } from './owned-voice-context'
const dispose = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/store/wake-word', () => ({
  createWakeWordController: () => ({
    state: atom({}),
    arm: vi.fn(async () => {}),
    toggle: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    dispose
  })
}))
vi.mock('@/store/gateway', () => ({
  requestGatewayForAgent: vi.fn(async () => ({ config: { voice: { stop_phrases: [], thinking_sound: false } } }))
}))
vi.mock('@/lib/voice-live', () => ({ fetchVoiceLiveStatus: vi.fn(async () => ({ mode: 'chained', available: true })) }))
vi.mock('@/lib/voice-playback', () => ({ stopVoicePlayback: vi.fn() }))
let context: OwnedVoiceContext

function Probe() {
  context = useOwnedVoice()!

  return null
}

afterEach(() => {
  cleanup()
  $conversationRuntime.set({})
  $foregroundConversationOwner.set(null)
  vi.clearAllMocks()
})
it('projects only public owned events and revokes old callbacks when the selected generation changes', async () => {
  const owner = { connectionId: 'remote', installId: 'host', conversationId: 'room' }
  $foregroundConversationOwner.set(owner)
  updateConversationRuntime(owner, {
    historyLoaded: true,
    snapshot: {
      conversation: {
        conversation_id: 'room',
        title: 'Room',
        revision: 1,
        archived: false,
        project: null,
        general: { participant_id: 'writer', profile: 'writer', install_id: 'host', display_name: 'Writer' }
      },
      active_turn: null,
      pending_delegations: [],
      participants: [
        {
          conversation_id: 'room',
          session_generation: 1,
          lineage_id: null,
          participant: { participant_id: 'writer', profile: 'writer', install_id: 'host', display_name: 'Writer' }
        }
      ]
    },
    events: [
      {
        room_id: 'room',
        event_id: 'public',
        seq: 1,
        kind: 'conversation.response',
        actor: { kind: 'participant', id: 'writer' },
        authority_epoch: 1,
        created_at: 1,
        payload: { text: 'Public answer', status: 'settled' }
      },
      {
        room_id: 'room',
        event_id: 'meta',
        seq: 2,
        kind: 'configuration',
        actor: { kind: 'participant', id: 'writer' },
        authority_epoch: 1,
        created_at: 1,
        payload: { text: 'Not public speech' }
      }
    ]
  })

  const view = (generation: number) => (
    <ConversationVoiceOwner
      generation={generation}
      owner={owner}
      participantId={generation === 1 ? 'writer' : 'reviewer'}
      profile={generation === 1 ? 'writer' : 'reviewer'}
    >
      <Probe />
    </ConversationVoiceOwner>
  )

  const { rerender, unmount } = render(view(1))
  await waitFor(() => expect(context.stopPhrases).toEqual([]))
  expect(context.$messages.get().map(message => message.parts)).toEqual([[{ type: 'text', text: 'Public answer' }]])
  expect(requestGatewayForAgent).toHaveBeenCalledWith('remote', 'default', 'config.get', {
    key: 'full',
    profile: 'writer'
  })
  expect(context.playbackScope(context.$messages.get()[0].id)).toEqual({ connectionId: 'remote', profile: 'writer' })
  const old = context
  await act(async () => {
    rerender(view(2))
    await Promise.resolve()
  })
  expect(old.isCurrent()).toBe(false)
  expect(context.isCurrent()).toBe(true)
  expect(context.scope).toEqual({ connectionId: 'remote', profile: 'reviewer' })
  expect(context.playbackScope(context.$messages.get()[0].id)).toEqual({ connectionId: 'remote', profile: 'writer' })
  expect(dispose).toHaveBeenCalled()
  unmount()
  expect(context.isCurrent()).toBe(false)
})

import type { ConversationEvent } from '@hermes/shared/gateway-events'
import { afterEach, expect, it, vi } from 'vitest'

import { $conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import { $conversationRecords } from '@/store/conversations'

import { createConversationHistoryActions } from './conversation-history-actions'

vi.mock('@/store/gateway', () => ({
  requestGatewayForAgent: vi.fn(),
  retainGatewayForAgent: vi.fn(async () => () => {})
}))
vi.mock('./conversation-actions', () => ({ createConversationActions: () => ({ load: vi.fn(async () => {}) }) }))
afterEach(() => {
  $conversationRuntime.set({})
  $conversationRecords.set({})
})

it('retries ambiguous branches with identical source/version/target identities while preserving the original conversation', async () => {
  const owner = { connectionId: 'remote', installId: 'host', conversationId: 'source' }
  const general = { participant_id: 'general', profile: 'default', install_id: 'host', display_name: 'Aino' }
  const record = { conversation_id: 'source', general, title: 'Original', revision: 4, project: null, archived: false }
  updateConversationRuntime(owner, {
    snapshot: { conversation: record, participants: [], active_turn: null, pending_delegations: [] }
  })

  const event: ConversationEvent = {
    room_id: 'source',
    seq: 1,
    actor: { kind: 'user', id: 'owner' },
    authority_epoch: 1,
    created_at: 1,
    event_id: 'original-input',
    kind: 'conversation.input',
    payload: { text: 'Original' }
  }

  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error('Lost branch acknowledgement'))
    .mockImplementation(async (_connection, _profile, _method, params) => ({
      conversation: { ...record, conversation_id: params.target_conversation_id, revision: 1 },
      branch: { conversation_id: params.target_conversation_id, operation_id: params.operation_id }
    }))

  const actions = createConversationHistoryActions(owner, request as never)
  await expect(actions.branch(event, 'Edited')).rejects.toThrow('Lost branch acknowledgement')
  updateConversationRuntime(owner, {
    snapshot: { conversation: { ...record, revision: 5 }, participants: [], active_turn: null, pending_delegations: [] }
  })
  const child = await actions.branch(event, 'Edited')
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0])
  expect(request.mock.calls[0].slice(0, 3)).toEqual(['remote', 'default', 'conversations.branch'])
  expect(request.mock.calls[0][3]).toMatchObject({
    conversation_id: 'source',
    source_event_id: event.event_id,
    expected_revision: 4,
    edit_text: 'Edited'
  })
  expect(child).toMatchObject({ connectionId: 'remote', installId: 'host' })
  expect(child.conversationId).not.toBe('source')
  expect(record.title).toBe('Original')
})

it('reconciles a lost regeneration acknowledgement with one identity, then gives a later intentional attempt fresh IDs', async () => {
  const owner = { connectionId: 'remote', installId: 'host', conversationId: 'regen' }
  const participant = { participant_id: 'writer', profile: 'writer', install_id: 'host', display_name: 'Writer' }

  const conversation = {
    conversation_id: 'regen',
    general: participant,
    title: 'Original',
    revision: 5,
    project: null,
    archived: false
  }

  const snapshot = {
    conversation,
    participants: [{ conversation_id: 'regen', participant, session_generation: 3, lineage_id: null }],
    active_turn: null,
    pending_delegations: []
  }

  updateConversationRuntime(owner, { snapshot })

  const event: ConversationEvent = {
    room_id: 'regen',
    seq: 2,
    event_id: 'response',
    kind: 'conversation.response',
    actor: { kind: 'participant', id: 'writer' },
    authority_epoch: 1,
    created_at: 1,
    payload: { status: 'settled' }
  }

  let lost = true

  const request = vi.fn(async (_connection, _profile, method, params) => {
    if (method === 'conversations.prepare') {
      return {
        profile: 'writer',
        session_id: 'writer-runtime',
        session_generation: 3,
        previous_revision: 5,
        conversation_revision: 5,
        model_config: {}
      }
    }

    if (method === 'conversations.regenerate') {
      if (lost) {
        lost = false
        throw new Error('Lost acknowledgement')
      }

      return {
        regenerates_event_id: 'response',
        admission: { conversation_id: 'regen', input_id: params.input_id, turn_id: params.turn_id }
      }
    }

    throw new Error(`Unexpected ${method}`)
  })

  const actions = createConversationHistoryActions(owner, request as never)
  await expect(actions.regenerate(event)).rejects.toThrow('Lost acknowledgement')
  const first = request.mock.calls.find(call => call[2] === 'conversations.regenerate')!
  await actions.regenerate(event)
  expect(request.mock.calls.filter(call => call[2] === 'conversations.regenerate')[1]).toEqual(first)
  updateConversationRuntime(owner, { busy: false, snapshot })
  await actions.regenerate(event)
  const later = request.mock.calls.filter(call => call[2] === 'conversations.regenerate')[2]
  expect(later[3].input_id).not.toBe(first[3].input_id)
  expect(later[3].turn_id).not.toBe(first[3].turn_id)
  expect(request.mock.calls.every(call => call[0] === 'remote' && call[1] === 'default')).toBe(true)
})

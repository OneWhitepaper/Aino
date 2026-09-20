import type { ConversationEvent, GatewayEvent } from '@hermes/shared/gateway-events'
import { beforeEach, expect, it, vi } from 'vitest'

import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime, conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, freezeConversationSend, setConversationDraft } from '@/store/conversations'

import {
  handleConversationGatewayEvent,
  handleConversationServerRequest,
  mergeConversationEvents,
  reconcileConversationRequests,
  respondConversationRequest
} from './conversation-events'
const owner = { connectionId: 'remote', installId: 'host', conversationId: 'public' }

const coordinates = {
  conversation_id: 'public',
  turn_id: 'turn',
  participant_id: 'writer',
  session_generation: 1,
  task_id: 'task',
  execution_generation: 2,
  runtime_id: 'runtime'
}

const response: ConversationEvent = {
  room_id: 'public',
  seq: 3,
  event_id: 'response',
  kind: 'conversation.response',
  actor: { kind: 'participant', id: 'writer' },
  authority_epoch: 1,
  payload: { ...coordinates, text: 'Durable answer' },
  created_at: 100
}

beforeEach(() => {
  $conversationRuntime.set({})
  updateConversationRuntime(owner, { runtimeOwners: { runtime: { participantId: 'writer', sessionGeneration: 1 } } })
})
it('routes background deltas by immutable coordinates and reconciles the same execution with public final events', () => {
  const event: GatewayEvent = {
    connectionId: 'remote',
    profile: 'default',
    type: 'message.delta',
    seq: 4,
    session_id: 'runtime',
    conversation: coordinates,
    payload: { text: 'Live' }
  }

  expect(handleConversationGatewayEvent(event)).toBe(true)
  handleConversationGatewayEvent(event)
  handleConversationGatewayEvent({ ...event, connectionId: 'another' })
  expect(Object.values(conversationRuntime(owner).activities).map(a => a.text)).toEqual(['Live'])
  mergeConversationEvents(owner, [response, response])
  handleConversationGatewayEvent({ ...event, seq: 5 })
  expect(conversationRuntime(owner).events).toEqual([response])
  expect(Object.values(conversationRuntime(owner).activities)[0]).toMatchObject({
    text: 'Durable answer',
    finalEventId: 'response'
  })
})
it('merges out-of-order public pages idempotently and does not settle a different execution', () => {
  handleConversationGatewayEvent({
    type: 'message.delta',
    connectionId: 'remote',
    seq: 1,
    conversation: { ...coordinates, execution_generation: 3 },
    payload: { text: 'New run' }
  })

  const draft = setConversationDraft(owner, {
    conversationId: owner.conversationId,
    selectedParticipantId: 'writer',
    text: 'Question',
    attachmentIds: [],
    revision: 1
  })

  updateConversationRuntime(owner, {
    uncertainSend: freezeConversationSend(draft, { inputId: 'input', turnId: 'turn' })
  })

  const earlier = {
    ...response,
    seq: 1,
    event_id: 'input',
    kind: 'conversation.input',
    payload: {
      input_id: 'input',
      turn_id: 'turn',
      target_participant_id: 'writer',
      text: 'Question',
      attachment_ids: []
    }
  }

  mergeConversationEvents(owner, [response])
  mergeConversationEvents(owner, [earlier, response])
  expect(conversationRuntime(owner).events.map(e => e.seq)).toEqual([1, 3])
  expect(conversationRuntime(owner).uncertainSend).toBeUndefined()
  expect($conversationDrafts.get()[conversationOwnerKey(owner)].text).toBe('')
  expect(Object.values(conversationRuntime(owner).activities)[0].text).toBe('New run')
  expect(Object.values(conversationRuntime(owner).activities)[0].finalEventId).toBeUndefined()
})

it('isolates pending replies by owner, replays onto the latest socket and retires expired requests', () => {
  const participant = {
    participant_id: 'writer',
    install_id: 'host',
    profile: 'writer',
    display_name: 'Writer',
    is_general: false
  }

  const other = { ...owner, connectionId: 'other' }

  for (const target of [owner, other]) {
    updateConversationRuntime(target, {
      runtimeOwners: { runtime: { participantId: 'writer', sessionGeneration: 1 } },
      snapshot: {
        conversation: {
          conversation_id: 'public',
          title: '',
          general: participant,
          project: null,
          revision: 1,
          archived: false
        },
        participants: [{ conversation_id: 'public', participant, session_generation: 1, lineage_id: null }],
        active_turn: { ...coordinates, input_id: 'input', status: 'running' },
        pending_delegations: []
      }
    })
  }

  const original = vi.fn()
  const replay = vi.fn()
  const unrelated = vi.fn()

  const request = {
    id: 'shared-id',
    method: 'approval',
    profile: 'default',
    connectionId: 'remote',
    params: { session_id: 'runtime', conversation: coordinates },
    respond: original,
    fail: vi.fn()
  }

  handleConversationServerRequest({
    ...request,
    params: { session_id: 'foreign', conversation: { ...coordinates, runtime_id: 'foreign' } }
  })
  handleConversationServerRequest({
    ...request,
    params: { ...request.params, conversation: { ...coordinates, execution_generation: 1 } }
  })
  expect(conversationRuntime(owner).pendingRequests).toEqual({})
  expect(handleConversationServerRequest({ ...request, method: 'terminal.read' })).toBe(false)
  updateConversationRuntime(owner, { runtimeOwners: {} })
  expect(handleConversationServerRequest(request)).toBe(true)
  expect(conversationRuntime(owner).pendingRequests).toEqual({})
  updateConversationRuntime(owner, { runtimeOwners: { runtime: { participantId: 'writer', sessionGeneration: 1 } } })
  reconcileConversationRequests(owner, 'writer', [request.id])
  expect(conversationRuntime(owner).pendingRequests[request.id].coordinates).toEqual(coordinates)
  handleConversationServerRequest({ ...request, connectionId: 'other', respond: unrelated })
  handleConversationServerRequest({ ...request, respond: replay })
  respondConversationRequest(owner, request.id, { choice: 'allow' })
  expect(replay).toHaveBeenCalledWith({ choice: 'allow' })
  expect(original).not.toHaveBeenCalled()
  expect(unrelated).not.toHaveBeenCalled()
  expect(conversationRuntime(other).pendingRequests[request.id].coordinates).toEqual(coordinates)
  const snapshot = conversationRuntime(other).snapshot!
  updateConversationRuntime(other, {
    snapshot: { ...snapshot, active_turn: { ...snapshot.active_turn!, execution_generation: 3 } }
  })
  expect(() => respondConversationRequest(other, request.id, { choice: 'allow' })).toThrow('no longer available')
  expect(unrelated).not.toHaveBeenCalled()
  handleConversationGatewayEvent({
    type: 'request.cancel',
    connectionId: 'other',
    session_id: 'runtime',
    payload: { id: request.id }
  })
  reconcileConversationRequests(other, 'writer', [])
  expect(() => respondConversationRequest(other, request.id, { choice: 'allow' })).toThrow('no longer available')
  handleConversationServerRequest({ ...request, params: { ...request.params, session_id: 'wrong-runtime' } })
  expect(conversationRuntime(owner).pendingRequests).toEqual({})
})

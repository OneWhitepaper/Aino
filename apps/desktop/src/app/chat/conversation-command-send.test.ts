import { afterEach, expect, it, vi } from 'vitest'

import { $conversationPrivateNotices } from '@/store/conversation-notices'
import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, $conversationRecords, setConversationDraft } from '@/store/conversations'

import { createConversationActions } from './conversation-actions'

const owner = { conversationId: 'conversation', connectionId: 'host', installId: 'install' }
const key = conversationOwnerKey(owner)
const participant = { participant_id: 'A', install_id: 'install', profile: 'writer', display_name: 'Writer' }

function setup() {
  const result = {
    type: 'send',
    command_token: 'opaque-token',
    display: '/writing-skill public task',
    conversation_id: owner.conversationId,
    participant_id: 'A',
    session_generation: 1,
    conversation_revision: 4,
    runtime_id: 'runtime'
  }

  const request = vi.fn(
    async (
      _host: string | null,
      _profile: string,
      method: string,
      params?: Record<string, unknown>
    ): Promise<unknown> => {
      if (method === 'conversations.get') {
        return {
          conversation: {
            conversation_id: owner.conversationId,
            general: participant,
            title: 'test',
            project: null,
            revision: 4,
            archived: false
          },
          participants: [
            { conversation_id: owner.conversationId, participant, session_generation: 1, lineage_id: null }
          ],
          active_turn: null,
          pending_delegations: []
        }
      }

      if (method === 'conversations.events') {
        return { events: [], cursor: 0, has_more: false }
      }

      if (method === 'conversations.runtime_snapshot') {
        return {
          available: false,
          runtime_id: null,
          subagents: [],
          open_requests: [],
          activity: null,
          background_activities: []
        }
      }

      if (method === 'conversations.prepare') {
        return {
          session_id: 'runtime',
          stored_session_id: 'stored',
          profile: 'writer',
          session_generation: 1,
          model_status: 'ready',
          model_config: {},
          previous_revision: 4,
          conversation_revision: 4
        }
      }

      if (method === 'conversations.command') {
        return result
      }

      if (method === 'conversations.send') {
        return {
          admission: {
            conversation_id: owner.conversationId,
            participant_id: 'A',
            input_id: params!.input_id,
            turn_id: params!.turn_id,
            event_id: 'input-event',
            seq: 1,
            idempotent: false
          }
        }
      }

      throw new Error(method)
    }
  )

  const actions = createConversationActions(owner, { request: request as never, retain: vi.fn(async () => () => {}) })
  setConversationDraft(owner, {
    conversationId: owner.conversationId,
    selectedParticipantId: 'A',
    text: '/writing-skill   public task',
    attachmentIds: ['attachment'],
    revision: 4
  })

  return { actions, request, result }
}

afterEach(() => {
  $conversationDrafts.set({})
  $conversationRecords.set({})
  $conversationRuntime.set({})
  $conversationPrivateNotices.set({})
})
it('sends only public display plus opaque token and retries identical IDs/token while clearing the original source draft on ACK', async () => {
  const { actions, request } = setup()
  const original = request.getMockImplementation()!
  let failed = false
  request.mockImplementation(async (...args) => {
    if (args[2] === 'conversations.send' && !failed) {
      failed = true
      throw new Error('Network timeout')
    }

    return original(...args)
  })
  await actions.load()
  await expect(actions.submit()).rejects.toThrow('Network timeout')
  expect($conversationDrafts.get()[key].text).toBe('/writing-skill   public task')
  const first = request.mock.calls.find(call => call[2] === 'conversations.send')![3]
  expect(first).toMatchObject({
    text: '/writing-skill public task',
    command_token: 'opaque-token',
    attachment_ids: ['attachment'],
    participant_id: 'A'
  })
  await actions.retry()
  const sends = request.mock.calls.filter(call => call[2] === 'conversations.send')
  expect(sends[1][3]).toEqual(first)
  expect($conversationDrafts.get()[key]).toMatchObject({ text: '', attachmentIds: [] })
  expect($conversationRuntime.get()[key].uncertainSend).toBeUndefined()
})
it('refuses a token if draft target or input changed during resolution and never sends the changed command as ordinary text', async () => {
  const { actions, request } = setup()
  const original = request.getMockImplementation()!
  request.mockImplementation(async (...args) => {
    if (args[2] === 'conversations.command') {
      setConversationDraft(owner, { ...$conversationDrafts.get()[key], selectedParticipantId: 'B', text: '/different' })
    }

    return original(...args)
  })
  await actions.load()
  await expect(actions.submit()).rejects.toThrow('draft changed')
  expect(request.mock.calls.some(call => call[2] === 'conversations.send')).toBe(false)
  expect($conversationDrafts.get()[key]).toMatchObject({
    selectedParticipantId: 'B',
    text: '/different',
    attachmentIds: ['attachment']
  })
  expect($conversationRuntime.get()[key].events).toEqual([])
})

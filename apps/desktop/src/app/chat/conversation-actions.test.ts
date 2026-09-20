import { JsonRpcGatewayError } from '@hermes/shared'
import { beforeEach, expect, it, vi } from 'vitest'

import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, $conversationRecords, setConversationDraft } from '@/store/conversations'

import { createConversationActions } from './conversation-actions'

const owner = { conversationId: 'public', connectionId: 'remote', installId: 'host' }

const participant = {
  participant_id: 'writer',
  install_id: 'host',
  profile: 'writer',
  display_name: 'Writer',
  is_general: false
}

const record = {
  conversation_id: 'public',
  title: 'Story',
  general: { ...participant, participant_id: 'general', profile: 'default', is_general: true },
  project: null,
  revision: 4,
  archived: false
}

const state = {
  conversation: record,
  participants: [{ conversation_id: 'public', participant, session_generation: 1, lineage_id: null }],
  active_turn: null,
  pending_delegations: []
}

const prepared = {
  session_id: 'runtime',
  stored_session_id: 'stored',
  profile: 'writer',
  session_generation: 1,
  model_status: 'awaiting_managed_credentials',
  previous_revision: 4,
  conversation_revision: 5,
  model_config: {
    model_source: 'aino',
    model_id: 'selected-model',
    platform_owner: { user_id: 'user', platform_origin: 'https://platform' }
  }
}

const admission = {
  conversation_id: 'public',
  turn_id: 'turn',
  input_id: 'input',
  participant_id: 'writer',
  seq: 3,
  event_id: 'event',
  idempotent: false
}

beforeEach(() => {
  $conversationDrafts.set({})
  $conversationRecords.set({})
  $conversationRuntime.set({})
})

function setup() {
  const order: string[] = []
  const release = vi.fn()

  const request = vi.fn(async (_connection: string, _profile: string, method: string) => {
    order.push(method)

    if (method === 'conversations.get') {
      return state
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
      return prepared
    }

    if (method === 'conversations.send') {
      return { admission }
    }

    if (method === 'conversations.stop') {
      return { status: 'requested' }
    }

    throw Error(method)
  })

  const bind = vi.fn(async () => {
    order.push('bind')

    return { user_id: 'user', platform_origin: 'https://platform' }
  })

  const retain = vi.fn(async () => {
    order.push('retain')

    return release
  })

  const actions = createConversationActions(owner, { request: request as never, bind, retain })
  setConversationDraft(owner, {
    conversationId: 'public',
    selectedParticipantId: 'writer',
    text: 'Original',
    attachmentIds: [],
    revision: 4
  })

  return { actions, request, bind, retain, release, order }
}

it('freezes one send across selection edits, binds the prepared selection and uses only its CAS receipt', async () => {
  const s = setup()
  await s.actions.load()
  let resume!: () => void
  s.bind.mockImplementationOnce(async () => {
    s.order.push('bind')
    await new Promise<void>(r => {
      resume = r
    })

    return { user_id: 'user', platform_origin: 'https://platform' }
  })
  const send = s.actions.send({ inputId: 'input', turnId: 'turn' })
  await vi.waitFor(() => expect(s.bind).toHaveBeenCalledOnce())
  const duplicate = s.actions.send({ inputId: 'other', turnId: 'other' })
  const current = $conversationDrafts.get()[conversationOwnerKey(owner)]
  setConversationDraft(owner, { ...current, text: 'Next', selectedParticipantId: 'general' })
  resume()
  await Promise.all([send, duplicate])
  expect(s.request.mock.calls.filter(c => c[2] === 'conversations.send')).toHaveLength(1)
  expect(s.request).toHaveBeenCalledWith(
    'remote',
    'default',
    'conversations.prepare',
    expect.objectContaining({ expected_revision: 4, participant_id: 'writer' }),
    undefined
  )
  expect(s.request).toHaveBeenCalledWith(
    'remote',
    'default',
    'conversations.send',
    expect.objectContaining({ expected_revision: 5, participant_id: 'writer', text: 'Original', input_id: 'input' }),
    undefined
  )
  expect(s.bind).toHaveBeenCalledWith(
    { connectionId: 'remote', profile: 'default', targetProfile: 'writer' },
    'runtime',
    expect.objectContaining({ modelId: 'selected-model', ownerUserId: 'user' }),
    expect.any(Function),
    true
  )
  expect(s.order.indexOf('retain')).toBeLessThan(s.order.indexOf('conversations.prepare'))
  expect(s.order.indexOf('bind')).toBeLessThan(s.order.indexOf('conversations.send'))
  expect($conversationDrafts.get()[conversationOwnerKey(owner)].text).toBe('Next')
  expect(s.request.mock.calls.every(c => c[0] === 'remote' && c[1] === 'default')).toBe(true)
})
it('preserves failed drafts and keeps a requested stop busy until authoritative reconciliation', async () => {
  const s = setup()
  await s.actions.load()
  s.bind.mockRejectedValueOnce(Error('account changed'))
  await expect(s.actions.send({ inputId: 'input', turnId: 'turn' })).rejects.toThrow('account changed')
  expect($conversationDrafts.get()[conversationOwnerKey(owner)].text).toBe('Original')
  expect(s.request.mock.calls.some(c => c[2] === 'conversations.send')).toBe(false)
  expect($conversationDrafts.get()[conversationOwnerKey(owner)].revision).toBe(prepared.conversation_revision)
  s.request
    .mockResolvedValueOnce({ ...prepared, previous_revision: 5 })
    .mockRejectedValueOnce(new JsonRpcGatewayError('revision changed', { code: 4120 }))
  await expect(s.actions.send({ inputId: 'input', turnId: 'turn' })).rejects.toThrow('revision changed')
  expect($conversationRuntime.get()[conversationOwnerKey(owner)].uncertainSend).toBeUndefined()
  expect($conversationDrafts.get()[conversationOwnerKey(owner)].text).toBe('Original')
  s.request
    .mockResolvedValueOnce({ ...prepared, previous_revision: 5 })
    .mockRejectedValueOnce(Error('socket closed before ACK'))
  await expect(s.actions.send({ inputId: 'input', turnId: 'turn' })).rejects.toThrow('socket closed')
  expect($conversationRuntime.get()[conversationOwnerKey(owner)].uncertainSend?.inputId).toBe('input')
  await s.actions.retry()
  const sends = s.request.mock.calls.filter(c => c[2] === 'conversations.send')
  expect(sends.at(-1)).toEqual(sends.at(-2))
  expect($conversationDrafts.get()[conversationOwnerKey(owner)].text).toBe('')
  expect($conversationRuntime.get()[conversationOwnerKey(owner)].uncertainSend).toBeUndefined()

  const turn = {
    turn_id: 'turn',
    input_id: 'input',
    participant_id: 'writer',
    session_generation: 1,
    task_id: 'task',
    execution_generation: 2,
    status: 'running' as const,
    runtime_id: 'runtime'
  }

  $conversationRuntime.set({
    ...$conversationRuntime.get(),
    [conversationOwnerKey(owner)]: {
      ...$conversationRuntime.get()[conversationOwnerKey(owner)],
      snapshot: { ...state, active_turn: turn }
    }
  })
  await s.actions.stop(turn)
  expect($conversationRuntime.get()[conversationOwnerKey(owner)].snapshot?.active_turn?.status).toBe('stopping')
  expect($conversationRuntime.get()[conversationOwnerKey(owner)].busy).toBe(true)
})

it('coalesces owner reloads and rejects foreign participant snapshots before publishing runtime ownership', async () => {
  const s = setup()
  const other = createConversationActions(owner, { request: s.request as never, retain: s.retain, bind: s.bind })
  await Promise.all([s.actions.load(), other.load()])
  expect(s.request.mock.calls.filter(call => call[2] === 'conversations.get')).toHaveLength(1)
  s.request.mockResolvedValueOnce({
    ...state,
    participants: [{ ...state.participants[0], participant: { ...participant, install_id: 'foreign' } }]
  })
  await expect(s.actions.load()).rejects.toThrow('installation')
  expect($conversationRuntime.get()[conversationOwnerKey(owner)].snapshot?.participants[0].participant.install_id).toBe(
    'host'
  )
})

it('restores an unsent edited branch into the canonical draft and preserves its frozen identities across preparation failure', async () => {
  const s = setup()
  const original = s.request.getMockImplementation()!
  s.request.mockImplementation(async (...args) =>
    args[2] === 'conversations.get'
      ? {
          ...state,
          conversation: {
            ...record,
            branch: {
              operation_id: 'branch-op',
              conversation_id: 'public',
              source_conversation_id: 'source',
              source_event_id: 'old-input',
              source_revision: 1,
              source_cutoff_seq: 1,
              kind: 'edit',
              draft_pending: true,
              draft: {
                input_id: 'input',
                turn_id: 'turn',
                participant_id: 'writer',
                text: 'Edited original',
                attachment_ids: [],
                source_event_id: 'old-input'
              }
            }
          }
        }
      : original(...args)
  )
  $conversationDrafts.set({})
  await s.actions.load()
  expect($conversationDrafts.get()[conversationOwnerKey(owner)]).toMatchObject({
    text: 'Edited original',
    selectedParticipantId: 'writer'
  })
  s.bind.mockRejectedValueOnce(new Error('Credential expired'))
  await expect(s.actions.submit()).rejects.toThrow('Credential expired')
  expect(s.request.mock.calls.some(call => call[2] === 'conversations.send')).toBe(false)
  s.request.mockResolvedValueOnce({ ...prepared, previous_revision: 5 })
  await s.actions.submit()
  expect(s.request).toHaveBeenCalledWith(
    'remote',
    'default',
    'conversations.send',
    expect.objectContaining({ input_id: 'input', turn_id: 'turn', text: 'Edited original', participant_id: 'writer' }),
    undefined
  )
})

it('keeps GPT-Live context private to the frozen canonical send and its ambiguous retry', async () => {
  const s = setup()
  await s.actions.load()
  s.request.mockResolvedValueOnce(prepared).mockRejectedValueOnce(new Error('Lost voice send acknowledgement'))
  await expect(s.actions.submit({ surface: 'voice-live', voice_context: 'Private spoken context' })).rejects.toThrow(
    'Lost voice'
  )
  const frozen = $conversationRuntime.get()[conversationOwnerKey(owner)].uncertainSend!
  expect(frozen).toMatchObject({ surface: 'voice-live', voiceContext: 'Private spoken context', text: 'Original' })
  s.request.mockResolvedValueOnce({ admission: { ...admission, input_id: frozen.inputId, turn_id: frozen.turnId } })
  await s.actions.retry()
  const sends = s.request.mock.calls.filter(call => call[2] === 'conversations.send')
  expect(sends.at(-1)).toEqual(sends.at(-2))
  expect(sends.at(-1)).toEqual([
    'remote',
    'default',
    'conversations.send',
    expect.objectContaining({ text: 'Original', surface: 'voice-live', voice_context: 'Private spoken context' }),
    undefined
  ])
})

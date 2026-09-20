import { JsonRpcGatewayError } from '@hermes/shared'
import { afterEach, expect, it, vi } from 'vitest'

import { $conversationPrivateNotices } from '@/store/conversation-notices'
import { conversationOwnerKey } from '@/store/conversation-owner'
import { $conversationRuntime, updateConversationRuntime } from '@/store/conversation-runtime'
import { $conversationDrafts, $conversationRecords, setConversationDraft } from '@/store/conversations'

import { createConversationActions } from './conversation-actions'

const owner = { conversationId: 'conversation', connectionId: 'owner-host', installId: 'installation' }
const key = conversationOwnerKey(owner)
const participant = { participant_id: 'A', install_id: owner.installId, profile: 'writer', display_name: 'Writer' }

const project = {
  install_id: owner.installId,
  registration_profile: 'default',
  project_id: 'project',
  cwd: '/workspace',
  execution_environment_id: 'local'
}

const preparation = {
  session_id: 'runtime-A',
  stored_session_id: 'stored-A',
  profile: 'writer',
  session_generation: 1,
  model_status: 'ready',
  model_config: {
    model_source: 'aino',
    model_id: 'model',
    platform_owner: { user_id: 'user', platform_origin: 'https://platform' }
  }
}

function setup() {
  let generation = 1

  const record = {
    conversation_id: owner.conversationId,
    title: 'Shared title',
    general: participant,
    project,
    revision: 4,
    archived: false
  }

  const state = () => ({
    conversation: { ...record, revision: generation + 3 },
    participants: [
      { conversation_id: owner.conversationId, participant, session_generation: generation, lineage_id: null }
    ],
    active_turn: null,
    pending_delegations: []
  })

  const request = vi.fn(async (_host, _profile, method, params): Promise<unknown> => {
    if (method === 'conversations.get') {
      return state()
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
        ...preparation,
        session_generation: generation,
        previous_revision: generation + 3,
        conversation_revision: generation + 3
      }
    }

    if (method === 'conversations.refresh') {
      if (params.expected_generation !== generation) {
        throw new Error('stale')
      }

      generation++

      return { binding: state().participants[0], preparation: { ...preparation, session_generation: generation } }
    }

    if (method === 'conversations.command') {
      return {
        type: 'notice',
        scope: 'private',
        output: 'Private A prompt',
        conversation_id: owner.conversationId,
        participant_id: 'A',
        session_generation: generation,
        conversation_revision: generation + 3,
        runtime_id: 'runtime-A'
      }
    }

    throw new Error(`Unexpected method ${method}`)
  })

  const bind = vi.fn(async () => {})

  const actions = createConversationActions(owner, {
    request: request as never,
    bind: bind as never,
    retain: vi.fn(async () => () => {})
  })

  setConversationDraft(owner, {
    conversationId: owner.conversationId,
    selectedParticipantId: 'A',
    text: '/prompt',
    attachmentIds: [],
    revision: 4
  })

  return { request, bind, actions, record }
}

afterEach(() => {
  $conversationPrivateNotices.set({})
  $conversationDrafts.set({})
  $conversationRecords.set({})
  $conversationRuntime.set({})
  vi.restoreAllMocks()
})
it('routes slash reads through captured prepare and credential bind, keeping private output out of public history and preserving another draft target', async () => {
  const { actions, request, bind, record } = setup()
  await actions.load()
  bind.mockImplementation(async () => {
    setConversationDraft(owner, { ...$conversationDrafts.get()[key], selectedParticipantId: 'B' })
  })
  await actions.submit()
  expect(bind).toHaveBeenCalledOnce()
  expect(request).toHaveBeenCalledWith(
    'owner-host',
    'default',
    'conversations.command',
    expect.objectContaining({ participant_id: 'A', command: '/prompt', expected_generation: 1, expected_revision: 4 }),
    undefined
  )
  expect($conversationPrivateNotices.get()[key]).toMatchObject({ participantId: 'A', output: 'Private A prompt' })
  expect($conversationDrafts.get()[key]).toMatchObject({ selectedParticipantId: 'B', text: '' })
  expect($conversationRuntime.get()[key].events).toEqual([])
  expect($conversationRecords.get()[key]).toEqual(record)
  expect(request.mock.calls.some(call => call[2] === 'conversations.send' || call[2] === 'slash.exec')).toBe(false)
})
it('retains drafts on unsupported commands and credential failure, refreshes only the requested generation, and refuses active work', async () => {
  const { actions, request, bind } = setup()
  await actions.load()
  const original = request.getMockImplementation()!
  request.mockImplementation(async (...args) => {
    if (args[2] === 'conversations.command') {
      throw new JsonRpcGatewayError('Explicit refresh required', { code: 4120, data: { reason: 'refresh_required' } })
    }

    return original(...args)
  })
  await expect(actions.submit()).rejects.toThrow('Explicit refresh required')
  expect($conversationPrivateNotices.get()[key].refreshRequired).toBe(true)
  expect($conversationDrafts.get()[key].text).toBe('/prompt')
  bind.mockRejectedValueOnce(new Error('Credential bind rejected'))
  await expect(actions.refresh('A', 1)).rejects.toThrow('Credential bind rejected')
  expect($conversationDrafts.get()[key].text).toBe('/prompt')
  expect($conversationRuntime.get()[key].snapshot?.participants[0].session_generation).toBe(2)
  await actions.refresh('A', 2)
  expect($conversationRuntime.get()[key].snapshot?.participants[0].session_generation).toBe(3)
  expect($conversationRuntime.get()[key].snapshot?.conversation.project).toEqual(project)
  expect($conversationRuntime.get()[key].events).toEqual([])
  const count = request.mock.calls.length
  updateConversationRuntime(owner, { busy: true })
  await expect(actions.refresh('A', 3)).rejects.toThrow('Finish current work')
  expect(request).toHaveBeenCalledTimes(count)
  expect($conversationDrafts.get()[key].text).toBe('/prompt')
})

it('propagates managed selection through refresh and keeps the draft when fresh binding fails', async () => {
  const { actions, request, bind } = setup()
  await actions.load()
  bind.mockRejectedValueOnce(new Error('Fresh ticket rejected'))
  await expect(
    actions.refresh('A', 1, { model_source: 'aino', model_id: 'chosen-model', reasoning_effort: 'none', fast: false })
  ).rejects.toThrow('Fresh ticket rejected')
  expect(request).toHaveBeenCalledWith(
    'owner-host',
    'default',
    'conversations.refresh',
    {
      conversation_id: owner.conversationId,
      participant_id: 'A',
      expected_generation: 1,
      model_source: 'aino',
      model_id: 'chosen-model',
      reasoning_effort: 'none',
      fast: false
    },
    undefined
  )
  expect(bind).toHaveBeenCalledOnce()
  expect($conversationDrafts.get()[key]).toMatchObject({
    text: '/prompt',
    selectedParticipantId: 'A',
    attachmentIds: []
  })
  expect($conversationRuntime.get()[key].snapshot?.participants[0].session_generation).toBe(2)
  expect($conversationRuntime.get()[key].submitting).toBe(false)
})

it('propagates model selection through first preparation before binding an unbound participant', async () => {
  const { actions, request, bind } = setup()
  await actions.load()
  const current = $conversationRuntime.get()[key].snapshot!
  updateConversationRuntime(owner, { snapshot: { ...current, participants: [] } })
  const original = request.getMockImplementation()!
  request.mockImplementation(async (...args) => {
    if (args[2] === 'conversations.participants') {
      return { participants: [{ participant, available: true }] }
    }

    return original(...args)
  })
  await actions.refresh('A', 1, { model_source: 'aino', model_id: 'first-model' })
  expect(request).toHaveBeenCalledWith(
    'owner-host',
    'default',
    'conversations.prepare',
    {
      conversation_id: owner.conversationId,
      participant_id: 'A',
      expected_generation: 1,
      expected_revision: 4,
      model_source: 'aino',
      model_id: 'first-model'
    },
    undefined
  )
  expect(bind).toHaveBeenCalledOnce()
  expect(request.mock.calls.some(call => call[2] === 'conversations.refresh')).toBe(false)
  expect($conversationDrafts.get()[key].text).toBe('/prompt')
})

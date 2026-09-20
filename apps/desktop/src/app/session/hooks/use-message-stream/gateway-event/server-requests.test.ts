import {
  $conversationRuntime,
  $foregroundConversationOwner,
  updateConversationRuntime
} from '@/store/conversation-runtime'
vi.mock('@/lib/tour', () => ({ runTour: vi.fn(async () => ({ success: true })) }))
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $toursEnabled } from '@/store/tours'

import { handleServerRequest } from './server-requests'
import type { ServerRequestContext } from './server-requests'

const deps = {} as ServerRequestContext['deps']

function deliver(method: string, params: Record<string, unknown>, activeSessionId: null | string) {
  const respond = vi.fn()
  const fail = vi.fn()
  const handled = handleServerRequest(
    { fail, id: 'srq-1', method, params, profile: 'default', respond },
    deps,
    activeSessionId
  )

  return { fail, handled, respond }
}

describe('preview action request routing', () => {
  it('leaves a scoped action request unanswered in a window showing another session', () => {
    const { handled, respond, fail } = deliver(
      'preview.act',
      { action: 'elements', session_id: 'session-a' },
      'session-b'
    )

    expect(handled).toBe(true)
    expect(respond).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })

  it('fails fast for an unscoped request with no session in view', () => {
    const { respond } = deliver('preview.act', { action: 'elements' }, null)

    expect(respond).toHaveBeenCalledWith({
      value: JSON.stringify({
        error: 'The in-app browser only takes actions in the session the user is looking at.',
        success: false
      })
    })
  })
})

describe('tour request routing', () => {
  afterEach(() => {
    $toursEnabled.set(true)
  })

  it('leaves a scoped request unanswered in another session even when tours are disabled', () => {
    $toursEnabled.set(false)
    const { handled, respond } = deliver('tour', { action: 'discover', session_id: 'session-a' }, 'session-b')

    expect(handled).toBe(true)
    expect(respond).not.toHaveBeenCalled()
  })

  it('fails fast for an unscoped request with no session in view', () => {
    const { respond } = deliver('tour', { action: 'discover' }, null)

    expect(respond).toHaveBeenCalledWith({
      value: JSON.stringify({ error: 'Tours only run in the session the user is looking at.', success: false })
    })
  })
})

it.each(['preview.act', 'tour'])(
  'routes %s through the foreground conversation runtime while preserving background isolation',
  async method => {
    const owner = { connectionId: 'remote', installId: 'host', conversationId: 'public' }
    const participant = {
      participant_id: 'writer',
      install_id: 'host',
      profile: 'writer',
      display_name: 'Writer',
      is_general: false
    }
    const coordinates = {
      conversation_id: 'public',
      participant_id: 'writer',
      session_generation: 1,
      runtime_id: 'runtime',
      turn_id: 'turn',
      task_id: 'task',
      execution_generation: 2
    }
    $conversationRuntime.set({})
    $foregroundConversationOwner.set(owner)
    updateConversationRuntime(owner, {
      runtimeOwners: { runtime: { participantId: 'writer', sessionGeneration: 1 } },
      snapshot: {
        conversation: {
          conversation_id: 'public',
          title: '',
          general: participant,
          revision: 1,
          archived: false,
          project: null
        },
        participants: [{ conversation_id: 'public', participant, session_generation: 1, lineage_id: null }],
        active_turn: { ...coordinates, input_id: 'input', status: 'running' },
        pending_delegations: []
      }
    })
    const respond = vi.fn()
    const request = {
      id: 'conversation-action',
      connectionId: 'remote',
      profile: 'default',
      method,
      params: { session_id: 'runtime', conversation: coordinates, action: 'discover' },
      respond,
      fail: vi.fn()
    }
    expect(handleServerRequest(request, deps, null)).toBe(true)
    await vi.waitFor(() => expect(respond).toHaveBeenCalledOnce())
    expect(JSON.parse(respond.mock.calls[0][0].value).success).toBe(method === 'tour')
    const background = vi.fn()
    $foregroundConversationOwner.set({ ...owner, conversationId: 'other' })
    handleServerRequest({ ...request, respond: background }, deps, 'runtime')
    await Promise.resolve()
    expect(background).not.toHaveBeenCalled()
    $foregroundConversationOwner.set(null)
    $conversationRuntime.set({})
  }
)

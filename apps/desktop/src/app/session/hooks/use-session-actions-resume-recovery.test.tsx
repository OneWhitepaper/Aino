import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PRIMARY_SESSION_VIEW } from '@/app/chat/session-view'
import { getGlobalModelInfo, getLatestSessionMessages } from '@/hermes'
import { $clarifyRequests, clearClarifyRequest, setClarifyRequest } from '@/store/clarify'
import { activeGatewayConnectionId } from '@/store/gateway'
import {
  $activeSessionId,
  $messages,
  $resumeFailedSessionId,
  $selectedStoredSessionId,
  $sessionStartedAt,
  _resetSessionOwnerHintsForTests,
  getSessionOwnerHint,
  setActiveSessionId,
  setMessages,
  setResumeFailedSessionId,
  setSessionOwnerHint,
  setSessions,
  setSessionStartedAt
} from '@/store/session'
import { $removedSessionIds, $sessionMutationsInFlight } from '@/store/session-removal'
import { dropSessionState, publishSessionState } from '@/store/session-states'
import { $retainedTodosBySession, clearSessionTodos } from '@/store/todos'

import { deferred } from '../../../test/deferred'
import type { ClientSessionState } from '../../types'

import { applySessionInfoStatePatch, sessionInfoStatePatch } from './use-message-stream/utils'
import { clientState, ResumeHarness } from './use-session-actions-resume-harness'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  getAllSessionMessages: vi.fn(),
  getGlobalModelInfo: vi.fn(),
  getLatestSessionMessages: vi.fn(),
  listAllProfileSessions: vi.fn(),
  setApiRequestProfile: vi.fn(),
  setSessionArchived: vi.fn()
}))

vi.mock('@/store/profile', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureGatewayAgent: vi.fn().mockResolvedValue(undefined),
  ensureGatewayProfile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/store/gateway', async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>()

  return {
    ...original,
    // Default-preserving spy: tests that route by the active source override it.
    activeGatewayConnectionId: vi.fn(original.activeGatewayConnectionId as () => null | string),
    requestGatewayForAgent: vi.fn(),
    requestGatewayForProfile: vi.fn(),
    retainGatewayForAgent: vi.fn(async () => () => undefined)
  }
})

vi.mock('@/components/pane-shell/tree/store', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  noteActiveTreeGroup: vi.fn(),
  revealTreePane: vi.fn()
}))

const RUNTIME_SESSION_ID = 'rt-new-001'

beforeEach(() => {
  vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: 'backend-default', provider: 'backend-provider' })
})
import { storedSession } from './use-session-actions-harness'

describe('resumeSession failure recovery', () => {
  afterEach(() => {
    cleanup()
    setActiveSessionId(null)
    setResumeFailedSessionId(null)
    setSessionStartedAt(null)
    setMessages([])
    setSessions([])
    $removedSessionIds.set(new Set())
    $sessionMutationsInFlight.set(new Set())
    clearClarifyRequest()
    clearSessionTodos('runtime-1')
    // Persisted owner hints are global module state; the hint-hygiene tests
    // below write them and must not leak into later describes' resumes.
    // storage: true also clears the persisted copy (cf. the integrations test
    // file) — this suite's hint writes must not survive into a fresh suite run.
    _resetSessionOwnerHintsForTests({ storage: true })
    // Same for this describe's source-override: mockReset() restores the
    // default-preserving spy (the real registry read), unlike
    // restoreAllMocks() below, which is a no-op for factory-created vi.fn().
    vi.mocked(activeGatewayConnectionId).mockReset()
    vi.restoreAllMocks()
  })

  async function runResume(
    requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>,
    options: {
      runtimeIdByStoredSessionIdRef?: MutableRefObject<Map<string, string>>
      sessionStateByRuntimeIdRef?: MutableRefObject<Map<string, ClientSessionState>>
    } = {}
  ): Promise<void> {
    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(<ResumeHarness onReady={r => (resume = r)} requestGateway={requestGateway} {...options} />)
    await waitFor(() => expect(resume).not.toBeNull())
    await resume!('stored-1', true)
  }

  it('does not resume a tombstoned session after delete', async () => {
    $removedSessionIds.set(new Set(['stored-1']))

    const requestGateway = vi.fn(async () => {
      throw new Error('404: Session not found')
    })

    await runResume(requestGateway)

    expect(requestGateway).not.toHaveBeenCalled()
    expect($resumeFailedSessionId.get()).toBeNull()
    expect($selectedStoredSessionId.get()).toBeNull()
  })

  it.each([
    ['Codex tool-only', ''],
    ['DeepSeek text-plus-tool', 'I found two paths; choose one.']
  ])('restores a pending clarify as a running inline card for a %s transcript', async (_shape, content) => {
    const stateMapRef: MutableRefObject<Map<string, ClientSessionState>> = { current: new Map() }

    const toolCall = {
      function: { arguments: '{"questions":[{"question":"Which path?","choices":["safe","fast"]}]}', name: 'clarify' },
      id: 'call-provider'
    }

    setSessions([storedSession({ id: 'stored-1', message_count: 2 })])
    vi.mocked(getLatestSessionMessages).mockResolvedValue({
      messages: [
        { content: 'help me choose', role: 'user', timestamp: 1 },
        { content, role: 'assistant', timestamp: 2, tool_calls: [toolCall] }
      ],
      session_id: 'stored-1'
    } as never)

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        // The channel re-delivers `open_requests` to the request handler BEFORE
        // the caller sees the result; that handler parks the card. Mirror that
        // ordering here (no channel in this harness).
        setClarifyRequest({
          questions: [{ choices: ['safe', 'fast'], multiSelect: false, qid: 'q0', question: 'Which path?' }],
          receivedAt: Date.now(),
          requestId: 'req-resumed',
          sessionId: 'runtime-1'
        })

        return {
          info: {},
          message_count: 2,
          messages: [],
          messages_omitted: true,
          open_requests: [
            {
              id: 'req-resumed',
              method: 'clarify',
              params: { questions: [{ choices: ['safe', 'fast'], qid: 'q0', question: 'Which path?' }] }
            }
          ],
          resumed: 'stored-1',
          running: true,
          session_id: 'runtime-1',
          session_key: 'stored-1'
        } as never
      }

      return {} as never
    })

    await runResume(requestGateway, { sessionStateByRuntimeIdRef: stateMapRef })

    const state = stateMapRef.current.get('runtime-1')

    const clarifyMessages =
      state?.messages.filter(message =>
        message.parts.some(part => part.type === 'tool-call' && part.toolName === 'clarify')
      ) ?? []

    expect(clarifyMessages).toHaveLength(1)
    expect(clarifyMessages[0].pending).toBe(true)
    expect(state?.streamId).toBe(clarifyMessages[0].id)
    expect($clarifyRequests.get()['runtime-1']).toMatchObject({
      requestId: 'req-resumed',
      questions: [{ question: 'Which path?' }]
    })
  })

  it('restores a pending batch clarify whose resume snapshot has no top-level question', async () => {
    const stateMapRef: MutableRefObject<Map<string, ClientSessionState>> = { current: new Map() }

    setSessions([storedSession({ id: 'stored-1', message_count: 2 })])
    vi.mocked(getLatestSessionMessages).mockResolvedValue({
      messages: [
        { content: 'help me choose', role: 'user', timestamp: 1 },
        {
          content: '',
          role: 'assistant',
          timestamp: 2,
          tool_calls: [
            {
              function: {
                arguments: '{"questions":[{"question":"Color?"},{"question":"Size?"}]}',
                name: 'clarify'
              },
              id: 'call-batch-provider'
            }
          ]
        }
      ],
      session_id: 'stored-1'
    } as never)

    const questions = [
      { choices: ['Blue', 'Red'], qid: 'q0', question: 'Color?' },
      { choices: ['Small', 'Large'], qid: 'q1', question: 'Size?' }
    ]

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        // Request handler parks the batch card (with the server-locked answer)
        // from the re-delivered open request before the result lands.
        setClarifyRequest({
          lockedAnswers: { q0: 'Blue' },
          questions: questions.map(q => ({ ...q, multiSelect: false })),
          receivedAt: Date.now(),
          requestId: 'req-batch-resumed',
          sessionId: 'runtime-1'
        })

        return {
          info: {},
          message_count: 2,
          messages: [],
          messages_omitted: true,
          open_requests: [
            { id: 'req-batch-resumed', method: 'clarify', params: { answers: { q0: 'Blue' }, questions } }
          ],
          resumed: 'stored-1',
          running: true,
          session_id: 'runtime-1',
          session_key: 'stored-1'
        } as never
      }

      return {} as never
    })

    await runResume(requestGateway, { sessionStateByRuntimeIdRef: stateMapRef })

    const state = stateMapRef.current.get('runtime-1')
    const request = $clarifyRequests.get()['runtime-1']
    expect(request).toMatchObject({
      lockedAnswers: { q0: 'Blue' },
      requestId: 'req-batch-resumed'
    })
    expect(request.questions).toHaveLength(2)
    expect(
      state?.messages
        .flatMap(message => message.parts)
        .filter(part => part.type === 'tool-call' && part.toolName === 'clarify')
    ).toHaveLength(1)
    expect(state?.messages.filter(message => message.pending)).toHaveLength(1)
    expect(state?.streamId).toBe(state?.messages.find(message => message.pending)?.id)
  })

  it('arms $resumeFailedSessionId when resume RPC and REST fallback both fail', async () => {
    // session.resume rejects (e.g. timeout against a wedged backend)...
    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        throw new Error('request timed out: session.resume')
      }

      return {} as never
    })

    // ...and the REST transcript fallback also rejects (backend unreachable).
    vi.mocked(getLatestSessionMessages).mockRejectedValue(new Error('network down'))

    await runResume(requestGateway)

    // The window is no longer silently stranded: the failure latch is armed for
    // the stored session, which use-route-resume consumes to retry.
    expect($resumeFailedSessionId.get()).toBe('stored-1')
  })

  it('does NOT arm the failure latch when the resume RPC fails but the REST fallback paints history', async () => {
    // session.resume rejects, but the REST transcript fallback succeeds and
    // hydrates a readable transcript — the window is NOT stranded.
    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        throw new Error('request timed out: session.resume')
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({
      messages: [
        { content: 'hello', role: 'user', timestamp: 1 },
        { content: 'hi there', role: 'assistant', timestamp: 2 }
      ],
      session_id: 'stored-1'
    } as never)

    await runResume(requestGateway)

    // Arming here would auto-retry a window that already shows history and,
    // on exhaustion, blank that transcript behind the error overlay — a
    // regression vs. plain fallback-success. The latch must stay clear.
    expect($resumeFailedSessionId.get()).toBeNull()
    // The fallback transcript is visible.
    expect($messages.get().length).toBeGreaterThan(0)
  })

  it('paints the REST transcript before a cold session.resume settles and keeps it when resume rejects', async () => {
    // A cold profile build (skills/MCP/memory) can keep session.resume pending
    // past the hydration budget; the already-available REST history must not
    // wait for it (#90130), and a later resume failure must not blank it.
    const runtimeResume = deferred<never>()

    const requestGateway = vi.fn((method: string) =>
      method === 'session.resume' ? runtimeResume.promise : Promise.resolve({} as never)
    ) as <T>(method: string, params?: Record<string, unknown>) => Promise<T>

    vi.mocked(getLatestSessionMessages).mockResolvedValue({
      messages: [
        { content: 'older question', role: 'user', timestamp: 1 },
        { content: 'history visible before runtime', role: 'assistant', timestamp: 2 }
      ],
      session_id: 'stored-1'
    } as never)

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(<ResumeHarness onReady={r => (resume = r)} requestGateway={requestGateway} />)
    await waitFor(() => expect(resume).not.toBeNull())

    let settled = false
    const pending = resume!('stored-1', true).finally(() => (settled = true))

    await waitFor(() => expect(JSON.stringify($messages.get())).toContain('history visible before runtime'))
    expect(settled).toBe(false)
    const painted = $messages.get()

    await act(async () => {
      runtimeResume.reject(new Error('request timed out: session.resume'))
      await pending
    })

    expect($messages.get()).toBe(painted)
    expect($resumeFailedSessionId.get()).toBeNull()
  })

  it('preserves an optimistic user message during a same-session reconnect', async () => {
    setMessages([
      {
        id: 'stored-user',
        role: 'user',
        parts: [{ type: 'text', text: 'earlier question' }]
      },
      {
        id: 'stored-assistant',
        role: 'assistant',
        parts: [{ type: 'text', text: 'earlier answer' }]
      },
      {
        id: 'user-optimistic',
        role: 'user',
        parts: [{ type: 'text', text: 'message sent during reconnect' }]
      }
    ])

    const storedMessages = [
      { content: 'earlier question', role: 'user', timestamp: 1 },
      { content: 'earlier answer', role: 'assistant', timestamp: 2 }
    ]

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: storedMessages, session_id: 'stored-1' } as never)

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return {
          session_id: 'runtime-1',
          session_key: 'stored-1',
          resumed: 'stored-1',
          message_count: 2,
          messages: storedMessages,
          info: {}
        } as never
      }

      return {} as never
    })

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <ResumeHarness onReady={r => (resume = r)} requestGateway={requestGateway} selectedStoredSessionId="stored-1" />
    )
    await waitFor(() => expect(resume).not.toBeNull())
    await resume!('stored-1', true)

    expect($messages.get().map(message => message.id)).toContain('user-optimistic')
  })

  it('keeps the complete transcript with the live tail after a full renderer restart', async () => {
    const storedMessages = [
      { content: 'older question removed by compression', role: 'user', timestamp: 1 },
      { content: 'older answer removed by compression', role: 'assistant', timestamp: 2 },
      { content: 'recent question', role: 'user', timestamp: 3 },
      { content: 'recent answer', role: 'assistant', timestamp: 4 }
    ]

    const compressedRuntimeMessages = storedMessages.slice(-2)

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: storedMessages, session_id: 'stored-1' } as never)

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return {
          session_id: 'runtime-1',
          session_key: 'stored-1',
          resumed: 'stored-1',
          message_count: compressedRuntimeMessages.length,
          messages: compressedRuntimeMessages,
          running: true,
          turn_started_at: 1_700_000_000,
          inflight: {
            user: 'current prompt',
            assistant: 'partial answer',
            streaming: true
          },
          queued: { user: 'newest prompt' },
          info: {}
        } as never
      }

      return {} as never
    })

    let resumedState: ClientSessionState | undefined
    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <ResumeHarness
        onReady={ready => (resume = ready)}
        onStateUpdate={(_sessionId, state) => (resumedState = state)}
        requestGateway={requestGateway}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())
    await resume!('stored-1', true)

    const renderedMessages = JSON.stringify(resumedState?.messages)
    expect(renderedMessages).toContain('older question removed by compression')
    expect(renderedMessages).toContain('current prompt')
    expect(renderedMessages).toContain('partial answer')
    expect(renderedMessages).toContain('newest prompt')
    expect(resumedState?.turnStartedAt).toBe(1_700_000_000_000)
  })

  it('restores a paused checklist from REST when deferred resume has no todo_state', async () => {
    const todos = [{ id: 'next', content: 'Next task', status: 'in_progress' as const }]
    vi.mocked(getLatestSessionMessages).mockResolvedValue({
      session_id: 'stored-1',
      messages: [
        { id: 1, role: 'user', content: 'Work through the list', timestamp: 1 },
        {
          id: 2,
          role: 'assistant',
          content: '',
          timestamp: 2,
          tool_calls: [{ id: 'todo-call', type: 'function', function: { name: 'todo_list', arguments: '{}' } }]
        },
        {
          id: 3,
          role: 'tool',
          tool_call_id: 'todo-call',
          tool_name: 'todo_list',
          content: JSON.stringify({ todos, revision: 3 }),
          timestamp: 3
        },
        { id: 4, role: 'assistant', content: 'Continuing later', timestamp: 4 }
      ]
    } as never)

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return {
          session_id: 'runtime-1',
          session_key: 'stored-1',
          resumed: 'stored-1',
          messages_omitted: true,
          messages: [],
          message_count: 4,
          running: false,
          info: {}
        } as never
      }

      return {} as never
    })

    await runResume(requestGateway)
    expect($retainedTodosBySession.get()['runtime-1']).toEqual(todos)
  })

  it('preserves a runtime-cache delta that arrives while cold resume waits for REST', async () => {
    const persisted = deferred<Awaited<ReturnType<typeof getLatestSessionMessages>>>()

    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = {
      current: new Map()
    }

    const compressedRuntimeMessages = [
      { content: 'recent question', role: 'user', timestamp: 3 },
      { content: 'recent answer', role: 'assistant', timestamp: 4 }
    ]

    vi.mocked(getLatestSessionMessages).mockReturnValue(persisted.promise)

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return {
          session_id: 'runtime-1',
          session_key: 'stored-1',
          resumed: 'stored-1',
          message_count: compressedRuntimeMessages.length,
          messages: compressedRuntimeMessages,
          running: true,
          inflight: {
            user: 'current prompt',
            assistant: 'partial A',
            streaming: true
          },
          info: {}
        } as never
      }

      return {} as never
    })

    let resumedState: ClientSessionState | undefined
    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null

    render(
      <ResumeHarness
        onReady={ready => (resume = ready)}
        onStateUpdate={(_sessionId, state) => (resumedState = state)}
        requestGateway={requestGateway}
        sessionStateByRuntimeIdRef={sessionStateByRuntimeIdRef}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())

    const resumePromise = resume!('stored-1', true)

    await waitFor(() => expect(requestGateway).toHaveBeenCalledWith('session.resume', expect.anything()))

    const runtimeState = clientState('stored-1')
    runtimeState.messages = [
      {
        id: 'assistant-stream-live-cold',
        role: 'assistant',
        parts: [{ type: 'text', text: ' + delta B' }],
        pending: true
      }
    ]
    runtimeState.streamId = 'assistant-stream-live-cold'
    sessionStateByRuntimeIdRef.current.set('runtime-1', runtimeState)

    await act(async () => {
      persisted.resolve({
        messages: [
          { content: 'older question removed by compression', role: 'user', timestamp: 1 },
          { content: 'older answer removed by compression', role: 'assistant', timestamp: 2 },
          ...compressedRuntimeMessages
        ],
        session_id: 'stored-1'
      } as never)
      await resumePromise
    })

    const renderedText = JSON.stringify(resumedState?.messages)

    const streamingAssistantRows = resumedState?.messages.filter(message => message.id.startsWith('assistant-stream-'))

    expect(renderedText).toContain('older question removed by compression')
    expect(renderedText).toContain('partial A')
    expect(renderedText).toContain('delta B')
    expect(streamingAssistantRows).toHaveLength(1)
    expect(streamingAssistantRows?.[0].id).toBe('assistant-stream-live-cold')
  })

  it('uses the continuation projection when resume rotates an equal-length stored transcript', async () => {
    const parentMessages = [
      { content: 'question before compression', role: 'user', timestamp: 1 },
      { content: 'answer before compression', role: 'assistant', timestamp: 2 }
    ]

    const continuationMessages = [
      { content: 'prompt after compression', role: 'user', timestamp: 3 },
      { content: 'answer after compression', role: 'assistant', timestamp: 4 }
    ]

    vi.mocked(getLatestSessionMessages).mockResolvedValue({
      messages: parentMessages,
      session_id: 'stored-1'
    } as never)

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return {
          session_id: 'runtime-continuation',
          session_key: 'stored-continuation',
          resumed: 'stored-continuation',
          message_count: continuationMessages.length,
          messages: continuationMessages,
          info: {}
        } as never
      }

      return {} as never
    })

    let resumedState: ClientSessionState | undefined
    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null

    render(
      <ResumeHarness
        onReady={ready => (resume = ready)}
        onStateUpdate={(_sessionId, state) => (resumedState = state)}
        requestGateway={requestGateway}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())
    await resume!('stored-1', true)

    const renderedMessages = JSON.stringify(resumedState?.messages)
    expect(renderedMessages).toContain('prompt after compression')
    expect(renderedMessages).toContain('answer after compression')
    expect(renderedMessages).not.toContain('answer before compression')
  })

  it('leaves the failure latch clear when resume succeeds', async () => {
    // Pre-arm to prove a successful resume clears it (entry-clear path).
    setResumeFailedSessionId('stored-1')

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return { session_id: 'runtime-1', resumed: params?.session_id, messages: [], info: {} } as never
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [] } as never)

    await runResume(requestGateway)

    expect($resumeFailedSessionId.get()).toBeNull()
  })

  it("leaves the resumed session's effort pending until the built agent reports it (#79807)", async () => {
    const sessionStateByRuntimeIdRef = { current: new Map<string, ClientSessionState>() }

    // A deferred-build resume answers with the lazy shape: no reasoning_effort.
    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return {
          info: { lazy: true, model: 'qwen3.8-max' },
          messages: [],
          resumed: params?.session_id,
          session_id: 'runtime-1'
        } as never
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [] } as never)

    await runResume(requestGateway, { sessionStateByRuntimeIdRef })

    const resumed = sessionStateByRuntimeIdRef.current.get('runtime-1')!
    publishSessionState('runtime-1', resumed)

    expect($activeSessionId.get()).toBe('runtime-1')
    expect(PRIMARY_SESSION_VIEW.$reasoningEffortPending.get()).toBe(true)

    publishSessionState(
      'runtime-1',
      applySessionInfoStatePatch(resumed, sessionInfoStatePatch({ reasoning_effort: 'max' }))
    )

    expect(PRIMARY_SESSION_VIEW.$reasoningEffortPending.get()).toBe(false)
    expect(PRIMARY_SESSION_VIEW.$reasoningEffort.get()).toBe('max')
    dropSessionState('runtime-1')
  })

  it('does not mark a resumed effort pending when the resume reply already carries it', async () => {
    const sessionStateByRuntimeIdRef = { current: new Map<string, ClientSessionState>() }

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return {
          info: { model: 'qwen3.8-max', reasoning_effort: '' },
          messages: [],
          resumed: params?.session_id,
          session_id: 'runtime-1'
        } as never
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [] } as never)

    await runResume(requestGateway, { sessionStateByRuntimeIdRef })

    publishSessionState('runtime-1', sessionStateByRuntimeIdRef.current.get('runtime-1')!)

    expect(PRIMARY_SESSION_VIEW.$reasoningEffortPending.get()).toBe(false)
    dropSessionState('runtime-1')
  })

  it('resumes via the gateway default (deferred build) — not lazy, no eager opt-out', async () => {
    // The switch-latency fix lives backend-side: a normal cold resume gets the
    // gateway's default DEFERRED build (transcript returns immediately, agent
    // pre-warms in the background). The client must NOT force the synchronous
    // path (eager_build) and is only `lazy` for subagent watch windows.
    let resumeParams: Record<string, unknown> | undefined

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        resumeParams = params

        return { session_id: 'runtime-1', resumed: params?.session_id, messages: [], info: {} } as never
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [] } as never)

    await runResume(requestGateway)

    expect(resumeParams).not.toHaveProperty('lazy')
    expect(resumeParams).not.toHaveProperty('eager_build')
    expect(resumeParams).toMatchObject({ source: 'desktop', omit_messages: true })
  })

  it('captures a cold runtime anchor before session.resume settles and stores it in the runtime cache', async () => {
    const resumeStartedAt = 1_700_000_000_000
    const afterResumeSettles = 1_800_000_000_000
    const now = vi.spyOn(Date, 'now').mockReturnValue(resumeStartedAt)
    const resumeDeferred = deferred<never>()
    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = { current: new Map() }

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-1' } as never)

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return await resumeDeferred.promise
      }

      return {} as never
    })

    let resume: ((storedSessionId: string, replaceRoute?: boolean) => Promise<unknown>) | null = null
    render(
      <ResumeHarness
        onReady={ready => (resume = ready)}
        requestGateway={requestGateway}
        sessionStateByRuntimeIdRef={sessionStateByRuntimeIdRef}
      />
    )
    await waitFor(() => expect(resume).not.toBeNull())

    let resumePromise!: Promise<unknown>
    act(() => {
      resumePromise = resume!('stored-1', true)
    })
    await waitFor(() => expect(requestGateway).toHaveBeenCalledWith('session.resume', expect.any(Object)))

    // The visible timer is anchored before the delayed RPC resolves.
    expect($sessionStartedAt.get()).toBe(resumeStartedAt)
    now.mockReturnValue(afterResumeSettles)
    resumeDeferred.resolve({
      session_id: 'runtime-1',
      resumed: 'stored-1',
      messages: [],
      info: {}
    } as never)

    await act(async () => {
      await resumePromise
    })

    // The cache must retain the pre-await anchor, not a completion-time value.
    expect(sessionStateByRuntimeIdRef.current.get('runtime-1')?.runtimeStartedAt).toBe(resumeStartedAt)
  })

  it('arms the failure latch when resume succeeds with an empty transcript for a non-empty stored session', async () => {
    setSessions([storedSession({ message_count: 4 })])

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return { session_id: 'runtime-1', resumed: params?.session_id, messages: [], info: {} } as never
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-1' } as never)

    await runResume(requestGateway)

    expect($resumeFailedSessionId.get()).toBe('stored-1')
    expect($activeSessionId.get()).toBeNull()
    expect($messages.get()).toEqual([])
  })

  it('does not reuse an empty cached runtime view for a stored session with history', async () => {
    const runtimeIdByStoredSessionIdRef = {
      current: new Map([['stored-1', 'runtime-stale']])
    } satisfies MutableRefObject<Map<string, string>>

    const sessionStateByRuntimeIdRef = {
      current: new Map([
        [
          'runtime-stale',
          {
            awaitingResponse: false,
            branch: '',
            busy: false,
            cwd: '',
            fast: false,
            interimBoundaryPending: false,
            interrupted: false,
            messages: [],
            adoptedRunningTurn: false,
            model: '',
            needsInput: false,
            pendingBranchGroup: null,
            personality: '',
            provider: '',
            reasoningEffort: '',
            runtimeStartedAt: 0,
            sawAssistantPayload: false,
            serviceTier: '',
            storedSessionId: 'stored-1',
            streamId: null,
            turnStartedAt: null,
            turnLive: false,
            usage: null,
            yolo: false
          }
        ]
      ])
    } satisfies MutableRefObject<Map<string, ClientSessionState>>

    setSessions([storedSession({ message_count: 4 })])

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return { session_id: 'runtime-1', resumed: params?.session_id, messages: [], info: {} } as never
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({
      messages: [{ content: 'existing text', role: 'user', timestamp: 1 }],
      session_id: 'stored-1'
    } as never)

    await runResume(requestGateway, {
      runtimeIdByStoredSessionIdRef,
      sessionStateByRuntimeIdRef
    })

    expect(requestGateway).not.toHaveBeenCalledWith('session.usage', { session_id: 'runtime-stale' })
    expect(runtimeIdByStoredSessionIdRef.current.has('stored-1')).toBe(false)
    expect(sessionStateByRuntimeIdRef.current.has('runtime-stale')).toBe(false)
    expect($activeSessionId.get()).toBe('runtime-1')
    expect($messages.get().length).toBe(1)
  })

  it('arms the failure latch when a stale list row hides history the resume RPC still reports', async () => {
    // #83154: a stale/empty sessions-list row (a compressed tip, or a list that
    // has not refreshed since a backend respawn) can carry message_count 0 while
    // the stored transcript is intact. Conditioning the latch on that row alone
    // left the window on an empty thread with an ACTIVE runtime and no latch:
    // no retry, no error, just a silently blank chat. The resume RPC is
    // authoritative about the stored size even when it omits the transcript.
    setSessions([storedSession({ message_count: 0 })])

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return {
          info: {},
          message_count: 12,
          messages: [],
          messages_omitted: true,
          resumed: params?.session_id,
          session_id: 'runtime-1'
        } as never
      }

      return {} as never
    })

    // The REST page is transiently empty too (a respawn racing its state.db read).
    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-1' } as never)

    await runResume(requestGateway)

    expect($resumeFailedSessionId.get()).toBe('stored-1')
    expect($activeSessionId.get()).toBeNull()
    expect($messages.get()).toEqual([])
  })

  it('arms the failure latch when a wake warm-resume bail falls to an empty cold resume', async () => {
    // #82806: on sleep/wake the cached runtime id can be stale, so the warm path
    // binds it, `session.activate` 404s (the backend respawned), the mapping is
    // dropped, and the resume falls through to the cold path. If that cold
    // resume paints nothing — REST and the omitted-messages resume both empty
    // while the list row has not refreshed — the thread was left silently
    // blank. It must arm the retry latch instead.
    const runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>> = {
      current: new Map([['stored-1', 'rt-stale']])
    }

    const sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>> = {
      current: new Map([['rt-stale', clientState('stored-1')]])
    }

    // The list row has not caught up with the respawned backend yet.
    setSessions([storedSession({ message_count: 0 })])

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.activate') {
        throw new Error('404: Session not found')
      }

      if (method === 'session.resume') {
        return {
          info: {},
          message_count: 9,
          messages: [],
          messages_omitted: true,
          resumed: params?.session_id,
          session_id: 'runtime-1'
        } as never
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-1' } as never)

    await runResume(requestGateway, { runtimeIdByStoredSessionIdRef, sessionStateByRuntimeIdRef })

    expect($resumeFailedSessionId.get()).toBe('stored-1')
    expect($activeSessionId.get()).toBeNull()
  })

  // #97809 remaining edge: older builds persisted a `local` owner hint for
  // sessions whose rows carry no connection tag (the legacy primary-SSH
  // path). Clicks repair it (openStoredSession drops the hint for untagged
  // rows), but every pathname-driven resume (boot auto-restore, reconnect
  // re-resume, stranded-view self-heal) funnels through here and used to
  // trust the hint verbatim — dialing the Mac backend for a remote session
  // and dying with "session not found". The row is the authority (same
  // predicate as openStoredSession): a hint that disagrees with a
  // connection-tagged row is stale by definition and must be dropped, not
  // honored — repaired in the map too, so the poison does not survive into
  // the next resume or any session-scoped RPC dispatch.
  it('drops a legacy local owner hint when the row is untagged (#97809)', async () => {
    _resetSessionOwnerHintsForTests({ storage: true })
    setSessionOwnerHint('stored-1', { connectionId: 'local', profile: 'default' })
    // The row carries no connection tag: the session belongs to whichever
    // backend served the list, so an explicit `local` hint is stale.
    setSessions([storedSession({ id: 'stored-1', profile: 'default' })])

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return {
          info: {},
          message_count: 0,
          messages: [],
          resumed: 'stored-1',
          session_id: 'runtime-1',
          session_key: 'stored-1'
        } as never
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-1' } as never)

    await runResume(requestGateway)

    // The poisoned hint is repaired, not just ignored: a stale route left
    // in the map re-poisons the next resume and every session-scoped RPC
    // dispatch that consults the hint rung.
    expect(getSessionOwnerHint('stored-1')).toBeUndefined()
  })

  it("keeps a current owner hint that agrees with the row's connection tag", async () => {
    _resetSessionOwnerHintsForTests({ storage: true })
    setSessionOwnerHint('stored-1', { connectionId: 'ssh-proxmox', profile: 'default' })
    // A connection-tagged row is the authority: the hint naming the same
    // connection is current and must survive the resume. This is the case
    // the foreground-socket predicate got wrong — the hint legitimately
    // names a connection the window is not currently looking at.
    setSessions([storedSession({ connection_id: 'ssh-proxmox', id: 'stored-1', profile: 'default' })])

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return {
          info: {},
          message_count: 0,
          messages: [],
          resumed: 'stored-1',
          session_id: 'runtime-1',
          session_key: 'stored-1'
        } as never
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-1' } as never)

    await runResume(requestGateway)

    expect(getSessionOwnerHint('stored-1')).toMatchObject({ connectionId: 'ssh-proxmox' })
  })

  it("drops a remembered hint whose connection disagrees with the row's tag", async () => {
    _resetSessionOwnerHintsForTests({ storage: true })
    // The hint names a different connection than the row: the row wins.
    setSessionOwnerHint('stored-1', { connectionId: 'ssh-proxmox', profile: 'default' })
    setSessions([storedSession({ connection_id: 'ssh-vps', id: 'stored-1', profile: 'default' })])

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.resume') {
        return {
          info: {},
          message_count: 0,
          messages: [],
          resumed: 'stored-1',
          session_id: 'runtime-1',
          session_key: 'stored-1'
        } as never
      }

      return {} as never
    })

    vi.mocked(getLatestSessionMessages).mockResolvedValue({ messages: [], session_id: 'stored-1' } as never)

    await runResume(requestGateway)

    expect(getSessionOwnerHint('stored-1')).toBeUndefined()
  })
})

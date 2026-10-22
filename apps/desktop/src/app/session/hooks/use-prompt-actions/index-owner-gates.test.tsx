import { JsonRpcGatewayError } from '@hermes/shared'
import { cleanup } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getLatestSessionMessages, getSession } from '@/hermes'
import { en } from '@/i18n/en'
import { textPart } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $notifications, clearNotifications } from '@/store/notifications'
import { $cronRunReadOnlyVerdicts } from '@/store/read-only-transcript'
import { $busy, setMessages, setSessions } from '@/store/session'
import { dropSessionState, publishSessionState } from '@/store/session-states'

import { actRender, Harness, type HarnessHandle, RUNTIME_SESSION_ID, sessionInfo } from './index-test-utils'
import { clearSingleFlightSessionResumeState } from './single-flight-resume'

vi.mock('@/hermes', () => ({
  getLatestSessionMessages: vi.fn(async () => ({ messages: [], session_id: 'session' })),
  getProfiles: vi.fn(async () => ({ profiles: [] })),
  getSession: vi.fn(),
  PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1_800_000,
  setApiRequestProfile: vi.fn(),
  transcribeAudio: vi.fn()
}))

vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  retainGatewayForSessionTurn: vi.fn(async () => () => undefined)
}))

beforeEach(() => {
  clearSingleFlightSessionResumeState()
  window.localStorage.removeItem('hermes.desktop.preparedSubmissions.v1')
  window.localStorage.removeItem('hermes.desktop.composerQueue.v1')
  vi.mocked(getLatestSessionMessages).mockReset()
  vi.mocked(getLatestSessionMessages).mockImplementation(async () => ({ messages: [], session_id: 'session' }))
})

describe('usePromptActions live-owner refusal (#106217)', () => {
  afterEach(() => {
    cleanup()
    clearNotifications()
  })

  it('stamps the 4090 SESSION_NOT_OWNED refusal as a non-retryable gateway error surface', async () => {
    // Another surface (TUI) holds the lease: the gateway refuses prompt.submit
    // with the machine reason in error.data. The inline error bubble must
    // carry that as a structured descriptor so the card can drop Retry and
    // offer "Start new session" without sniffing the English prose.
    let latest: Record<string, unknown> | undefined

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'prompt.submit') {
        throw new JsonRpcGatewayError(
          'Session 20260909_095312_6b93f5 already has a live owner (tui, pid 32977, lease age 22m).',
          { code: 4090, data: { reason: 'SESSION_NOT_OWNED' } }
        )
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={next => {
          latest = next
        }}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    expect(await handle!.submitText('continue here')).toBe(false)

    const bubble = (latest?.messages as { error?: string; errorSurface?: Record<string, unknown> }[]).at(-1)

    expect(bubble?.error).toBeTruthy()
    expect(bubble?.errorSurface).toEqual({ layer: 'gateway', code: 'SESSION_NOT_OWNED', retryable: false })
    // Not a stale-runtime symptom: no resume/re-mint attempt hides the refusal.
    expect(requestGateway.mock.calls.map(c => c[0])).toEqual(['prompt.submit'])
  })
})

describe('usePromptActions send from a window behind the stored transcript', () => {
  afterEach(() => {
    cleanup()
    $notifications.set([])
    setSessions(() => [])
  })

  it('sends without a pre-send transcript read or a warning, even when another view is ahead (#65047)', async () => {
    // The backend owns the model's context: a second window shares the live
    // session, and each turn folds rows other surfaces wrote into the model
    // history before it runs. The window being behind is only a stale view,
    // so the send goes out as typed.
    const storedId = 'stored-behind-submit'
    setSessions(() => [sessionInfo({ id: storedId, profile: 'work-vps', title: 'Remote chat' })])
    vi.mocked(getLatestSessionMessages).mockResolvedValue({
      session_id: storedId,
      messages: [
        { content: 'a', role: 'user', timestamp: 1 },
        { content: 'b', role: 'assistant', timestamp: 2 },
        { content: 'c', role: 'user', timestamp: 3 },
        { content: 'd', role: 'assistant', timestamp: 4 }
      ]
    })

    const requestGateway = vi.fn(async (_method: string) => ({}) as never)
    let handle: HarnessHandle | null = null

    await actRender(
      <Harness
        onReady={h => (handle = h)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
        seedMessages={[
          { id: 'u1', role: 'user', parts: [textPart('a')] },
          { id: 'a1', role: 'assistant', parts: [textPart('b')] }
        ]}
        storedSessionId={storedId}
      />
    )

    expect(await handle!.submitText('send from a window that missed a turn')).toBe(true)
    expect(requestGateway).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({ text: 'send from a window that missed a turn' }),
      1_800_000
    )
    expect(getLatestSessionMessages).not.toHaveBeenCalled()
    expect($notifications.get().some(note => note.kind === 'warning')).toBe(false)
  })

  it('refuses a slash command sent alongside an attachment instead of silently degrading to a chat message (#81798)', async () => {
    // The attachment's refText gets prepended ahead of the typed text by
    // buildContextText, so the merged wire text no longer starts with "/".
    // Before the fix, submitText's attachment-count gate silently fell through
    // to a normal prompt.submit — /goal (and every other slash command) with an
    // attachment vanished into a regular chat message with no feedback.
    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'slash.exec') {
        throw new Error('slash.exec must never be called when an attachment is present')
      }

      if (method === 'prompt.submit') {
        throw new Error('prompt.submit must never be called for a slash command')
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness onReady={h => (handle = h)} refreshSessions={async () => undefined} requestGateway={requestGateway} />
    )

    const ok = await handle!.submitText('/goal align with the handoff doc', {
      attachments: [
        {
          id: 'file:handoff.md',
          kind: 'file',
          label: 'handoff.md',
          path: '/Users/alice/handoff.md',
          refText: '@file:`/Users/alice/handoff.md`'
        }
      ]
    })

    expect(ok).toBe(false)
    expect(requestGateway).not.toHaveBeenCalled()
    expect($notifications.get()).toEqual(
      expect.arrayContaining([expect.objectContaining({ message: en.desktop.slashCommandIgnoredBody })])
    )
  })
})

// The stale-closure suite above seeds the GLOBAL `$messages` mirror, which
// exercises only the `?? $messages.get()` FALLBACK of the dual-store read —
// a plan could still come from the mirror and the tests would pass. Active
// sessions publish their transcript into `$sessionStates[runtimeId].messages`
// while the global mirror stays empty/divergent, so these tests pin the
// PRIMARY path: all three planners must derive their plan from the runtime
// slice.
describe('usePromptActions derives plans from the runtime slice ($sessionStates)', () => {
  const RUNTIME_SESSION_B = 'rt-session-b-runtime-slice'

  const RUNTIME_SLICE_MESSAGES = [
    { id: 'u1', parts: [textPart('first prompt')], role: 'user' as const, timestamp: 0 },
    { id: 'a1', parts: [textPart('first reply')], role: 'assistant' as const, timestamp: 1 },
    { id: 'u2', parts: [textPart('second prompt')], role: 'user' as const, timestamp: 2 }
  ]

  beforeEach(() => {
    // reloadFromMessage bails on a busy session; other suites leave $busy true.
    $busy.set(false)
  })

  afterEach(() => {
    cleanup()
    setMessages([])
    dropSessionState(RUNTIME_SESSION_B)
    $busy.set(false)
    vi.restoreAllMocks()
  })

  type GatewayCall = [string, Record<string, unknown>?]
  type GatewayRequestFn = <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
  type GatewayMock = GatewayRequestFn & { mock: { calls: unknown[][] } }

  function gatewayCalls(requestGateway: GatewayMock): GatewayCall[] {
    return requestGateway.mock.calls as unknown as GatewayCall[]
  }

  // Renders with the ref pinned to a runtime session whose transcript lives
  // ONLY in $sessionStates — the global $messages mirror stays empty (or
  // divergent when seedMirror is given), so a plan derived from the mirror
  // would be null and the action would bail before any gateway call.
  async function renderWithRuntimeSlice(requestGateway: GatewayMock, seedMirror?: unknown[]) {
    const activeSessionIdRef: MutableRefObject<string | null> = { current: RUNTIME_SESSION_ID }
    const updated: string[] = []

    if (seedMirror) {
      setMessages(seedMirror as never)
    }

    publishSessionState(RUNTIME_SESSION_B, createClientSessionState(RUNTIME_SESSION_B, RUNTIME_SLICE_MESSAGES))

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        activeSessionId={RUNTIME_SESSION_ID}
        activeSessionIdRef={activeSessionIdRef}
        onReady={h => (handle = h)}
        onUpdateState={sessionId => updated.push(sessionId)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
        selectedStoredSessionIdRef={{ current: null }}
      />
    )

    // The user switched to a runtime session whose transcript is in the slice.
    activeSessionIdRef.current = RUNTIME_SESSION_B

    return { handle: handle!, updated }
  }

  it('regenerates from a message that exists only in the runtime slice (empty global mirror)', async () => {
    const requestGateway = vi.fn(async (_method: string) => ({}) as never) as unknown as GatewayMock

    const { handle } = await renderWithRuntimeSlice(requestGateway)

    await handle.reloadFromMessage('u2')

    // u2 exists only in $sessionStates — the global mirror is [], so a plan
    // from the mirror would be null and no prompt.submit would ever fire.
    expect(requestGateway).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({
        session_id: RUNTIME_SESSION_B,
        text: 'second prompt',
        confirm_truncate: true,
        truncate_before_message_id: 'u2'
      }),
      expect.anything()
    )
  })

  it('restores a checkpoint from a message that exists only in the runtime slice (empty global mirror)', async () => {
    const requestGateway = vi.fn(async (_method: string) => ({}) as never) as unknown as GatewayMock

    const { handle } = await renderWithRuntimeSlice(requestGateway)

    await handle.restoreToMessage('u2')

    // planRestore could only resolve u2 from $sessionStates — the global
    // mirror is [], so a mirror-based plan would throw before any submit.
    expect(requestGateway).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({
        session_id: RUNTIME_SESSION_B,
        text: 'second prompt',
        confirm_truncate: true,
        truncate_before_message_id: 'u2'
      }),
      expect.anything()
    )
  })

  it('edits a message that exists only in the runtime slice (empty global mirror)', async () => {
    const requestGateway = vi.fn(async (_method: string) => ({}) as never) as unknown as GatewayMock

    const { handle } = await renderWithRuntimeSlice(requestGateway)

    await handle.editMessage({
      content: [{ text: 'edited prompt', type: 'text' }],
      parentId: null,
      role: 'user',
      sourceId: 'u2'
    } as never)

    // planEdit could only resolve u2 from $sessionStates — the global mirror
    // is [], so a mirror-based plan would be null and nothing would submit.
    expect(requestGateway).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({
        session_id: RUNTIME_SESSION_B,
        text: 'edited prompt',
        confirm_truncate: true,
        truncate_before_message_id: 'u2'
      }),
      expect.anything()
    )
  })

  it('prefers the runtime slice over a divergent global $messages mirror', async () => {
    // Same message id in both stores, but DIFFERENT text: the mirror holds a
    // stale transcript. The plan must come from the runtime slice, not the
    // mirror's copy.
    const requestGateway = vi.fn(async (_method: string) => ({}) as never) as unknown as GatewayMock

    const { handle } = await renderWithRuntimeSlice(requestGateway, [
      { id: 'u2', parts: [textPart('stale mirror prompt')], role: 'user', timestamp: 0 }
    ])

    await handle.reloadFromMessage('u2')

    expect(requestGateway).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({
        session_id: RUNTIME_SESSION_B,
        text: 'second prompt'
      }),
      expect.anything()
    )
    expect(requestGateway).not.toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({ text: 'stale mirror prompt' }),
      expect.anything()
    )
  })
})

describe('usePromptActions cron run write gate (#88443)', () => {
  const storedId = 'cron_job-1_20260929_120000'

  afterEach(() => {
    cleanup()
    $notifications.set([])
    $cronRunReadOnlyVerdicts.set(new Map())
    setSessions(() => [])
    vi.mocked(getSession).mockReset()
  })

  const renderRestoredRun = async (requestGateway: ReturnType<typeof vi.fn>) => {
    let handle: HarnessHandle | null = null

    // A route/tab restored after an app restart: no Cron surface evaluated the
    // run, so there is no verdict yet — the send itself must gate it.
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway as never}
        storedSessionId={storedId}
      />
    )

    return handle!
  }

  it('refuses a send into a restored never-closed run the scheduler does not own', async () => {
    vi.mocked(getSession).mockResolvedValue(
      sessionInfo({ ended_at: null, id: storedId, scheduler_owned: false, source: 'cron' })
    )

    const requestGateway = vi.fn(async (_method: string) => ({}) as never)
    const handle = await renderRestoredRun(requestGateway)

    expect(await handle.submitText('into the dead cron session')).toBe(false)
    expect(getSession).toHaveBeenCalledWith(storedId, expect.anything())
    expect(requestGateway).not.toHaveBeenCalledWith('prompt.submit', expect.anything(), expect.anything())
    expect($notifications.get().some(note => note.kind === 'info')).toBe(true)
  })

  it('sends into a run past the activity window while the scheduler still owns it', async () => {
    $cronRunReadOnlyVerdicts.set(new Map([[storedId, true]])) // looked idle earlier
    vi.mocked(getSession).mockResolvedValue(
      sessionInfo({ ended_at: null, id: storedId, is_active: false, scheduler_owned: true, source: 'cron' })
    )

    const requestGateway = vi.fn(async (_method: string) => ({}) as never)
    const handle = await renderRestoredRun(requestGateway)

    expect(await handle.submitText('still running')).toBe(true)
    expect(requestGateway).toHaveBeenCalledWith(
      'prompt.submit',
      expect.objectContaining({ text: 'still running' }),
      1_800_000
    )
  })
})

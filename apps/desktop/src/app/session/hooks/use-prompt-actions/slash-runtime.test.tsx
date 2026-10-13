import { act, cleanup, waitFor } from '@testing-library/react'
import type { MutableRefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getLatestSessionMessages } from '@/hermes'
import { I18nProvider, setRuntimeI18nLocale } from '@/i18n'
import { textPart } from '@/lib/chat-messages'
import { $compactingSessions, setSessionCompacting } from '@/store/compaction'
import { $notifications, clearNotifications } from '@/store/notifications'
import { $currentUsage, $messages, setCurrentUsage, setMessages, setSessions } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import { actRender, Harness, type HarnessHandle, RUNTIME_SESSION_ID } from './prompt-actions-harness'
import { renderedSeedTexts } from './prompt-seed-texts'
import { clearSingleFlightSessionResumeState } from './single-flight-resume'
import { SESSION_COMPRESS_TIMEOUT_MS } from './slash'

// Suites in this file reuse the same stored-id constants. The module-level
// single-flight resume map (and drift-recovery cache) would otherwise leak a
// never-settling in-flight promise from one test into the next.
beforeEach(() => {
  clearSingleFlightSessionResumeState()
  // Queue mutations build on the persisted map, not the atom — a queue an
  // earlier test left in storage would otherwise sit ahead of this test's send.
  window.localStorage.removeItem('hermes.desktop.composerQueue.v1')
  vi.mocked(getLatestSessionMessages).mockReset()
  vi.mocked(getLatestSessionMessages).mockImplementation(async () => ({ messages: [], session_id: 'session' }))
})

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

// The active id the desktop holds is the *runtime* session id from
// session.create — deliberately distinct from the stored DB id here, because
// that mismatch is the bug: the REST renameSession endpoint resolves against
// the stored sessions table and 404s on a runtime id. session.title accepts
// the runtime id directly.
// Every typed command also fires this (fire-and-forget); these tests assert the command's own traffic.
const SLASH_METRIC = 'shared_metrics.slash_command'

function sessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    ended_at: null,
    id: RUNTIME_SESSION_ID,
    input_tokens: 0,
    is_active: true,
    last_active: 0,
    message_count: 3,
    model: null,
    output_tokens: 0,
    preview: null,
    source: null,
    started_at: 0,
    title: 'Old title',
    tool_call_count: 0,
    ...overrides
  }
}

describe('usePromptActions /compress', () => {
  beforeEach(() => {
    $compactingSessions.set({})
    clearNotifications()
    setRuntimeI18nLocale('en')
    setSessions(() => [sessionInfo()])
  })

  afterEach(() => {
    cleanup()
    $compactingSessions.set({})
    setRuntimeI18nLocale('en')
    clearNotifications()
    setCurrentUsage({ calls: 0, input: 0, output: 0, total: 0 })
    setMessages([])
    vi.restoreAllMocks()
  })

  it('routes through session.compress (not slash.exec) with the compute-host ceiling timeout and renders the summary', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string, _params?: Record<string, unknown>, _timeoutMs?: number) => {
      if (method === 'session.compress') {
        return {
          info: { usage: { compressions: 1 } },
          removed: 8,
          summary: {
            headline: 'Compressed: 234 → 226 messages',
            noop: false,
            token_line: 'Approx request size: ~285,727 → ~198,104 tokens'
          }
        } as never
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    await handle!.submitText('/compress')

    // The dedicated RPC is the TUI's path and has no slash-worker pipe
    // timeout — and the call carries an LLM-sized client timeout instead of
    // the 30s WS default, so a large session's compression can finish.
    expect(requestGateway).toHaveBeenCalledWith(
      'session.compress',
      expect.objectContaining({ session_id: RUNTIME_SESSION_ID }),
      SESSION_COMPRESS_TIMEOUT_MS
    )
    expect(requestGateway).not.toHaveBeenCalledWith('slash.exec', expect.anything())
    expect(requestGateway).not.toHaveBeenCalledWith('command.dispatch', expect.anything())
    expect($currentUsage.get().compressions).toBe(1)
  })

  it('renders the compressed-message fallback in Simplified Chinese', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.compress') {
        return { removed: 3 } as never
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <I18nProvider configClient={null} initialLocale="zh">
        <Harness
          onReady={h => (handle = h)}
          onSeedState={state => seeds.push(state)}
          refreshSessions={async () => undefined}
          requestGateway={requestGateway}
        />
      </I18nProvider>
    )

    await handle!.submitText('/compress')

    expect(renderedSeedTexts(seeds).join('\n')).toContain('已压缩 3 条消息')
  })

  it('replaces the transcript from the response messages', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string, _params?: Record<string, unknown>, _timeoutMs?: number) => {
      if (method === 'session.compress') {
        return {
          removed: 2,
          summary: { headline: 'Compressed: 4 → 2 messages' },
          messages: [
            { role: 'user', content: 'summarized context' },
            { role: 'assistant', content: 'sure, here is the summary' }
          ]
        } as never
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    await handle!.submitText('/compress')

    // The transcript was replaced with the post-compress history.
    const finalMessages = seeds[seeds.length - 1]?.messages as Array<{ parts?: Array<{ text?: string }> }>

    const renderedText = (finalMessages ?? [])
      .flatMap(message => (message.parts ?? []).map(part => part.text ?? ''))
      .join('\n')

    expect(renderedText).toContain('summarized context')
    expect(renderedText).toContain('sure, here is the summary')
  })

  it('keeps pre-compression messages reachable after the transcript rewrite (#105256)', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string, _params?: Record<string, unknown>, _timeoutMs?: number) => {
      if (method === 'session.compress') {
        return {
          removed: 2,
          summary: { headline: 'Compressed: 4 → 2 messages' },
          messages: [
            { role: 'user', content: 'summarized context' },
            { role: 'assistant', content: 'sure, here is the summary' }
          ]
        } as never
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
        seedMessages={[
          { id: 'pre-1', role: 'user', parts: [textPart('pre-compression user turn')], timestamp: 0 },
          { id: 'pre-2', role: 'assistant', parts: [textPart('pre-compression assistant reply')], timestamp: 1 }
        ]}
      />
    )

    await handle!.submitText('/compress')

    // The transcript was replaced with the post-compress history.
    const finalMessages = seeds[seeds.length - 1]?.messages as Array<{ parts?: Array<{ text?: string }> }>

    const renderedText = (finalMessages ?? [])
      .flatMap(message => (message.parts ?? []).map(part => part.text ?? ''))
      .join('\n')

    expect(renderedText).toContain('summarized context')
    expect(renderedText).toContain('sure, here is the summary')
    // Active-session scrollback: the pre-compression segment stays in the
    // transcript so scrolling up still reaches it.
    expect(renderedText).toContain('pre-compression user turn')
    expect(renderedText).toContain('pre-compression assistant reply')
    expect(renderedText.indexOf('pre-compression user turn')).toBeLessThan(renderedText.indexOf('summarized context'))
  })

  it('uses the compute-host response transcript and success output', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.compress') {
        return {
          host_ack: { output: 'Compressed 4 → 2 messages' },
          messages: [
            { role: 'user', content: 'compute-host summary' },
            { role: 'assistant', content: 'compute-host answer' }
          ]
        } as never
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    await handle!.submitText('/compress')

    const computeHostTexts = renderedSeedTexts(seeds)
    expect(computeHostTexts).toEqual(expect.arrayContaining(['compute-host summary', 'compute-host answer']))
    expect(computeHostTexts.some(text => text.includes('Compressed 4 → 2 messages'))).toBe(true)
    expect($notifications.get()).toEqual([])
  })

  it('renders an aborted compression as an error, not a success', async () => {
    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.compress') {
        return {
          status: 'aborted',
          summary: {
            aborted: true,
            headline: 'Compression aborted: 6 messages preserved',
            note: 'No compression provider is configured.'
          }
        } as never
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness onReady={h => (handle = h)} refreshSessions={async () => undefined} requestGateway={requestGateway} />
    )

    await handle!.submitText('/compress')

    expect($notifications.get()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'error', message: expect.stringContaining('Compression aborted') })
      ])
    )
    expect($notifications.get()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'success', message: expect.stringContaining('Compression aborted') })
      ])
    )
    expect($compactingSessions.get()).toEqual({})
  })

  it('renders a would-grow compression refusal without durable success output', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.compress') {
        return {
          status: 'compressed',
          summary: {
            aborted: false,
            headline: 'Compression refused: 6 messages preserved',
            refused_would_grow: true
          }
        } as never
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    await handle!.submitText('/compress')

    expect(renderedSeedTexts(seeds).some(text => text.includes('Compression refused'))).toBe(false)
    expect($notifications.get()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'error', message: expect.stringContaining('Compression refused') })
      ])
    )
    expect($notifications.get()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'success', message: expect.stringContaining('Compression refused') })
      ])
    )
  })

  it('passes a focus topic through as focus_topic', async () => {
    const requestGateway = vi.fn(
      async (_method: string, _params?: Record<string, unknown>, _timeoutMs?: number) => ({ removed: 0 }) as never
    )

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness onReady={h => (handle = h)} refreshSessions={async () => undefined} requestGateway={requestGateway} />
    )

    await handle!.submitText('/compress the auth refactor')

    expect(requestGateway).toHaveBeenCalledWith(
      'session.compress',
      expect.objectContaining({ focus_topic: 'the auth refactor' }),
      SESSION_COMPRESS_TIMEOUT_MS
    )
  })

  it('surfaces the RPC error verbatim (e.g. the busy guard) instead of a routing error', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.compress') {
        throw new Error('session busy — /interrupt the current turn before /compress')
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    await handle!.submitText('/compress')

    const texts = renderedSeedTexts(seeds)
    expect(texts.some(text => text.includes('session busy'))).toBe(true)
    expect(texts.some(text => text.includes('not a quick/plugin/skill command'))).toBe(false)
    expect($compactingSessions.get()).toEqual({})
  })

  it('falls back to the slash worker when an older gateway lacks session.compress', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.compress') {
        throw new Error('method not found: session.compress')
      }

      if (method === 'slash.exec') {
        return { output: 'compressed by legacy gateway' } as never
      }

      throw new Error(`unexpected method: ${method}`)
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    await handle!.submitText('/compress')

    expect(requestGateway).toHaveBeenCalledWith('slash.exec', expect.objectContaining({ command: 'compress' }))
    expect(renderedSeedTexts(seeds).some(text => text.includes('compressed by legacy gateway'))).toBe(true)
    expect($compactingSessions.get()).toEqual({})
  })

  it('does not clobber the foreground transcript when compression resolves after a session switch', async () => {
    const RUNTIME_SESSION_B = 'rt-session-b'
    const storedSessionIdRef: MutableRefObject<string | null> = { current: 'stored-a' }
    const updates: Array<{ sessionId: string; storedSessionId: null | string | undefined }> = []

    let resolveCompress: (value: unknown) => void = () => undefined

    const compressResult = new Promise(resolve => {
      resolveCompress = resolve
    })

    const activeSessionIdRef: MutableRefObject<string | null> = { current: RUNTIME_SESSION_ID }

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.compress') {
        return (await compressResult) as never
      }

      throw new Error(`unexpected method: ${method}`)
    })

    setMessages([{ id: 'foreground-b', parts: [textPart('session B transcript')], role: 'user', timestamp: 0 }])
    setCurrentUsage({ calls: 7, input: 70, output: 30, total: 100 })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        activeSessionIdRef={activeSessionIdRef}
        onReady={h => (handle = h)}
        onUpdateState={(sessionId, storedSessionId) => updates.push({ sessionId, storedSessionId })}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
        selectedStoredSessionIdRef={storedSessionIdRef}
      />
    )

    // Start the request in a synchronous act. The async `submitText` harness
    // helper cannot be used here: this test intentionally keeps its promise
    // pending while the user switches sessions, which would leave React's
    // async act scope open and overlap the wait below.
    let submitted: Promise<boolean>
    act(() => {
      submitted = handle!.submitTextRaw('/compress')
    })
    await waitFor(() =>
      expect(requestGateway).toHaveBeenCalledWith('session.compress', expect.anything(), SESSION_COMPRESS_TIMEOUT_MS)
    )

    // Switch to session B before compression resolves.
    activeSessionIdRef.current = RUNTIME_SESSION_B
    resolveCompress({
      info: { usage: { context_used: 4_000, total: 12_000 } },
      messages: [{ content: 'compressed session A transcript', role: 'system' }],
      removed: 5
    })
    await act(async () => {
      await submitted
    })

    // The foreground transcript + usage are unchanged — the late result only
    // updated session A's cache, not the active session B's.
    expect($messages.get()).toEqual([
      { id: 'foreground-b', parts: [textPart('session B transcript')], role: 'user', timestamp: 0 }
    ])
    expect($currentUsage.get()).toEqual(expect.objectContaining({ calls: 7, input: 70, output: 30, total: 100 }))
    expect(updates).toContainEqual({ sessionId: RUNTIME_SESSION_ID, storedSessionId: 'stored-a' })
  })

  it('keeps a late compression error bound to its invocation-time stored session', async () => {
    const RUNTIME_SESSION_B = 'rt-session-b'
    const storedSessionIdRef: MutableRefObject<string | null> = { current: 'stored-a' }
    const activeSessionIdRef: MutableRefObject<string | null> = { current: RUNTIME_SESSION_ID }
    const updates: Array<{ sessionId: string; storedSessionId: null | string | undefined }> = []
    let rejectCompress: (reason?: unknown) => void = () => undefined

    const compressResult = new Promise((_, reject) => {
      rejectCompress = reject
    })

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.compress') {
        return (await compressResult) as never
      }

      throw new Error(`unexpected method: ${method}`)
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        activeSessionIdRef={activeSessionIdRef}
        onReady={h => (handle = h)}
        onUpdateState={(sessionId, storedSessionId) => updates.push({ sessionId, storedSessionId })}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
        selectedStoredSessionIdRef={storedSessionIdRef}
      />
    )

    // Keep the RPC pending while the selected stored session changes without
    // leaving an async React act scope open (see the foreground-race test).
    let submitted: Promise<boolean>
    act(() => {
      submitted = handle!.submitTextRaw('/compress')
    })
    await waitFor(() =>
      expect(requestGateway).toHaveBeenCalledWith('session.compress', expect.anything(), SESSION_COMPRESS_TIMEOUT_MS)
    )
    activeSessionIdRef.current = RUNTIME_SESSION_B
    storedSessionIdRef.current = 'stored-b'
    rejectCompress(new Error('compression failed'))
    await act(async () => {
      await submitted
    })

    expect(updates).toContainEqual({ sessionId: RUNTIME_SESSION_ID, storedSessionId: 'stored-a' })
  })
  it.each([
    { status: 'compressed', completedBeforeResponse: false, remainsCompacting: false },
    { status: 'pending', completedBeforeResponse: false, remainsCompacting: true },
    { status: 'pending', completedBeforeResponse: true, remainsCompacting: false }
  ])(
    'keeps compression progress session-scoped without toasts ($status, completed=$completedBeforeResponse)',
    async ({ status, completedBeforeResponse, remainsCompacting }) => {
      const otherSessionId = 'rt-other-compression'
      setSessionCompacting(otherSessionId, true)
      let resolveCompress: (value: unknown) => void = () => undefined

      const compressResult = new Promise(resolve => {
        resolveCompress = resolve
      })

      const requestGateway = vi.fn(async (method: string) => {
        if (method === 'session.compress') {
          return (await compressResult) as never
        }

        throw new Error(`unexpected method: ${method}`)
      })

      let handle: HarnessHandle | null = null
      await actRender(
        <Harness onReady={h => (handle = h)} refreshSessions={async () => undefined} requestGateway={requestGateway} />
      )

      let submitted: Promise<boolean>
      act(() => {
        submitted = handle!.submitTextRaw('/compress')
      })
      await waitFor(() =>
        expect($compactingSessions.get()).toEqual({
          [otherSessionId]: true,
          [RUNTIME_SESSION_ID]: true
        })
      )
      expect($notifications.get()).toEqual([])

      if (completedBeforeResponse) {
        act(() => setSessionCompacting(RUNTIME_SESSION_ID, false))
      }

      await act(async () => {
        resolveCompress({ status, messages: [{ content: 'compressed transcript', role: 'system' }] })
        await submitted
      })
      expect($compactingSessions.get()).toEqual({
        [otherSessionId]: true,
        ...(remainsCompacting ? { [RUNTIME_SESSION_ID]: true } : {})
      })
      expect($notifications.get()).toEqual([])

      if (remainsCompacting) {
        await handle!.submitText('/compress')
        expect(requestGateway.mock.calls.filter(([method]) => method === 'session.compress')).toHaveLength(1)
        expect($compactingSessions.get()[RUNTIME_SESSION_ID]).toBe(true)
      }
    }
  )

  it('preserves automatic compaction without issuing a competing manual request', async () => {
    setSessionCompacting(RUNTIME_SESSION_ID, true)

    const requestGateway = vi.fn(async (_method: string) => {
      throw new Error('session busy')
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness onReady={h => (handle = h)} refreshSessions={async () => undefined} requestGateway={requestGateway} />
    )

    await handle!.submitText('/compress')

    expect(requestGateway.mock.calls.filter(([method]) => method !== 'shared_metrics.slash_command')).toEqual([])
    expect($compactingSessions.get()).toEqual({ [RUNTIME_SESSION_ID]: true })
  })

  it('moves compression progress and output to a recovered runtime and releases it after an error', async () => {
    const recoveredSessionId = 'rt-compress-recovered'
    const storedSessionId = 'stored-compress-owner'
    const activeSessionIdRef = { current: RUNTIME_SESSION_ID }
    const selectedStoredSessionIdRef = { current: storedSessionId }
    const updates: Array<{ sessionId: string; storedSessionId: null | string | undefined }> = []
    const seeds: Record<string, unknown>[] = []
    let rejectCompress: (reason: unknown) => void = () => undefined

    const compression = new Promise((_, reject) => {
      rejectCompress = reject
    })

    let recoveredCalls = 0

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.resume') {
        return { session_id: recoveredSessionId } as never
      }

      if (method === 'session.compress') {
        if (params?.session_id === RUNTIME_SESSION_ID) {
          throw new Error('session not found')
        }

        recoveredCalls += 1

        return (recoveredCalls === 1 ? await compression : { removed: 3 }) as never
      }

      throw new Error(`unexpected method: ${method}`)
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        activeSessionIdRef={activeSessionIdRef}
        onReady={h => (handle = h)}
        onSeedState={state => seeds.push(state)}
        onUpdateState={(sessionId, storedId) => updates.push({ sessionId, storedSessionId: storedId })}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
        selectedStoredSessionIdRef={selectedStoredSessionIdRef}
      />
    )

    let submitted: Promise<boolean>
    act(() => {
      submitted = handle!.submitTextRaw('/compress')
    })
    await waitFor(() => expect($compactingSessions.get()).toEqual({ [recoveredSessionId]: true }))
    expect(activeSessionIdRef.current).toBe(recoveredSessionId)

    await act(async () => {
      rejectCompress(new Error('recovered compression failed'))
      await submitted
    })
    expect($compactingSessions.get()).toEqual({})
    expect(updates).toEqual([{ sessionId: recoveredSessionId, storedSessionId }])
    expect(renderedSeedTexts(seeds).join('\n')).toContain('recovered compression failed')

    await handle!.submitText('/compress')
    expect(recoveredCalls).toBe(2)
    expect($compactingSessions.get()).toEqual({})
    expect(renderedSeedTexts(seeds).join('\n')).toContain('compressed 3 messages')
    expect(updates.every(update => update.sessionId === recoveredSessionId)).toBe(true)
  })
})

describe('usePromptActions /btw', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  // #99065: slash.exec only captured the ack; the answer prints after the
  // worker's stdout window. prompt.btw + btw.complete is the TUI path.
  it('routes through prompt.btw (not slash.exec) and renders the start notice', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'prompt.btw') {
        return { task_id: 'btw_ab12cd' } as never
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    await handle!.submitText('/btw which file was that error in?')

    expect(requestGateway).toHaveBeenCalledWith('prompt.btw', {
      session_id: RUNTIME_SESSION_ID,
      text: 'which file was that error in?'
    })
    expect(requestGateway).not.toHaveBeenCalledWith('slash.exec', expect.anything())
    expect(requestGateway).not.toHaveBeenCalledWith('command.dispatch', expect.anything())
    expect(renderedSeedTexts(seeds).some(text => text.includes('btw_ab12cd'))).toBe(true)
  })

  it('falls back to the slash worker when an older gateway lacks prompt.btw', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'prompt.btw') {
        throw new Error('method not found: prompt.btw')
      }

      if (method === 'slash.exec') {
        return { output: 'Side question started by legacy gateway' } as never
      }

      throw new Error(`unexpected method: ${method}`)
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    await handle!.submitText('/btw anything')

    expect(requestGateway).toHaveBeenCalledWith('slash.exec', expect.objectContaining({ command: 'btw anything' }))
    expect(renderedSeedTexts(seeds).some(text => text.includes('legacy gateway'))).toBe(true)
  })
})

describe('usePromptActions /background', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  // #97635: the slash-worker route prints the completion from a
  // fire-and-forget thread after process_command already returned — past the
  // worker's stdout capture window — so the result never reached the desktop
  // conversation that started the task. The dedicated prompt.background RPC
  // is the TUI's path; the response arrives later as a background.complete
  // gateway event.
  it('routes through prompt.background (not slash.exec) and renders the start notice', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'prompt.background') {
        return { task_id: 'bg_104613_385db3' } as never
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    await handle!.submitText('/background summarize the top HN stories')

    expect(requestGateway).toHaveBeenCalledWith('prompt.background', {
      session_id: RUNTIME_SESSION_ID,
      text: 'summarize the top HN stories'
    })
    expect(requestGateway).not.toHaveBeenCalledWith('slash.exec', expect.anything())
    expect(requestGateway).not.toHaveBeenCalledWith('command.dispatch', expect.anything())
    expect(renderedSeedTexts(seeds).some(text => text.includes('bg_104613_385db3'))).toBe(true)
  })

  it('falls back to the slash worker when an older gateway lacks prompt.background', async () => {
    const seeds: Record<string, unknown>[] = []

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'prompt.background') {
        throw new Error('method not found: prompt.background')
      }

      if (method === 'slash.exec') {
        return { output: 'Background task started by legacy gateway' } as never
      }

      throw new Error(`unexpected method: ${method}`)
    })

    let handle: HarnessHandle | null = null
    await actRender(
      <Harness
        onReady={h => (handle = h)}
        onSeedState={s => seeds.push(s)}
        refreshSessions={async () => undefined}
        requestGateway={requestGateway}
      />
    )

    await handle!.submitText('/background anything')

    expect(requestGateway).toHaveBeenCalledWith(
      'slash.exec',
      expect.objectContaining({ command: 'background anything' })
    )
    expect(renderedSeedTexts(seeds).some(text => text.includes('legacy gateway'))).toBe(true)
  })
})

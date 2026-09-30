// Loading and activity indicators mount only on the thread's last message.
// The tail-only gate from ba756333 keeps non-tail running bubbles silent,
// including assistants followed only by a user or system row. The optimistic
// placeholder flow renders exactly one status row. These contracts pin the
// duplicate-indicator regression tracked in #68634.
import { AssistantRuntimeProvider, type ThreadMessage, useExternalStoreRuntime } from '@assistant-ui/react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetElapsedTimerRegistryForTests } from '@/components/chat/activity-timer'
import { $compactingSessions, setSessionCompacting } from '@/store/compaction'
import { setSessionProviderWait } from '@/store/provider-wait'
import { $activeSessionId, $turnStartedAt } from '@/store/session'

import { assistantMessage, stubThreadEnvironment, stubThreadViewportSize, userMessage } from '../test-utils'

import { TranscriptWindowProvider } from './transcript-window'

import { Thread } from '.'

// Layout/observer stubs mirrored from streaming.test.tsx. jsdom has no
// ResizeObserver, rAF, or real layout, and the Thread scroll container needs
// non-zero dimensions to mount without throwing.
stubThreadEnvironment()

stubThreadViewportSize()

const createdAt = new Date('2026-05-01T00:00:00.000Z')
const sessionId = 'session-68634'

// This shape mirrors the `/steer` note appended by appendSessionTextMessage
// in apps/desktop/src/app/session/hooks/use-prompt-actions/index.ts.
function systemMessage(id: string, text: string): ThreadMessage {
  return {
    id,
    role: 'system',
    content: [{ type: 'text', text }],
    createdAt,
    metadata: { custom: {} }
  } as ThreadMessage
}

function runningAssistantMessage(id: string, text: string): ThreadMessage {
  return {
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    status: { type: 'running' },
    createdAt,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {}
    }
  } as ThreadMessage
}

function Harness({ messages, isRunning = false }: { messages: ThreadMessage[]; isRunning?: boolean }) {
  // isRunning: false at the runtime level. Per-message `status: {type:
  // 'running'}` is what drives TurnActivityIndicator mounting.
  // Passing isRunning: true makes useExternalStoreRuntime auto-append a
  // synthetic empty trailing assistant placeholder whenever the last message
  // is not already a running assistant, such as the trailing user prompt
  // cases below. That is the real production flow. The isRunning:true tests
  // prove that the placeholder is treated as the tail and renders its own
  // loading row while the real bubble's activity row stays silent.
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages,
    isRunning,
    onNew: async () => {}
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread />
    </AssistantRuntimeProvider>
  )
}

describe('TurnActivityIndicator tail gating (#68634)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    __resetElapsedTimerRegistryForTests()
    $activeSessionId.set(sessionId)
    $turnStartedAt.set(Date.now())
    setSessionProviderWait(sessionId, 'Waiting for provider')
  })

  afterEach(() => {
    cleanup()
    $compactingSessions.set({})
    setSessionProviderWait(sessionId, '')
    $activeSessionId.set(null)
    $turnStartedAt.set(null)
    __resetElapsedTimerRegistryForTests()
    vi.useRealTimers()
  })

  it('renders exactly one indicator, on the later bubble, when two assistant bubbles are running with content', () => {
    const { container } = render(
      <Harness
        messages={[
          userMessage('user-1', 'Summarize this thread for me'),
          runningAssistantMessage('assistant-1', 'Working on it'),
          userMessage('user-2', 'hola?'),
          runningAssistantMessage('assistant-2', 'On it too')
        ]}
      />
    )

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    const indicators = screen.getAllByRole('status', { name: 'Waiting for provider' })
    expect(indicators.length).toBe(1)

    const roots = container.querySelectorAll('[data-slot="aui_assistant-message-root"]')
    expect(roots.length).toBe(2)
    // The second assistant root is also the thread's any-role tail.
    expect(roots[0]?.querySelector('[data-slot="aui_turn-activity"]')).toBeNull()
    expect(roots[1]?.querySelector('[data-slot="aui_turn-activity"]')).not.toBeNull()
  })

  it('keeps a running assistant silent when a queued user prompt trails it and the runtime is idle', () => {
    const { container } = render(
      <Harness
        messages={[
          userMessage('user-1', 'Summarize this thread for me'),
          runningAssistantMessage('assistant-1', 'Working on it'),
          userMessage('user-2', 'hola?')
        ]}
      />
    )

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(container.querySelector('[data-slot="aui_response-loading"]')).toBeNull()
    expect(container.querySelector('[data-slot="aui_turn-activity"]')).toBeNull()
  })

  it('keeps a running assistant silent when a steer system note trails it and the runtime is idle', () => {
    const { container } = render(
      <Harness
        messages={[
          userMessage('user-1', 'Summarize this thread for me'),
          runningAssistantMessage('assistant-1', 'Working on it'),
          systemMessage('system-steer-1', 'steer:focus on the errors')
        ]}
      />
    )

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(container.querySelector('[data-slot="aui_response-loading"]')).toBeNull()
    expect(container.querySelector('[data-slot="aui_turn-activity"]')).toBeNull()
  })

  // In the production flow, isRunning: true with a trailing queued user prompt
  // makes the runtime append an empty optimistic assistant placeholder after
  // the real running bubble. The placeholder renders ResponseLoadingIndicator.
  // During a provider wait, that row carries the same accessible label as the stall
  // indicator. The real non-tail bubble must remain silent so there is exactly
  // one status row.
  it('still renders the indicator when the runtime appends an optimistic placeholder (isRunning:true)', () => {
    render(
      <Harness
        isRunning
        messages={[
          userMessage('user-1', 'Summarize this thread for me'),
          runningAssistantMessage('assistant-1', 'Working on it'),
          userMessage('user-2', 'hola?')
        ]}
      />
    )

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    const indicators = screen.getAllByRole('status', { name: 'Waiting for provider' })
    expect(indicators.length).toBe(1)
    // The surviving row belongs to the placeholder, while the real running
    // bubble's stall row stays silent.
    expect(document.querySelectorAll('[data-slot="aui_response-loading"]').length).toBe(1)
    expect(document.querySelectorAll('[data-slot="aui_turn-activity"]').length).toBe(0)
  })

  // Outside a provider wait, the placeholder uses the plain loading label and the
  // real bubble's stall row must remain silent after the stall threshold.
  it('keeps a single status row for the placeholder outside a provider wait (isRunning:true)', () => {
    setSessionProviderWait(sessionId, '')

    render(
      <Harness
        isRunning
        messages={[
          userMessage('user-1', 'Summarize this thread for me'),
          runningAssistantMessage('assistant-1', 'Working on it'),
          userMessage('user-2', 'hola?')
        ]}
      />
    )

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(document.querySelectorAll('[data-slot="aui_response-loading"]').length).toBe(1)
    expect(document.querySelectorAll('[data-slot="aui_turn-activity"]').length).toBe(0)
  })

  it('shows manual and automatic compression once after all records, and restores activity when it ends', async () => {
    const idleMessages = [userMessage(), assistantMessage(), systemMessage('notice', 'Session notice')]
    const { container, rerender } = render(<Harness messages={idleMessages} />)
    const label = 'Compacting context…'

    act(() => setSessionCompacting(sessionId, true))
    const status = screen.getByRole('status', { name: label })
    const content = container.querySelector('[data-slot="aui_thread-content"]')!
    expect(content.lastElementChild).toBe(status)
    expect(status.closest('[data-slot="aui_assistant-message-root"]')).toBeNull()

    // Auto-compaction before the first token must not duplicate the placeholder.
    const activeMessages = [...idleMessages, userMessage('next-user', 'Continue')]
    await act(async () => rerender(<Harness isRunning messages={activeMessages} />))
    expect(screen.getAllByRole('status', { name: label })).toHaveLength(1)
    expect(container.querySelector('[data-slot="aui_response-loading"]')).toBeNull()

    // Nor may a populated assistant row add a second activity line.
    await act(async () =>
      rerender(<Harness isRunning messages={[...activeMessages, runningAssistantMessage('live', 'Working')]} />)
    )
    expect(screen.getAllByRole('status', { name: label })).toHaveLength(1)
    expect(container.querySelector('[data-slot="aui_turn-activity"]')).toBeNull()

    act(() => setSessionCompacting(sessionId, false))
    expect(screen.queryByRole('status', { name: label })).toBeNull()
    expect(screen.getByRole('status', { name: 'Waiting for provider' })).toBeTruthy()
  })

  it('keeps compression attached to its session and out of historical pages', () => {
    const messages = [userMessage(), assistantMessage()]
    act(() => setSessionCompacting('background-session', true))
    const { rerender } = render(<Harness messages={messages} />)
    expect(screen.queryByRole('status', { name: 'Compacting context…' })).toBeNull()

    act(() => setSessionCompacting(sessionId, true))
    expect(screen.getByRole('status', { name: 'Compacting context…' })).toBeTruthy()
    rerender(
      <TranscriptWindowProvider value={{ isHistorical: true, olderAvailable: false, expandWindow: () => {} }}>
        <Harness messages={messages} />
      </TranscriptWindowProvider>
    )
    expect(screen.queryByRole('status', { name: 'Compacting context…' })).toBeNull()
    expect($compactingSessions.get()['background-session']).toBe(true)
  })
})

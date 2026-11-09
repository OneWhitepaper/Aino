import type { ThreadMessage } from '@assistant-ui/react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetElapsedTimerRegistryForTests } from '@/components/chat/activity-timer'
import { setSessionCompacting } from '@/store/compaction'
import { clearAllPrompts, clearApprovalRequest, setApprovalRequest } from '@/store/prompts'
import { $activeSessionId, $busy, $messages, $turnStartedAt } from '@/store/session'

import { stubThreadEnvironment, ThreadRuntime, userMessage } from '../test-utils'

import { Thread } from '.'

stubThreadEnvironment()

const sessionId = 'status-stability-boundaries'
const createdAt = new Date('2026-05-01T00:00:00.000Z')

function messages(id: string): ThreadMessage[] {
  return [
    userMessage(`u-${id}`, 'Continue the task'),
    {
      id: `a-${id}`,
      role: 'assistant',
      content: [{ type: 'text', text: 'Working on the task.' }],
      status: { type: 'running' },
      createdAt,
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} }
    } as ThreadMessage
  ]
}

function Harness({ id = sessionId }: { id?: string }) {
  return (
    <ThreadRuntime messages={messages(id)}>
      <Thread sessionId={id} sessionKey={id} />
    </ThreadRuntime>
  )
}

describe('stable thinking status yields to turn boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    vi.spyOn(globalThis.document, 'hasFocus').mockReturnValue(true)
    __resetElapsedTimerRegistryForTests()
    $activeSessionId.set(sessionId)
    $messages.set([])
    $turnStartedAt.set(Date.now())
    $busy.set(true)
  })

  afterEach(() => {
    cleanup()
    clearAllPrompts()
    setSessionCompacting(sessionId, false)
    $activeSessionId.set(null)
    $turnStartedAt.set(null)
    $busy.set(false)
    __resetElapsedTimerRegistryForTests()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('resets a visible wait for compaction, then gives a fresh quiet interval', () => {
    const { container } = render(<Harness />)
    act(() => vi.advanceTimersByTime(2_100))
    const row = container.querySelector<HTMLElement>('[data-slot="aui_turn-activity"]')
    expect(row?.dataset.state).toBe('active')

    act(() => setSessionCompacting(sessionId, true))
    act(() => vi.advanceTimersByTime(3_000))
    expect(row?.dataset.state).toBe('idle')
    expect(row?.textContent).toBe('')

    act(() => setSessionCompacting(sessionId, false))
    act(() => vi.advanceTimersByTime(1_999))
    expect(row?.dataset.state).toBe('idle')
    act(() => vi.advanceTimersByTime(1))
    expect(row?.dataset.state).toBe('active')
  })

  it('yields to approval and preserves immediate feedback when the user hands work back', () => {
    const { container } = render(<Harness />)
    act(() => vi.advanceTimersByTime(2_100))
    const row = container.querySelector<HTMLElement>('[data-slot="aui_turn-activity"]')
    expect(row?.dataset.state).toBe('active')

    act(() => setApprovalRequest({
      sessionId,
      requestId: 'approval-boundary',
      command: 'echo example',
      description: 'Run the example command'
    }))
    act(() => vi.advanceTimersByTime(3_000))
    expect(row?.dataset.state).toBe('idle')

    act(() => clearApprovalRequest(sessionId, 'approval-boundary'))
    expect(row?.dataset.state).toBe('active')

    act(() => {
      $busy.set(false)
      $turnStartedAt.set(null)
    })
    expect(row?.dataset.state).toBe('idle')
    act(() => {
      $turnStartedAt.set(Date.now())
      $busy.set(true)
    })
    expect(row?.dataset.state).toBe('active')
  })

  it('does not carry an active wait into another session transcript', async () => {
    const { container, rerender } = render(<Harness />)
    act(() => vi.advanceTimersByTime(2_100))
    const row = container.querySelector<HTMLElement>('[data-slot="aui_turn-activity"]')
    expect(row?.dataset.state).toBe('active')

    await act(async () => {
      $activeSessionId.set('other-session')
      $turnStartedAt.set(Date.now())
      rerender(<Harness id="other-session" />)
    })
    expect(container.querySelector('[data-slot="aui_turn-activity"][data-state="active"]')).toBeNull()
    act(() => vi.advanceTimersByTime(1_999))
    expect(container.querySelector('[data-slot="aui_turn-activity"][data-state="active"]')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(container.querySelector('[data-slot="aui_turn-activity"][data-state="active"]')).not.toBeNull()
  })
})

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ContextBreakdown, UsageStats } from '@/types/hermes'

import { ContextUsagePanel } from './context-usage-panel'
import { useContextBreakdown } from './hooks/use-context-breakdown'

const usage: UsageStats = {
  calls: 1,
  context_max: 272_000,
  context_percent: 47,
  context_used: 128_200,
  input: 0,
  output: 0,
  total: 0
}

const breakdown: ContextBreakdown = {
  categories: [{ color: 'teal', id: 'conversation', label: 'Conversation', tokens: 241_400 }],
  context_max: 272_000,
  context_percent: 89,
  context_used: 241_400,
  estimated_total: 286_600,
  model: 'test-model'
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useContextBreakdown', () => {
  const initializing: ContextBreakdown = {
    categories: [],
    context_max: 0,
    context_percent: 0,
    context_used: 0,
    estimated_total: 0
  }

  it('retries an uninitialized context window without presenting it as real zero usage', async () => {
    vi.useFakeTimers()
    const ready = { ...breakdown, context_percent: 0, context_used: 0 }
    const requestGateway = vi.fn().mockResolvedValueOnce(initializing).mockResolvedValue(ready)

    const { result } = renderHook(() =>
      useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId: 'restoring-runtime' })
    )

    await act(async () => undefined)
    expect(result.current.breakdown).toBeNull()
    expect(result.current.loading).toBe(true)
    await act(() => vi.runAllTimersAsync())

    expect(result.current.breakdown).toEqual(ready)
    expect(result.current.loading).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds initialization retries, cancels them when hidden and allows an explicit retry', async () => {
    vi.useFakeTimers()
    const requestGateway = vi.fn().mockResolvedValue(initializing)

    const { rerender, result } = renderHook(
      ({ enabled }) => useContextBreakdown({ busy: false, enabled, requestGateway, sessionId: 'runtime' }),
      { initialProps: { enabled: true } }
    )

    await act(async () => undefined)
    rerender({ enabled: false })
    await act(() => vi.runAllTimersAsync())
    expect(requestGateway).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)

    rerender({ enabled: true })
    await act(() => vi.runAllTimersAsync())
    expect(result.current.breakdown).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(requestGateway.mock.calls.length).toBeLessThanOrEqual(5)
    expect(vi.getTimerCount()).toBe(0)

    requestGateway.mockResolvedValue(breakdown)
    await act(() => result.current.refetch())
    expect(result.current.breakdown).toEqual(breakdown)
    expect(result.current.loading).toBe(false)
  })

  it('fetches for a session that has not run a turn yet', async () => {
    const requestGateway = vi.fn().mockResolvedValue(breakdown)

    const { result } = renderHook(() =>
      useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId: 'runtime-1' })
    )

    await waitFor(() => expect(result.current.breakdown).toEqual(breakdown))
    expect(requestGateway).toHaveBeenCalledWith('session.context_breakdown', { session_id: 'runtime-1' })
  })

  it('does not fetch while the gauge is hidden, and fetches once it is shown', async () => {
    const requestGateway = vi.fn().mockResolvedValue(breakdown)

    const { rerender } = renderHook(
      ({ enabled }) => useContextBreakdown({ busy: false, enabled, requestGateway, sessionId: 'runtime-1' }),
      { initialProps: { enabled: false } }
    )

    expect(requestGateway).not.toHaveBeenCalled()

    rerender({ enabled: true })

    await waitFor(() => expect(requestGateway).toHaveBeenCalledTimes(1))
  })

  it('skips the estimate mid-turn — the gateway streams measured usage then', () => {
    const requestGateway = vi.fn().mockResolvedValue(breakdown)

    renderHook(() => useContextBreakdown({ busy: true, enabled: true, requestGateway, sessionId: 'runtime-1' }))

    expect(requestGateway).not.toHaveBeenCalled()
  })

  it('refetches on a session switch and never reports the previous session numbers', async () => {
    const requestGateway = vi.fn().mockResolvedValue(breakdown)

    const { rerender, result } = renderHook(
      ({ sessionId }) => useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId }),
      { initialProps: { sessionId: 'runtime-1' } }
    )

    await waitFor(() => expect(result.current.breakdown).toEqual(breakdown))

    // Switching sessions must drop the numbers immediately — painting them
    // under the new session's name would be a lie until its own fetch lands.
    requestGateway.mockImplementation(() => new Promise(() => undefined))
    rerender({ sessionId: 'runtime-2' })

    expect(result.current.breakdown).toBeNull()
    expect(requestGateway).toHaveBeenLastCalledWith('session.context_breakdown', { session_id: 'runtime-2' })
  })
})

describe('ContextUsagePanel', () => {
  it('marks estimates but preserves the provider-usage header', () => {
    for (const estimated of [true, false]) {
      const { container, unmount } = render(
        <ContextUsagePanel breakdown={breakdown} loading={false} usage={{ ...usage, context_estimated: estimated }} />
      )

      const header = container.querySelector('[data-slot="context-usage-panel"] > div')?.textContent ?? ''

      expect(header.includes('~')).toBe(estimated)
      expect(container.querySelector('li')?.textContent).toContain('~')
      unmount()
    }
  })

  it('renders the usage it is handed, so the popover matches the bar', () => {
    render(<ContextUsagePanel breakdown={breakdown} loading={false} usage={usage} />)

    expect(screen.getByText('47% Full')).toBeTruthy()
    expect(screen.getByText('Conversation')).toBeTruthy()
  })

  it('can omit its own title when embedded under a section heading', () => {
    render(<ContextUsagePanel breakdown={breakdown} loading={false} showTitle={false} usage={usage} />)

    expect(screen.queryByText('Context Usage')).toBeNull()
    expect(screen.getByText('47% Full')).toBeTruthy()
  })

  it('does not present missing occupancy as zero usage', () => {
    render(<ContextUsagePanel breakdown={null} loading={false} usage={{ calls: 0, input: 0, output: 0, total: 0 }} />)

    expect(screen.queryByText('0 / 0')).toBeNull()
    expect(screen.queryByText('0% Full')).toBeNull()
  })

  it('says so when there is no breakdown rather than painting an empty bar', () => {
    render(<ContextUsagePanel breakdown={null} loading={false} usage={usage} />)

    expect(screen.getByText('No context data yet')).toBeTruthy()
  })
})

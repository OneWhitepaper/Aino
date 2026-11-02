import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deferred } from '@/test/deferred'
import type { ContextBreakdown } from '@/types/hermes'

import { invalidateContextBreakdown, useContextBreakdown } from './use-context-breakdown'

const BREAKDOWN: ContextBreakdown = {
  categories: [{ color: 'teal', id: 'conversation', label: 'Conversation', tokens: 20_000 }],
  context_max: 100_000,
  context_percent: 20,
  context_used: 20_000,
  estimated_total: 20_000
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('context breakdown latency and request ownership', () => {
  it('keeps same-session categories visible and throttles usage-driven reads during a turn', async () => {
    const fresh = deferred<ContextBreakdown>()
    const requestGateway = vi.fn().mockResolvedValueOnce(BREAKDOWN).mockReturnValueOnce(fresh.promise)

    const { result, rerender } = renderHook(
      ({ busy, used }) =>
        useContextBreakdown({
          busy,
          enabled: true,
          identityKey: 'same-model',
          requestGateway,
          refreshKey: String(used),
          sessionId: 'live-categories'
        }),
      { initialProps: { busy: false, used: 20_000 } }
    )

    await act(async () => undefined)
    rerender({ busy: true, used: 20_000 })
    expect(result.current.breakdown?.categories).toEqual(BREAKDOWN.categories)
    rerender({ busy: true, used: 21_000 })
    await act(() => vi.advanceTimersByTimeAsync(1_999))
    expect(requestGateway).toHaveBeenCalledTimes(1)
    rerender({ busy: true, used: 22_000 })
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(requestGateway).toHaveBeenCalledTimes(2)
    expect(result.current.breakdown?.categories).toEqual(BREAKDOWN.categories)

    const current = { ...BREAKDOWN, categories: [{ ...BREAKDOWN.categories[0], tokens: 22_000 }] }
    await act(async () => fresh.resolve(current))
    expect(result.current.breakdown?.categories[0].tokens).toBe(22_000)
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(requestGateway).toHaveBeenCalledTimes(2)
  })

  it('keeps restored categories when capacity first becomes known from a live usage event', async () => {
    const cold = { ...BREAKDOWN, context_max: 0 }
    const fresh = deferred<ContextBreakdown>()
    const requestGateway = vi.fn().mockResolvedValueOnce(cold).mockReturnValueOnce(fresh.promise)

    const { result, rerender } = renderHook(
      ({ busy, capacity }) =>
        useContextBreakdown({
          busy,
          enabled: true,
          identityKey: 'same-model',
          requestGateway,
          refreshKey: String(capacity),
          sessionId: 'restored-capacity'
        }),
      { initialProps: { busy: false, capacity: 0 } }
    )

    await act(async () => undefined)
    expect(result.current.breakdown?.categories).toEqual(cold.categories)
    rerender({ busy: true, capacity: 100_000 })
    expect(result.current.breakdown?.categories).toEqual(cold.categories)
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(requestGateway).toHaveBeenCalledTimes(2)
    await act(async () => fresh.resolve(BREAKDOWN))
    expect(result.current.breakdown?.context_max).toBe(100_000)
  })

  it.each(['owner', 'session', 'model'])('isolates late category responses after a %s switch', async change => {
    const old = deferred<ContextBreakdown>()
    const fresh = deferred<ContextBreakdown>()
    const owner = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const replacement = vi.fn().mockReturnValueOnce(fresh.promise)
    const initial = { requestGateway: owner, sessionId: 'before', identityKey: 'before-model' }

    const { result, rerender } = renderHook(props => useContextBreakdown({ busy: true, enabled: true, ...props }), {
      initialProps: initial
    })

    rerender({
      requestGateway: change === 'owner' ? replacement : owner,
      sessionId: change === 'session' ? 'after' : 'before',
      identityKey: change === 'model' ? 'after-model' : 'before-model'
    })
    expect(result.current.breakdown).toBeNull()
    await act(async () => fresh.resolve(BREAKDOWN))
    await act(async () => old.resolve({ ...BREAKDOWN, categories: [{ ...BREAKDOWN.categories[0], tokens: 99_000 }] }))
    expect(result.current.breakdown?.categories[0].tokens).toBe(20_000)
  })

  it('invalidates pending work only for the conversation that starts a turn', async () => {
    const pending = deferred<ContextBreakdown>()
    const requestGateway = vi.fn().mockImplementation(() => pending.promise)

    const one = renderHook(
      ({ busy }) => useContextBreakdown({ busy, enabled: true, requestGateway, sessionId: 'turning-session' }),
      { initialProps: { busy: false } }
    )

    renderHook(() => useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId: 'idle-session' }))
    one.rerender({ busy: true })
    one.rerender({ busy: false })
    renderHook(() => useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId: 'idle-session' }))
    expect(requestGateway).toHaveBeenCalledTimes(3)
    await act(async () => pending.resolve(BREAKDOWN))
  })

  it.each(['model change', 'compression', 'explicit refresh'])(
    'does not reuse pre-change work after %s',
    async change => {
      const old = deferred<ContextBreakdown>()
      const fresh = deferred<ContextBreakdown>()
      const requestGateway = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)

      const { result, rerender } = renderHook(
        ({ refreshKey }) =>
          useContextBreakdown({
            busy: false,
            enabled: true,
            requestGateway,
            refreshKey,
            sessionId: 'changed-' + change
          }),
        { initialProps: { refreshKey: 'first-model' } }
      )

      act(() => {
        if (change === 'model change') {
          rerender({ refreshKey: 'new-model' })
        } else if (change === 'compression') {
          invalidateContextBreakdown('changed-' + change)
        } else {
          result.current.refetch()
        }
      })
      expect(requestGateway).toHaveBeenCalledTimes(2)
      await act(async () => fresh.resolve(BREAKDOWN))
      await act(async () => old.resolve({ ...BREAKDOWN, context_used: 90_000 }))
      expect(result.current.breakdown?.context_used).toBe(20_000)
    }
  )

  it('leaves loading after a read has not answered for five seconds without queuing automatic retries', async () => {
    const pending = deferred<ContextBreakdown>()
    const requestGateway = vi.fn().mockImplementation(() => pending.promise)

    const { result } = renderHook(() =>
      useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId: 'hung-session' })
    )

    expect(result.current.loading).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(4_999))
    expect(result.current.loading).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(1))

    expect(result.current.loading).toBe(false)
    expect(result.current.breakdown).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(requestGateway).toHaveBeenCalledTimes(1)
  })

  it('ignores a timed-out response after an explicit retry has recovered newer context', async () => {
    const timedOut = deferred<ContextBreakdown>()
    const recovery = deferred<ContextBreakdown>()
    const requestGateway = vi.fn().mockReturnValueOnce(timedOut.promise).mockReturnValueOnce(recovery.promise)

    const { result } = renderHook(() =>
      useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId: 'recovering-session' })
    )

    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(result.current.loading).toBe(false)
    act(() => result.current.refetch())
    expect(result.current.loading).toBe(true)
    await act(async () => recovery.resolve(BREAKDOWN))
    expect(result.current.breakdown?.context_used).toBe(20_000)
    expect(result.current.loading).toBe(false)

    await act(async () => timedOut.resolve({ ...BREAKDOWN, context_percent: 90, context_used: 90_000 }))
    expect(result.current.breakdown?.context_used).toBe(20_000)
    expect(requestGateway).toHaveBeenCalledTimes(2)
  })

  it('shares concurrent reads only for the same request owner and session', async () => {
    const first = deferred<ContextBreakdown>()
    const otherSession = deferred<ContextBreakdown>()
    const otherOwner = deferred<ContextBreakdown>()

    const requestGateway = vi
      .fn()
      .mockImplementation((_method: string, params?: Record<string, unknown>) =>
        params?.session_id === 'shared-session' ? first.promise : otherSession.promise
      )

    const requestOtherOwner = vi.fn().mockImplementation(() => otherOwner.promise)

    const one = renderHook(() =>
      useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId: 'shared-session' })
    )

    const two = renderHook(() =>
      useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId: 'shared-session' })
    )

    const separateSession = renderHook(() =>
      useContextBreakdown({ busy: false, enabled: true, requestGateway, sessionId: 'separate-session' })
    )

    const separateOwner = renderHook(() =>
      useContextBreakdown({
        busy: false,
        enabled: true,
        requestGateway: requestOtherOwner,
        sessionId: 'shared-session'
      })
    )

    expect(requestGateway).toHaveBeenCalledTimes(2)
    expect(requestOtherOwner).toHaveBeenCalledTimes(1)
    await act(async () => first.resolve(BREAKDOWN))
    expect(one.result.current.breakdown?.context_used).toBe(20_000)
    expect(two.result.current.breakdown?.context_used).toBe(20_000)
    expect(separateSession.result.current.breakdown).toBeNull()
    expect(separateOwner.result.current.breakdown).toBeNull()

    await act(async () => {
      otherSession.resolve({ ...BREAKDOWN, context_used: 40_000 })
      otherOwner.resolve({ ...BREAKDOWN, context_used: 60_000 })
    })
    expect(separateSession.result.current.breakdown?.context_used).toBe(40_000)
    expect(separateOwner.result.current.breakdown?.context_used).toBe(60_000)
  })
})

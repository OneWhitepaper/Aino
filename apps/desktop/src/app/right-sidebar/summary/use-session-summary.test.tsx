import type { SessionSummaryResult as SessionSummaryResponse, SessionSemanticSummary as SessionSummarySnapshot } from '@hermes/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HermesApiRequest } from '@/global'

import { useSessionSummary } from './use-session-summary'
import type { SummarySession } from './use-summary-session'

const session: SummarySession = {
  busy: false,
  cwd: '/work',
  owner: { connectionId: 'local', profile: 'default' },
  runtimeId: null,
  scope: { connectionId: 'local', profile: 'default' },
  sourceKey: 'local',
  storedId: 'conversation',
  target: 'main'
}

const history = { historyReady: true, historyUpdatedAt: 1, refreshing: false }

const snapshot = (revision: string, text = 'Verified result'): SessionSummarySnapshot => ({
  objective: { text, message_ids: [10] },
  completed: [{ text: 'A completed item', message_ids: [11] }],
  conclusions: [],
  open_questions: [],
  updated_at: 1_700_000_000,
  source_revision: revision,
  source_message_count: 5
})

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('useSessionSummary', () => {
  it('generates only eligible idle revisions and reuses the same revision across transcript refreshes', async () => {
    let revision = 'r1'
    let eligible = true

    const api = vi.fn(async (request: HermesApiRequest): Promise<SessionSummaryResponse> => ({
      summary: request.method === 'POST' ? snapshot(revision) : null,
      eligible,
      stale: request.method !== 'POST',
      source_revision: revision, busy: false
    }))

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }

    const { result, rerender } = renderHook(
      ({ busy, epoch }) => useSessionSummary({ ...session, busy }, { ...history, historyUpdatedAt: epoch }, 'zh'),
      { wrapper: wrapper(), initialProps: { busy: true, epoch: 1 } }
    )

    await act(async () => {})
    expect(api).not.toHaveBeenCalled()
    rerender({ busy: false, epoch: 1 })
    await waitFor(() => expect(result.current.summary?.source_revision).toBe('r1'))
    expect(api.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1)
    expect(api).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'local',
        profile: 'default',
        method: 'POST',
        body: { profile: 'default', language: 'zh', retry: false }
      })
    )

    rerender({ busy: false, epoch: 2 })
    await waitFor(() => expect(api.mock.calls.filter(([request]) => !request.method)).toHaveLength(2))
    expect(api.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1)
    revision = 'r2'
    rerender({ busy: false, epoch: 3 })
    await waitFor(() => expect(result.current.summary?.source_revision).toBe('r2'))
    expect(api.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(2)

    eligible = false
    revision = 'short-greeting'
    rerender({ busy: false, epoch: 4 })
    await waitFor(() => expect(result.current.eligible).toBe(false))
    expect(result.current.summary).toBeNull()
    expect(api.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(2)
  })

  it('isolates late generation by owner and keeps an explicitly stale snapshot when an update fails', async () => {
    let fails = true
    let failedRevision = false
    let finishOld!: (value: SessionSummaryResponse) => void

    const pending = new Promise<SessionSummaryResponse>(resolve => {
      finishOld = resolve
    })

    const api = vi.fn((request: HermesApiRequest): Promise<SessionSummaryResponse> => {
      if (request.connectionId === 'local') {
        return request.method === 'POST'
          ? pending
          : Promise.resolve({ summary: null, eligible: true, stale: true, busy: false, source_revision: 'same-revision' })
      }

      if (request.method === 'POST') {
        failedRevision = fails
      }

      return Promise.resolve({
        summary: snapshot(fails ? 'previous' : 'same-revision', 'Remote result'),
        eligible: true,
        stale: fails || failedRevision,
        source_revision: 'same-revision', busy: false,
        ...(failedRevision ? { error: 'Generation failed' } : {})
      })
    })

    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = { api }

    const { result, rerender } = renderHook(({ current }) => useSessionSummary(current, history, 'zh'), {
      wrapper: wrapper(),
      initialProps: { current: session }
    })

    await waitFor(() => expect(api.mock.calls.some(([request]) => request.method === 'POST')).toBe(true))
    const scope = { connectionId: 'remote', profile: 'work' }
    rerender({ current: { ...session, scope, owner: scope } })
    await waitFor(() => expect(result.current.summary?.objective?.text).toBe('Remote result'))
    await waitFor(() => expect(result.current.error).toBe('Generation failed'))
    await act(async () =>
      finishOld({
        summary: snapshot('same-revision', 'Wrong local result'),
        eligible: true,
        stale: false,
        source_revision: 'same-revision', busy: false
      })
    )
    expect(result.current.summary?.objective?.text).toBe('Remote result')
    expect(result.current.stale).toBe(true)
    expect(api).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectionId: 'remote',
        profile: 'work',
        body: { profile: 'work', language: 'zh', retry: false }
      })
    )

    fails = false
    await act(async () => { await result.current.refresh() })
    await waitFor(() => expect(result.current.error).toBeFalsy())
    expect(result.current.stale).toBe(false)
    expect(api).toHaveBeenLastCalledWith(expect.objectContaining({
      connectionId: 'remote', method: 'POST', body: { profile: 'work', language: 'zh', retry: true }
    }))
  })
})

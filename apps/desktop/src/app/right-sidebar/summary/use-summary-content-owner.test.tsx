import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getAllSessionMessages } from '@/api/sessions'
import { $connectionsRegistry } from '@/store/connection-registry-state'
import { $profiles } from '@/store/profile'
import type { SessionMessagesResponse } from '@/types/hermes'

import { useSummaryContent } from './use-summary-content'
import type { SummarySession } from './use-summary-session'

vi.mock('@/api/sessions', () => ({ getAllSessionMessages: vi.fn() }))

const clients: QueryClient[] = []

const session: SummarySession = {
  busy: false,
  cwd: '',
  owner: { connectionId: 'remote-source', profile: 'desktop-alias', targetProfile: 'server-profile' },
  runtimeId: 'runtime-parent',
  scope: { connectionId: 'remote-source', profile: 'desktop-alias' },
  storedId: 'stored-parent',
  sourceKey: 'remote-source-desktop-alias',
  target: 'main'
}

function history(goal: string): SessionMessagesResponse {
  return {
    session_id: 'stored-parent',
    messages: [
      {
        role: 'tool',
        tool_call_id: 'dispatch',
        tool_name: 'delegate_task',
        args: { tasks: [{ goal }] },
        content: JSON.stringify({ status: 'dispatched', subagent_ids: ['worker'] })
      }
    ]
  }
}

function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const created = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(created)

    return created
  })

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.mocked(getAllSessionMessages).mockReset().mockResolvedValue(history('Original source task'))
  $connectionsRegistry.set(null)
  $profiles.set([])
})

afterEach(() => {
  cleanup()

  for (const client of clients.splice(0)) {
    client.clear()
  }

  $connectionsRegistry.set(null)
  $profiles.set([])
})

it('reads the owner target profile instead of the desktop route alias', async () => {
  const { result } = renderHook(() => useSummaryContent(session), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.historyReady).toBe(true))
  expect(getAllSessionMessages).toHaveBeenCalledWith('stored-parent', {
    connectionId: 'remote-source',
    profile: 'server-profile'
  })
})

it('drops the old placeholder and starts a distinct read when only the owner target changes', async () => {
  let settleNew!: (response: SessionMessagesResponse) => void

  const { result, rerender } = renderHook(current => useSummaryContent(current), {
    initialProps: session,
    wrapper: Wrapper
  })

  await waitFor(() => expect(result.current.delegations[0]?.rows[0]?.goal).toBe('Original source task'))
  vi.mocked(getAllSessionMessages).mockReturnValueOnce(new Promise(resolve => (settleNew = resolve)))
  rerender({
    ...session,
    owner: { connectionId: 'remote-source', profile: 'desktop-alias', targetProfile: 'second-profile' }
  })
  expect(result.current.delegations).toEqual([])
  await waitFor(() =>
    expect(getAllSessionMessages).toHaveBeenLastCalledWith('stored-parent', {
      connectionId: 'remote-source',
      profile: 'second-profile'
    })
  )
  await act(async () => settleNew(history('Second source task')))
  await waitFor(() => expect(result.current.delegations[0]?.rows[0]?.goal).toBe('Second source task'))
})

it('retains the single legacy gateway scope when no owner has been recorded', async () => {
  const { result } = renderHook(() => useSummaryContent({ ...session, owner: null }), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.historyReady).toBe(true))
  expect(getAllSessionMessages).toHaveBeenCalledWith('stored-parent', session.scope)
})

it('still rejects unresolved owners in modern registry topology before requesting any history', async () => {
  $connectionsRegistry.set({ connections: [], primary: null, lastUsed: null, launchMode: 'primary' } as never)
  const { result } = renderHook(() => useSummaryContent({ ...session, owner: null }), { wrapper: Wrapper })
  await waitFor(() => expect(result.current.error).toBeTruthy())
  expect(getAllSessionMessages).not.toHaveBeenCalled()
})

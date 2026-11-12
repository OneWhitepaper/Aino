import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { ProjectedCollaborationTasks } from '@/app/agents/collaboration-task-test-helper'
import * as gateway from '@/store/gateway'
import { _resetSessionOwnerHintsForTests, setSessionOwnerHint } from '@/store/session'
import { $subagentsBySession, upsertSubagent } from '@/store/subagents'

import { useSubagentSnapshot } from './use-subagent-snapshot'

import { ComposerStatusStack } from './index'

function RecoveredTasks({ sessionId }: { sessionId: string }) {
  useSubagentSnapshot(sessionId, false)

  return <ProjectedCollaborationTasks sessionId={sessionId} />
}

vi.stubGlobal(
  'ResizeObserver',
  class {
    disconnect() {}
    observe() {}
    unobserve() {}
  }
)
Element.prototype.animate = vi.fn(() => ({ cancel() {} }) as Animation)
afterEach(() => {
  cleanup()
  $subagentsBySession.set({})
  _resetSessionOwnerHintsForTests()
  vi.restoreAllMocks()
})

it('hydrates an empty owner and exposes its transcript through the capsule without leaking on session change', async () => {
  const text = '  Full transcript\tline with preserved whitespace  \n\n'.repeat(100)

  const request = vi.spyOn(gateway, 'requestGatewayForAgent').mockImplementation(async (_c, _p, method) => {
    if (method === 'subagent.list') {
      return {
        subagents: [
          { subagent_id: 'worker', goal: 'Recovered work', started_at: 1000, status: 'running', last_tool: 'read_file' }
        ],
        delegations: []
      } as never
    }

    if (method === 'subagent.tail') {
      return { subagent_id: 'worker', available: true, text, truncated: true } as never
    }

    return {} as never
  })

  setSessionOwnerHint('parent', { connectionId: 'remote-owner', profile: 'research' })

  const view = render(
    <MemoryRouter>
      <RecoveredTasks sessionId="parent" />
    </MemoryRouter>
  )

  const worker = await screen.findByRole('button', { name: /Recovered work/ })
  expect(worker.textContent).toContain('Read File')
  expect(request).toHaveBeenCalledWith('remote-owner', 'research', 'subagent.list', { session_id: 'parent' })
  expect($subagentsBySession.get().parent[0].startedAt).toBe(1000000)
  fireEvent.click(worker)
  fireEvent.click(screen.getByText('Extended transcript'))
  await waitFor(() =>
    expect(view.container.querySelector('[data-slot="subagent-transcript"]')?.textContent).toContain(text)
  )
  expect(request).toHaveBeenCalledWith('remote-owner', 'research', 'subagent.tail', {
    session_id: 'parent',
    subagent_id: 'worker'
  })
  view.rerender(
    <MemoryRouter>
      <RecoveredTasks sessionId="other" />
    </MemoryRouter>
  )
  expect(view.container.querySelector('[data-slot="subagent-transcript"]')).toBeNull()
})

it('does not resurrect a child completed while the roster snapshot was in flight', async () => {
  let resolve!: (value: unknown) => void
  vi.spyOn(gateway, 'requestGatewayForAgent').mockImplementation(async (_c, _p, method) => {
    if (method === 'subagent.list') {
      return (await new Promise<unknown>(r => {
        resolve = r
      })) as never
    }

    return {} as never
  })
  setSessionOwnerHint('parent', { connectionId: 'remote-owner', profile: 'research' })
  upsertSubagent('parent', { subagent_id: 'worker', goal: 'Finishing work' })
  render(
    <MemoryRouter>
      <ComposerStatusStack queue={null} sessionId="parent" />
    </MemoryRouter>
  )
  await waitFor(() => expect(resolve).toBeTypeOf('function'))
  act(() => upsertSubagent('parent', { subagent_id: 'worker', status: 'completed' }, false, 'subagent.complete'))
  await act(async () =>
    resolve({ subagents: [{ subagent_id: 'worker', goal: 'Finishing work', status: 'running' }], delegations: [] })
  )
  expect(screen.queryByText('Finishing work')).toBeNull()
  expect($subagentsBySession.get().parent[0].status).toBe('completed')
})

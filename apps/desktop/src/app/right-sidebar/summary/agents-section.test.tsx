import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $subagentsBySession, upsertSubagent } from '@/store/subagents'

import { AgentsSection } from './agents-section'
import type { SummaryDelegation } from './session-activity'
import type { SummarySession } from './use-summary-session'

const { openPanel } = vi.hoisted(() => ({ openPanel: vi.fn() }))

vi.mock('@/app/agents/subagent-panel', () => ({ openSubagentPanel: openPanel }))

const session: SummarySession = {
  runtimeId: 'parent-runtime',
  storedId: 'parent-stored',
  owner: { connectionId: 'remote-one', profile: 'work' },
  scope: { connectionId: 'remote-one', profile: 'work' },
  sourceKey: 'remote-work',
  target: 'tile:parent-stored',
  busy: false,
  cwd: '/work'
}

function renderAgents(history: SummaryDelegation[] = []) {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <AgentsSection history={history} session={session} />
    </I18nProvider>
  )
}

afterEach(() => {
  cleanup()
  $subagentsBySession.set({})
  vi.clearAllMocks()
})

it('summarizes finished agents in one portrait row that opens the owning panel', () => {
  const { container } = renderAgents([
    {
      id: 'completed-call',
      rows: Array.from({ length: 6 }, (_, index) => ({
        id: `child-${index}`,
        displayName: `Review ${index}`,
        goal: `Full instruction ${index}`,
        status: 'completed',
        activity: []
      }))
    }
  ])

  expect(screen.getByRole('heading', { name: 'Subagents' })).toBeTruthy()
  const overview = screen.getByRole('button', { name: 'View all agents · 6 completed' })
  expect(overview.textContent).toBe('6 completed')
  expect(container.querySelectorAll('[data-slot="subagent-avatar"]')).toHaveLength(4)
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.queryByText(/Review|Full instruction/)).toBeNull()
  fireEvent.click(overview)
  expect(openPanel).toHaveBeenCalledExactlyOnceWith({
    parentRuntimeId: 'parent-runtime',
    storedSessionId: 'parent-stored',
    owner: session.owner
  })
})

it('compacts historical dispatches without claiming they completed', () => {
  renderAgents([
    {
      id: 'old-call',
      rows: [{ id: 'old-child', displayName: 'Research', goal: 'Read sources', status: 'dispatched', activity: [] }]
    }
  ])

  expect(screen.getByRole('button', { name: 'View all agents · 1 dispatched' }).textContent).toBe('1 dispatched')
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.queryByText(/completed|Research|Read sources/)).toBeNull()
})

it('shows queued and running names live, then collapses on the final terminal receipt', () => {
  upsertSubagent('parent-runtime', {
    subagent_id: 'one',
    display_name: 'Research',
    goal: 'Read sources',
    status: 'running'
  })
  upsertSubagent('parent-runtime', {
    subagent_id: 'two',
    display_name: 'Review',
    goal: 'Check sources',
    status: 'queued'
  })
  renderAgents()

  const research = screen.getByRole('button', { name: /Research\s*Running/ })
  expect(screen.getByRole('button', { name: /Review\s*Queued/ })).toBeTruthy()
  fireEvent.click(research)
  expect(openPanel).toHaveBeenCalledWith(
    expect.objectContaining({
      owner: session.owner,
      toolCallId: 'one',
      row: expect.objectContaining({ subagentId: 'one' })
    })
  )

  act(() => {
    upsertSubagent('parent-runtime', { subagent_id: 'one', status: 'completed' }, false, 'subagent.complete')
  })
  expect(screen.queryByText('Research')).toBeNull()
  expect(screen.getByRole('button', { name: /Review\s*Queued/ })).toBeTruthy()

  act(() => {
    upsertSubagent('parent-runtime', { subagent_id: 'two', status: 'failed' }, false, 'subagent.complete')
  })
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'View all agents · 1 completed · 1 failed' })).toBeTruthy()
  expect(screen.queryByText(/Research|Review/)).toBeNull()
})

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

it('keeps finished agents behind an explicit disclosure and opens their exact owning child', () => {
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
  const history = screen.getByRole('button', { name: 'Past subtasks (6)' })
  expect(history.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelectorAll('[data-slot="subagent-avatar"]')).toHaveLength(0)
  expect(screen.queryByText('Review 0')).toBeNull()
  fireEvent.click(history)
  expect(history.getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelectorAll('[data-slot="subagent-avatar"]')).toHaveLength(6)
  fireEvent.click(screen.getByRole('button', { name: /Review 5\s*Completed/ }))
  expect(openPanel).toHaveBeenCalledWith(
    expect.objectContaining({
      owner: session.owner,
      toolCallId: 'completed-call',
      row: expect.objectContaining({ id: 'child-5' })
    })
  )
  expect(screen.queryByText(/Full instruction/)).toBeNull()
  openPanel.mockClear()
  fireEvent.click(overview)
  expect(openPanel).toHaveBeenCalledExactlyOnceWith({
    parentRuntimeId: 'parent-runtime',
    storedSessionId: 'parent-stored',
    owner: session.owner
  })
  act(() =>
    upsertSubagent('parent-runtime', {
      subagent_id: 'active-child',
      display_name: 'Current research',
      goal: 'Check current sources',
      status: 'running'
    })
  )
  expect(screen.getByRole('button', { name: /Current research\s*Running/ })).toBeTruthy()
  expect(container.querySelectorAll('[data-slot="subagent-avatar"]')).toHaveLength(7)
  fireEvent.click(history)
  expect(screen.queryByText('Review 0')).toBeNull()
  expect(screen.getByText('Current research')).toBeTruthy()
})

it('keeps historical dispatches collapsed without claiming they are running or completed', () => {
  renderAgents([
    {
      id: 'old-call',
      rows: [{ id: 'old-child', displayName: 'Research', goal: 'Read sources', status: 'dispatched', activity: [] }]
    }
  ])

  expect(screen.queryByRole('button', { name: /Research\s*Dispatched/ })).toBeNull()
  const history = screen.getByRole('button', { name: 'Past subtasks (1)' })
  expect(history.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(history)
  expect(screen.getByRole('button', { name: /Research\s*Dispatched/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Research\s*(Running|Completed)/ })).toBeNull()
  expect(screen.queryByText(/completed|Read sources/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Research\s*Dispatched/ }))
  expect(openPanel).toHaveBeenCalledWith(
    expect.objectContaining({
      owner: session.owner,
      toolCallId: 'old-call',
      row: expect.objectContaining({ id: 'old-child', status: 'dispatched' })
    })
  )
})

it('updates each child status live while retaining its name and inspection action after completion', () => {
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
  expect(screen.queryByRole('button', { name: /Research\s*Completed/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Past subtasks (1)' }))
  expect(screen.getByRole('button', { name: /Research\s*Completed/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Review\s*Queued/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Past subtasks (1)' }))
  expect(screen.queryByRole('button', { name: /Research\s*Completed/ })).toBeNull()

  act(() => {
    upsertSubagent('parent-runtime', { subagent_id: 'two', status: 'failed' }, false, 'subagent.complete')
  })
  expect(screen.getByRole('button', { name: 'View all agents · 1 completed · 1 failed' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Review\s*Failed/ })).toBeTruthy()
})

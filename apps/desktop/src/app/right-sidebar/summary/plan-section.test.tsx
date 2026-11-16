import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { $workspaceMode } from '@/components/pane-shell/workspace-scope'
import { I18nProvider } from '@/i18n'
import type { TodoItem } from '@/lib/todos'
import { $todosBySession } from '@/store/todos'

import { PlanSection } from './plan-section'
import type { SummarySession } from './use-summary-session'

const session: SummarySession = {
  runtimeId: 'plan-runtime',
  storedId: 'plan-stored',
  owner: 'default',
  scope: { connectionId: 'local', profile: 'default' },
  sourceKey: 'local-default',
  target: 'main',
  busy: false,
  cwd: '/work'
}

afterEach(() => {
  cleanup()
  $todosBySession.set({})
  $workspaceMode.set('sessions')
})

it('shows a compact real checklist, expands the rest, and updates the owning live plan', () => {
  const todos: TodoItem[] = Array.from({ length: 6 }, (_, index) => ({
    id: `step-${index}`,
    content: `Step ${index + 1}`,
    status: index === 0 ? 'completed' : 'pending'
  }))

  $todosBySession.set({
    'plan-runtime': todos,
    'unrelated-runtime': [{ id: 'other', content: 'Other project', status: 'pending' }]
  })
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <PlanSection history={[]} session={session} />
    </I18nProvider>
  )

  expect(screen.queryByText('Step 1')).toBeNull()
  expect(screen.getByText('Step 5')).toBeTruthy()
  expect(screen.queryByText('Step 6')).toBeNull()
  expect(screen.queryByText('Other project')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'View all (5)' }))
  expect(screen.getByText('Step 6')).toBeTruthy()
  act(() => $todosBySession.set({ 'plan-runtime': todos.map(todo => ({ ...todo, status: 'completed' })) }))
  expect(screen.getByLabelText('6 of 6 completed')).toBeTruthy()
  expect(screen.queryByText('Step 6')).toBeNull()
  const recorded = screen.getByRole('button', { name: 'Recorded plan (6)' })
  expect(recorded.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(recorded)
  expect(screen.getByText('Step 1')).toBeTruthy()
  expect(screen.getByText('Step 6')).toBeTruthy()
  fireEvent.click(recorded)
  expect(screen.queryByText('Step 1')).toBeNull()
})

it('keeps unfinished recorded steps visible while completed history remains available on demand', () => {
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <PlanSection
        history={[
          { id: 'done', content: 'Completed research', status: 'completed' },
          { id: 'pending', parent: 'done', content: 'Review findings', status: 'pending' }
        ]}
        session={session}
      />
    </I18nProvider>
  )

  expect(screen.getByText('Review findings')).toBeTruthy()
  expect(screen.queryByText('Completed research')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Recorded plan (1)' }))
  expect(screen.getByText('Completed research')).toBeTruthy()
})

it('shows the Bot checklist in its original order and keeps completed work visible as live progress settles', () => {
  $workspaceMode.set('bots')

  const todos: TodoItem[] = Array.from({ length: 6 }, (_, index) => ({
    id: `step-${index}`,
    content: `Step ${index + 1}`,
    status: index < 2 ? 'completed' : 'pending'
  }))

  $todosBySession.set({ 'plan-runtime': todos })
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <PlanSection history={[]} session={session} />
    </I18nProvider>
  )
  const visible = screen.getAllByText(/^Step /)
  expect(visible.map(row => row.textContent)).toEqual(['Step 1', 'Step 2', 'Step 3', 'Step 4'])
  expect(screen.queryByRole('button', { name: /Recorded plan/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'View all (6)' }))
  expect(screen.getByText('Step 6')).toBeTruthy()
  act(() => $todosBySession.set({ 'plan-runtime': todos.map(todo => ({ ...todo, status: 'completed' })) }))
  expect(screen.getByLabelText('6 of 6 completed')).toBeTruthy()
  expect(screen.getByText('Step 1')).toBeTruthy()
  expect(screen.getByText('Step 6')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
  expect(screen.queryByText('Step 6')).toBeNull()
})

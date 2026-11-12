import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { ProjectedCollaborationTasks } from '@/app/agents/collaboration-task-test-helper'
import { _resetSessionOwnerHintsForTests, setSessionOwnerHint } from '@/store/session'
import { $subagentsBySession, upsertSubagent } from '@/store/subagents'

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

it('keeps each worker instruction draft across capsule detail folds and disables settled controls', () => {
  setSessionOwnerHint('parent', { connectionId: 'owner', profile: 'research' })
  upsertSubagent('parent', { subagent_id: 'a', goal: 'Worker A' })
  upsertSubagent('parent', { subagent_id: 'b', goal: 'Worker B' })
  render(
    <MemoryRouter>
      <ProjectedCollaborationTasks sessionId="parent" />
    </MemoryRouter>
  )
  fireEvent.click(screen.getByRole('button', { name: /Worker A/ }))
  const a = screen.getByRole('button', { name: /Worker A/ }).closest('article')!
  const b = screen.getByRole('button', { name: /Worker B/ }).closest('article')!
  fireEvent.click(within(a).getByRole('button', { name: 'Add instructions' }))
  fireEvent.change(within(a).getByRole('textbox'), { target: { value: 'Preserve my instruction' } })
  fireEvent.click(screen.getByRole('button', { name: /Worker B/ }))
  fireEvent.click(within(b).getByRole('button', { name: 'Add instructions' }))
  expect((within(b).getByRole('textbox') as HTMLInputElement).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: /Worker A/ }))
  expect(within(a).queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Worker A/ }))
  expect((within(a).getByRole('textbox') as HTMLInputElement).value).toBe('Preserve my instruction')
  act(() => upsertSubagent('parent', { subagent_id: 'a', status: 'completed' }, false, 'subagent.complete'))
  expect(a.querySelector('[data-state="completed"]')).toBeTruthy()
  expect(within(a).queryByRole('textbox')).toBeNull()
  expect(within(b).getByRole('textbox')).toBeTruthy()
})

it('measures detail elapsed from worker start rather than first inspection', () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(100000)
  setSessionOwnerHint('parent', { connectionId: 'owner', profile: 'research' })
  upsertSubagent('parent', { subagent_id: 'timed', goal: 'Timed worker' })
  now.mockReturnValue(117000)

  const { container } = render(
    <MemoryRouter>
      <ProjectedCollaborationTasks sessionId="parent" />
    </MemoryRouter>
  )

  fireEvent.click(screen.getByRole('button', { name: /Timed worker/ }))
  expect(container.querySelector('.cc-detail-meta')?.textContent).toBe('17s')
})

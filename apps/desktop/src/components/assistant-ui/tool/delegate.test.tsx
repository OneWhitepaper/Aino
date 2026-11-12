import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, expect, it, vi } from 'vitest'

import { openSubagentPanel } from '@/app/agents/subagent-panel'
import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '@/app/chat/session-view'
import { $subagentsBySession, pruneFinishedSessionSubagents, upsertSubagent } from '@/store/subagents'
import type * as WindowStore from '@/store/windows'
import { openSessionInNewWindow } from '@/store/windows'

import { DelegateTool } from './delegate'

vi.mock('@/app/agents/subagent-panel', () => ({ openSubagentPanel: vi.fn(), syncSubagentPanelRows: vi.fn() }))
vi.mock('@/store/windows', async importOriginal => ({
  ...(await importOriginal<typeof WindowStore>()),
  openSessionInNewWindow: vi.fn()
}))

afterEach(() => {
  cleanup()
  $subagentsBySession.set({})
  vi.clearAllMocks()
})

it('opens the exact named child in the tool panel and retains its terminal receipt across parent turns', () => {
  const view = {
    ...PRIMARY_SESSION_VIEW,
    $runtimeId: atom<string | null>('owner'),
    $storedId: atom<string | null>('stored-owner')
  }

  const args = { tasks: [{ goal: 'Review sources. Preserve the original instructions and report all findings.' }] }

  const { container, rerender } = render(
    <SessionViewProvider value={view}>
      <DelegateTool args={args} toolCallId="delegate-1" />
    </SessionViewProvider>
  )

  act(() => {
    upsertSubagent('owner', {
      subagent_id: 'worker-1',
      child_session_id: 'child-1',
      display_name: 'Source review',
      goal: args.tasks[0]!.goal,
      status: 'running',
      model: 'gpt-5'
    })
    upsertSubagent(
      'owner',
      { subagent_id: 'worker-1', text: 'Found the source entry point.' },
      false,
      'subagent.progress'
    )
  })
  rerender(
    <SessionViewProvider value={view}>
      <DelegateTool args={args} result={{ status: 'dispatched', subagent_ids: ['worker-1'] }} toolCallId="delegate-1" />
    </SessionViewProvider>
  )

  const portrait = container.querySelector('[data-slot="subagent-avatar"]')?.getAttribute('src')
  expect(portrait).toMatch(/^data:image\/svg\+xml,/)
  expect(screen.queryByText(args.tasks[0]!.goal)).toBeNull()
  const trigger = screen.getByRole('button', { name: /Source review.*Running/ })
  expect(trigger.hasAttribute('aria-expanded')).toBe(false)
  fireEvent.click(trigger)
  expect(openSubagentPanel).toHaveBeenLastCalledWith({
    parentRuntimeId: 'owner',
    storedSessionId: 'stored-owner',
    owner: undefined,
    toolCallId: 'delegate-1',
    taskId: 'worker-1',
    row: expect.objectContaining({
      goal: args.tasks[0]!.goal,
      sessionId: 'child-1',
      activity: ['Found the source entry point.']
    })
  })
  expect(container.querySelector('[data-slot="delegate-detail"]')).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(openSessionInNewWindow).not.toHaveBeenCalled()

  act(() =>
    upsertSubagent(
      'owner',
      { subagent_id: 'worker-1', status: 'completed', summary: 'Verified.', duration_seconds: 12 },
      false,
      'subagent.complete'
    )
  )
  act(() => pruneFinishedSessionSubagents('owner'))
  expect($subagentsBySession.get().owner).toEqual([])
  expect(container.querySelector('[data-slot="subagent-avatar"]')?.getAttribute('src')).toBe(portrait)
  fireEvent.click(screen.getByRole('button', { name: /Source review.*Completed/ }))
  expect(openSubagentPanel).toHaveBeenLastCalledWith(
    expect.objectContaining({
      taskId: 'worker-1',
      row: expect.objectContaining({ status: 'completed', activity: ['Found the source entry point.', 'Verified.'] })
    })
  )
})

it('opens historical dispatched, completed and failed details without claiming they are running', () => {
  const view = {
    ...PRIMARY_SESSION_VIEW,
    $runtimeId: atom<string | null>(null),
    $storedId: atom<string | null>('historical-parent')
  }

  const args = { tasks: [{ goal: 'Audit dependencies. Preserve licenses and include complete package details.' }] }

  const { rerender } = render(
    <SessionViewProvider value={view}>
      <DelegateTool
        args={args}
        result={{ status: 'dispatched', goals: [args.tasks[0]!.goal] }}
        toolCallId="delegate-2"
      />
    </SessionViewProvider>
  )

  expect(screen.queryByText('Completed')).toBeNull()
  expect(screen.queryByText('Running')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Audit dependencies.*Dispatched/ }))
  expect(openSubagentPanel).toHaveBeenLastCalledWith(
    expect.objectContaining({
      parentRuntimeId: null,
      storedSessionId: 'historical-parent',
      taskId: 'delegate-2:0',
      row: expect.objectContaining({ goal: args.tasks[0]!.goal, status: 'dispatched' })
    })
  )
  rerender(
    <SessionViewProvider value={view}>
      <DelegateTool
        args={args}
        result={{ results: [{ status: 'ok', summary: 'Confirmed two licenses.', session_id: 'saved-child' }] }}
        toolCallId="delegate-2"
      />
    </SessionViewProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: /Audit dependencies.*Completed/ }))
  expect(openSubagentPanel).toHaveBeenLastCalledWith(
    expect.objectContaining({
      row: expect.objectContaining({ activity: ['Confirmed two licenses.'], sessionId: 'saved-child' })
    })
  )
  rerender(
    <SessionViewProvider value={view}>
      <DelegateTool
        args={args}
        result={{ results: [{ status: 'error', error: 'Registry unavailable.' }] }}
        toolCallId="delegate-2"
      />
    </SessionViewProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: /Audit dependencies.*Failed/ }))
  expect(openSubagentPanel).toHaveBeenLastCalledWith(
    expect.objectContaining({
      row: expect.objectContaining({ activity: ['Registry unavailable.'] })
    })
  )
  expect(openSessionInNewWindow).not.toHaveBeenCalled()
})

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, expect, it, vi } from 'vitest'

import { PRIMARY_SESSION_VIEW, SessionViewProvider } from '@/app/chat/session-view'
import { $subagentsBySession, upsertSubagent } from '@/store/subagents'
import type * as WindowStore from '@/store/windows'
import { openSessionInNewWindow } from '@/store/windows'

import { DelegateTool } from './delegate'

vi.mock('@/store/windows', async importOriginal => ({
  ...(await importOriginal<typeof WindowStore>()),
  openSessionInNewWindow: vi.fn()
}))

afterEach(() => {
  cleanup()
  $subagentsBySession.set({})
  vi.clearAllMocks()
})

it('keeps child activity collapsed until requested and preserves access through live completion', () => {
  const view = { ...PRIMARY_SESSION_VIEW, $runtimeId: atom<string | null>('owner') }

  const { container, rerender } = render(
    <SessionViewProvider value={view}>
      <DelegateTool args={{ tasks: [{ goal: 'Review sources' }] }} toolCallId="delegate-1" />
    </SessionViewProvider>
  )

  const trigger = screen.getByRole('button', { name: /Review sources.*Running/ })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(container.querySelector('[data-slot="delegate-detail"]')).toBeNull()
  fireEvent.click(trigger)

  act(() => {
    upsertSubagent('owner', {
      subagent_id: 'worker-1',
      child_session_id: 'child-1',
      goal: 'Review sources',
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
      <DelegateTool
        args={{ tasks: [{ goal: 'Review sources' }] }}
        result={{ status: 'dispatched', subagent_ids: ['worker-1'] }}
        toolCallId="delegate-1"
      />
    </SessionViewProvider>
  )

  // Native identity arriving after dispatch must not close a disclosure the user opened.
  expect(screen.getByRole('button', { name: /Review sources.*Running/ }).getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('Found the source entry point.')).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Instructions for this subagent' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Open in new window' }))
  expect(openSessionInNewWindow).toHaveBeenCalledWith('child-1', { watch: true })

  const summary = `Verified the source. ${'Preserved detail. '.repeat(30)}Final evidence is available.`
  act(() =>
    upsertSubagent(
      'owner',
      {
        subagent_id: 'worker-1',
        status: 'completed',
        summary,
        duration_seconds: 12
      },
      false,
      'subagent.complete'
    )
  )
  expect(screen.getByRole('button', { name: /Review sources.*Completed/ })).toBeTruthy()
  expect(container.querySelector('[data-slot="delegate-detail"]')?.textContent).toContain(summary)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByRole('button', { name: 'Open in new window' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Review sources.*Completed/ }))
  expect(container.querySelector('[data-slot="delegate-detail"]')).toBeNull()
})

it('does not claim historical dispatch is complete and reveals persisted results or failures on demand', () => {
  const args = { tasks: [{ goal: 'Audit dependencies' }] }

  const { container, rerender } = render(
    <DelegateTool
      args={args}
      result={{ status: 'dispatched', goals: ['Audit dependencies'] }}
      toolCallId="delegate-2"
    />
  )

  const trigger = screen.getByRole('button', { name: /Audit dependencies.*Dispatched/ })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText('Completed')).toBeNull()
  expect(screen.queryByText('Running')).toBeNull()
  fireEvent.click(trigger)
  expect(screen.queryByRole('textbox')).toBeNull()
  rerender(
    <DelegateTool
      args={args}
      result={{ results: [{ status: 'ok', summary: 'Confirmed two licenses.' }] }}
      toolCallId="delegate-2"
    />
  )
  expect(screen.getByRole('button', { name: /Audit dependencies.*Completed/ }).getAttribute('aria-expanded')).toBe(
    'true'
  )
  expect(screen.getByText('Confirmed two licenses.')).toBeTruthy()
  rerender(
    <DelegateTool
      args={args}
      result={{ results: [{ status: 'error', error: 'Registry unavailable.' }] }}
      toolCallId="delegate-2"
    />
  )
  expect(screen.getByRole('button', { name: /Audit dependencies.*Failed/ })).toBeTruthy()
  expect(container.querySelector('[data-slot="delegate-detail"]')?.textContent).toContain('Registry unavailable.')
})

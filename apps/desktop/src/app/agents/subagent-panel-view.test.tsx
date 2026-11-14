import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { $workspaceMode, $workspaceOwnerKey } from '@/components/pane-shell/workspace-scope'
import { $subagentsBySession, upsertSubagent } from '@/store/subagents'

import type { SummaryDelegation } from '../right-sidebar/summary/session-activity'

const state = vi.hoisted(() => ({
  session: {
    runtimeId: 'parent',
    storedId: 'stored-parent',
    owner: { connectionId: 'local', profile: 'alpha' },
    scope: { connectionId: 'local', profile: 'alpha' },
    sourceKey: 'local-alpha'
  },
  history: [] as SummaryDelegation[]
}))

vi.mock('@/store/tool-session', () => ({
  $toolSession: { get: () => state.session },
  resolveToolSessionScope: (owner: { connectionId: string; profile: string }) => owner
}))
vi.mock('../right-sidebar/summary/use-summary-session', () => ({ useSummarySession: () => state.session }))
vi.mock('../right-sidebar/summary/use-summary-content', () => ({
  useSummaryContent: vi.fn(() => ({ delegations: state.history, loading: false, error: null, refetch: vi.fn() }))
}))
vi.mock('./subagent-panel-transcript', () => ({ SubagentPanelTranscript: () => null }))

import { useSummaryContent } from '../right-sidebar/summary/use-summary-content'

import { $subagentPanelSelection, subagentPanelSourceKey } from './subagent-panel'
import { SubagentPanel } from './subagent-panel-view'

afterEach(() => {
  cleanup()
  $subagentsBySession.set({})
  $subagentPanelSelection.set(null)
  $workspaceOwnerKey.set(null)
  $workspaceMode.set('sessions')
  state.history = []
})

it('lists names and portraits, then opens the exact full task and returns without replacing the conversation', () => {
  const goal = 'Read every source file carefully. Preserve this full instruction only inside task details.'
  state.history = [
    {
      id: 'call-a',
      rows: [
        {
          id: 'child-a',
          subagentId: 'child-a',
          goal,
          displayName: 'Source review',
          status: 'completed',
          activity: ['All entry points verified.']
        }
      ]
    }
  ]
  const { container, rerender } = render(<SubagentPanel />)
  expect(screen.queryByText(goal)).toBeNull()
  const avatar = container.querySelector('img')!.getAttribute('src')
  fireEvent.click(screen.getByRole('button', { name: /Source review/ }))
  expect(screen.getByText(goal)).toBeTruthy()
  expect(screen.getByText('All entry points verified.')).toBeTruthy()
  expect(container.querySelector('img')!.getAttribute('src')).toBe(avatar)
  fireEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(screen.queryByText(goal)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Source review/ }))
  state.session = { ...state.session, owner: { connectionId: 'local', profile: 'beta' }, sourceKey: 'local-beta' }
  state.history = []
  rerender(<SubagentPanel />)
  expect(screen.queryByText(goal)).toBeNull()
  expect(screen.queryByText('Source review')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  state.session = { ...state.session, owner: { connectionId: 'local', profile: 'alpha' }, sourceKey: 'local-alpha' }
})

it('keeps a selected native child live before its persisted tool receipt has loaded', () => {
  upsertSubagent('parent', {
    subagent_id: 'child-a',
    display_name: 'Research',
    goal: 'Review sources',
    status: 'running'
  })

  const row = {
    id: 'child-a',
    subagentId: 'child-a',
    displayName: 'Research',
    goal: 'Review sources',
    status: 'running' as const,
    activity: []
  }

  $subagentPanelSelection.set({
    sourceKey: subagentPanelSourceKey(state.session),
    taskId: 'child-a',
    toolCallId: 'not-yet-persisted',
    row
  })
  render(<SubagentPanel />)
  act(() =>
    upsertSubagent('parent', { subagent_id: 'child-a', text: 'Reading the latest file' }, false, 'subagent.progress')
  )
  expect(screen.getByText('Reading the latest file')).toBeTruthy()
  act(() =>
    upsertSubagent(
      'parent',
      { subagent_id: 'child-a', summary: 'Review complete', status: 'completed' },
      false,
      'subagent.complete'
    )
  )
  expect(screen.getByText('Review complete')).toBeTruthy()
})

it.each(['conversation', 'workspace'])(
  'keeps the capsule member source through Back and clears it after %s navigation',
  change => {
    const inspection = {
      runtimeId: 'member-runtime',
      storedId: 'member-history',
      owner: { connectionId: 'remote', profile: 'member' }
    }

    state.history = [
      {
        id: 'member-call',
        rows: [
          {
            id: 'capsule-child',
            subagentId: 'capsule-child',
            displayName: 'Member review',
            goal: 'Inspect member work',
            status: 'failed',
            activity: []
          }
        ]
      }
    ]
    $subagentPanelSelection.set({
      sourceKey: subagentPanelSourceKey(state.session),
      inspection,
      taskId: 'capsule-child',
      row: {
        id: 'capsule-child',
        goal: 'Inspect member work',
        status: 'failed',
        activity: [],
        sessionId: 'child-history'
      }
    })
    const { rerender } = render(<SubagentPanel />)
    expect(screen.getAllByText('Inspect member work').length).toBeGreaterThan(0)
    expect(useSummaryContent).toHaveBeenLastCalledWith(expect.objectContaining(inspection))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(useSummaryContent).toHaveBeenLastCalledWith(expect.objectContaining(inspection))
    fireEvent.click(screen.getByRole('button', { name: /Member review/ }))
    expect($subagentPanelSelection.get()?.inspection).toEqual(inspection)
    expect(useSummaryContent).toHaveBeenLastCalledWith(expect.objectContaining(inspection))

    if (change === 'conversation') {
      state.session = { ...state.session, storedId: 'different-parent' }
    } else {
      act(() => {
        $workspaceMode.set('bots')
        $workspaceOwnerKey.set('another-room')
      })
    }

    rerender(<SubagentPanel />)
    expect(screen.queryByText('Inspect member work')).toBeNull()
    expect(useSummaryContent).toHaveBeenLastCalledWith(expect.objectContaining(state.session))
    state.session = { ...state.session, storedId: 'stored-parent' }
  }
)

import { describe, expect, it } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'
import type { SubagentProgress } from '@/store/subagents'

import { delegateGoals, delegateRowsFromCall, mergeDelegateRows } from './delegate-model'

const subagent = (overrides: Partial<SubagentProgress>): SubagentProgress => ({
  filesRead: [],
  filesWritten: [],
  goal: 'Research Cursor',
  id: 'sub-1',
  parentId: null,
  startedAt: 0,
  status: 'running',
  stream: [],
  taskCount: 1,
  taskIndex: 0,
  updatedAt: 0,
  ...overrides
})

describe('delegateGoals', () => {
  it('reads a batch in task order and a single goal alike', () => {
    expect(delegateGoals({ tasks: [{ goal: 'A' }, { goal: 'B' }] })).toEqual(['A', 'B'])
    expect(delegateGoals({ goal: 'Solo' })).toEqual(['Solo'])
    expect(delegateGoals('{"goal":"Serialized"}')).toEqual(['Serialized'])
  })

  it('uses the active locale for unnamed tasks', () => {
    setRuntimeI18nLocale('zh')

    try {
      expect(delegateGoals({ tasks: [{}] })).toEqual(['任务 1'])
    } finally {
      setRuntimeI18nLocale('en')
    }
  })
})

describe('delegateRowsFromCall', () => {
  it('reads as running before a result and parked once dispatched', () => {
    const args = { tasks: [{ goal: 'A' }, { goal: 'B' }] }

    expect(delegateRowsFromCall(args, undefined).map(r => r.status)).toEqual(['running', 'running'])
    expect(delegateRowsFromCall(args, { status: 'dispatched', goals: ['A', 'B'] }).map(r => r.status)).toEqual([
      'dispatched',
      'dispatched'
    ])
  })

  it('takes status, model and duration from each settled result', () => {
    const rows = delegateRowsFromCall(
      { tasks: [{ goal: 'A' }, { goal: 'B' }] },
      {
        results: [
          { status: 'completed', summary: 'found it', model: 'anthropic/claude-opus-5', duration_seconds: 12 },
          { status: 'failed', summary: 'nope' }
        ]
      }
    )

    expect(rows.map(r => r.status)).toEqual(['completed', 'failed'])
    expect(rows[0]).toMatchObject({ activity: ['found it'], durationSeconds: 12, model: 'anthropic/claude-opus-5' })
  })

  // #73728 / #85492: the delegate tool settles rows with 'ok', 'error' or
  // 'timeout' — anything that is not a success must render as failed instead
  // of hiding behind a green 'completed' check.
  it('renders timeout/error settled results as failed, ok as completed', () => {
    const rows = delegateRowsFromCall(
      { tasks: [{ goal: 'A' }, { goal: 'B' }, { goal: 'C' }, { goal: 'D' }] },
      {
        results: [
          { status: 'ok', summary: 'done' },
          { status: 'timeout', error: 'Timed out after 600s' },
          { status: 'error', error: 'boom' },
          { status: 'failure' }
        ]
      }
    )

    expect(rows.map(r => r.status)).toEqual(['completed', 'failed', 'failed', 'failed'])
  })

  it('still lists a background dispatch whose goals only survive in the result', () => {
    expect(delegateRowsFromCall({}, { status: 'dispatched', goals: ['A', 'B'] }).map(r => r.goal)).toEqual(['A', 'B'])
  })

  it('localizes the result-only fallback title', () => {
    setRuntimeI18nLocale('zh')

    try {
      expect(delegateRowsFromCall({}, { results: [{ status: 'completed' }] })[0]?.goal).toBe('已委派任务')
    } finally {
      setRuntimeI18nLocale('en')
    }
  })
})

describe('mergeDelegateRows', () => {
  it('joins fallback rows by the tool call id they were keyed with', () => {
    const rows = delegateRowsFromCall({ tasks: [{ goal: 'A' }, { goal: 'B' }] }, undefined, 'call-7')

    const merged = mergeDelegateRows(
      rows,
      [
        subagent({ id: 'delegate-tool:call-7:1', goal: 'B', status: 'completed' }),
        subagent({ id: 'delegate-tool:call-7:0', goal: 'A', model: 'gpt-5' })
      ],
      'call-7'
    )

    expect(merged.map(r => r.status)).toEqual(['running', 'completed'])
    expect(merged[0]!.model).toBe('gpt-5')
  })

  it('joins native events by the receipt identity and prefers their live state', () => {
    const rows = delegateRowsFromCall(
      { tasks: [{ goal: 'Research Cursor' }] },
      { status: 'dispatched', subagent_ids: ['sub-1'] },
      'call-1'
    )

    const merged = mergeDelegateRows(
      rows,
      [
        subagent({
          goal: 'Research Cursor',
          model: 'anthropic/claude-opus-5',
          sessionId: 'child-1',
          stream: [
            { at: 1, kind: 'tool', text: 'Read File("a.ts")' },
            { at: 2, kind: 'progress', text: 'comparing' }
          ]
        })
      ],
      'call-1'
    )

    expect(merged[0]).toMatchObject({
      activity: ['Read File("a.ts")', 'comparing'],
      model: 'anthropic/claude-opus-5',
      sessionId: 'child-1',
      status: 'running'
    })
  })

  it('never lets a second delegation claim another call\u2019s workers', () => {
    const rows = delegateRowsFromCall({ tasks: [{ goal: 'C' }] }, undefined, 'call-2')

    // Two unrelated children in the session, neither matching this call's goal.
    const merged = mergeDelegateRows(
      rows,
      [subagent({ id: 'other-a', goal: 'A' }), subagent({ id: 'other-b', goal: 'B' })],
      'call-2'
    )

    expect(merged[0]!.goal).toBe('C')
    expect(merged[0]!.model).toBeUndefined()
  })

  it('requires receipt identity instead of equal goals or task counts across repeated delegations', () => {
    const args = { tasks: [{ goal: 'Review' }] }
    const oldChild = subagent({ id: 'old-child', delegationId: 'old-batch', goal: 'Review', status: 'completed' })
    const newChild = subagent({ id: 'new-child', delegationId: 'new-batch', goal: 'Review', status: 'running' })

    const historical = delegateRowsFromCall(args, { results: [{ status: 'ok', summary: 'Prior result' }] }, 'old')
    const pending = delegateRowsFromCall(args, undefined, 'new')
    expect(mergeDelegateRows(historical, [newChild], 'old')).toEqual(historical)
    expect(mergeDelegateRows(pending, [oldChild], 'new')).toEqual(pending)

    for (const identity of [{ subagent_ids: [newChild.id] }, { delegation_id: newChild.delegationId }]) {
      const dispatched = delegateRowsFromCall(args, { status: 'dispatched', ...identity }, 'new')
      const merged = mergeDelegateRows(dispatched, [oldChild, newChild], 'new')
      expect(merged[0]).toMatchObject({ id: newChild.id, status: newChild.status })
    }
  })

  it('does not treat a tool completion receipt as proof the dispatched child completed', () => {
    const args = { goal: 'Review' }
    const fallback = subagent({ id: 'delegate-tool:call-4:0', goal: 'Review', status: 'completed' })
    const dispatched = delegateRowsFromCall(args, { status: 'dispatched' }, 'call-4')
    expect(mergeDelegateRows(dispatched, [fallback], 'call-4')[0]?.status).toBe('dispatched')

    const settled = delegateRowsFromCall(
      args,
      { results: [{ status: 'error', error: 'Provider unavailable' }] },
      'call-4'
    )

    expect(mergeDelegateRows(settled, [fallback], 'call-4')[0]).toMatchObject({
      status: 'failed',
      activity: ['Provider unavailable']
    })
  })
})

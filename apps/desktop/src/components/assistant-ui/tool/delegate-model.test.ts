import { describe, expect, it } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'
import { $subagentsBySession, reconcileSubagentSnapshot, type SubagentProgress } from '@/store/subagents'

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

  it('retains a friendly name and child session receipt without replacing the original task', () => {
    const goal = 'Audit dependencies. Include the full license inventory and every source link.'

    const [row] = delegateRowsFromCall(
      { tasks: [{ goal }] },
      {
        results: [
          {
            status: 'ok',
            display_name: 'Dependency audit',
            subagent_id: 'worker-history',
            child_session_id: 'child-history'
          }
        ]
      },
      'call'
    )

    expect(row).toMatchObject({
      displayName: 'Dependency audit',
      goal,
      sessionId: 'child-history',
      subagentId: 'worker-history'
    })
    expect(delegateRowsFromCall({ tasks: [{ goal, display_name: 'Dependency audit' }] }, undefined)[0]).toMatchObject({
      displayName: 'Dependency audit',
      goal
    })
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

  it('carries the delegation id a settled result or dispatch handle names onto every row', () => {
    const settled = delegateRowsFromCall(
      { tasks: [{ goal: 'A' }] },
      { delegation_id: 'deleg_abc', results: [{ status: 'ok', summary: 'done' }] }
    )

    const dispatched = delegateRowsFromCall({}, { status: 'dispatched', delegation_id: 'deleg_abc', goals: ['A'] })

    expect(settled.map(r => r.delegationId)).toEqual(['deleg_abc'])
    expect(dispatched.map(r => r.delegationId)).toEqual(['deleg_abc'])
    expect(delegateRowsFromCall({ tasks: [{ goal: 'A' }] }, undefined)[0]!.delegationId).toBeUndefined()
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
          displayName: 'Cursor research',
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
      displayName: 'Cursor research',
      subagentId: 'sub-1',
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

  // #136532: two delegations sharing a goal string used to re-adopt each
  // other's workers — a settled card re-painted with a newer call's live child.
  it('joins by the delegation id first, so a repeated goal never crosses calls', () => {
    const settledCard = delegateRowsFromCall(
      { tasks: [{ goal: 'Harden the scanner' }] },
      { delegation_id: 'deleg_old', results: [{ status: 'ok', summary: 'done' }] }
    )

    const liveCard = delegateRowsFromCall(
      { tasks: [{ goal: 'Harden the scanner' }] },
      { delegation_id: 'deleg_new', status: 'dispatched' },
      'call-2'
    )

    const live = [
      subagent({
        id: 'sa-old',
        delegationId: 'deleg_old',
        goal: 'Harden the scanner',
        status: 'completed',
        model: 'old-model'
      }),
      subagent({
        id: 'sa-new',
        delegationId: 'deleg_new',
        goal: 'Harden the scanner',
        status: 'running',
        model: 'new-model'
      })
    ]

    const mergedSettled = mergeDelegateRows(settledCard, live, 'call-1')
    const mergedLive = mergeDelegateRows(liveCard, live, 'call-2')

    expect(mergedSettled[0]).toMatchObject({ model: 'old-model', status: 'completed' })
    expect(mergedLive[0]).toMatchObject({ model: 'new-model', status: 'running' })
  })

  it('counts a unit split of one delegation (id -1, -2 …) as the same call', () => {
    const rows = delegateRowsFromCall(
      { tasks: [{ goal: 'A' }, { goal: 'B' }] },
      { delegation_id: 'deleg_x', results: [{ status: 'ok' }, { status: 'ok' }] }
    )

    const merged = mergeDelegateRows(
      rows,
      [
        subagent({ id: 'u1', delegationId: 'deleg_x-1', taskIndex: 0, model: 'm0' }),
        subagent({ id: 'u2', delegationId: 'deleg_x-2', taskIndex: 1, model: 'm1' })
      ],
      'call-1'
    )

    expect(merged.map(r => r.model)).toEqual(['m0', 'm1'])
  })

  it('never claims a live child whose delegation id belongs to another call', () => {
    const rows = delegateRowsFromCall(
      { tasks: [{ goal: 'A' }, { goal: 'B' }] },
      { delegation_id: 'deleg_mine', results: [{ status: 'ok' }, { status: 'ok' }] }
    )

    // Both children carry a foreign delegation id and unmatchable goals, so
    // neither join may adopt them; the rows keep their settled result state.
    const merged = mergeDelegateRows(
      rows,
      [
        subagent({ id: 'f1', delegationId: 'deleg_other', goal: 'X', taskIndex: 0, model: 'foreign' }),
        subagent({ id: 'f2', delegationId: 'deleg_other', goal: 'Y', taskIndex: 1, model: 'foreign' })
      ],
      'call-1'
    )

    expect(merged.map(r => r.model)).toEqual([undefined, undefined])
    expect(merged.map(r => r.status)).toEqual(['completed', 'completed'])
  })

  // A batch without a live-transcript id leaves its children unstamped while
  // its dispatch handle still names a generated id: goal and order still join.
  it('refuses same-goal children without a matching batch receipt', () => {
    const rows = delegateRowsFromCall(
      { tasks: [{ goal: 'A' }, { goal: 'B' }] },
      { delegation_id: 'deleg_mine', goals: ['A', 'B'], status: 'dispatched' }
    )

    const merged = mergeDelegateRows(rows, [
      subagent({ id: 'f1', delegationId: 'deleg_other', goal: 'A', taskIndex: 0, model: 'foreign' }),
      subagent({ id: 'u1', goal: 'A', taskIndex: 0, model: 'mine' })
    ])

    expect(merged.map(r => r.model)).toEqual([undefined, undefined])
  })

  // subagent.list rows carry no task_index, so after a reload or on a second
  // client every hydrated child reads as task 0.
  it('places children from a cold roster by goal, not by an index it never sent', () => {
    reconcileSubagentSnapshot('sess-cold', [
      { delegation_id: 'deleg_x', goal: 'B', model: 'mB', status: 'running', subagent_id: 'sa-b' },
      { delegation_id: 'deleg_x', goal: 'A', model: 'mA', status: 'running', subagent_id: 'sa-a' }
    ])

    const rows = delegateRowsFromCall(
      { tasks: [{ goal: 'A' }, { goal: 'B' }] },
      { delegation_id: 'deleg_x', status: 'dispatched' }
    )

    const merged = mergeDelegateRows(rows, $subagentsBySession.get()['sess-cold'] ?? [])

    expect(merged.map(r => [r.goal, r.model])).toEqual([
      ['A', 'mA'],
      ['B', 'mB']
    ])
  })

  // One call may repeat a goal; only the task index tells those children apart.
  it('keeps repeated goals of one call on their own task index', () => {
    const rows = delegateRowsFromCall(
      { tasks: [{ goal: 'Run the suite' }, { goal: 'Run the suite' }] },
      { delegation_id: 'deleg_x', status: 'dispatched' }
    )

    const merged = mergeDelegateRows(rows, [
      subagent({ id: 'other', delegationId: 'deleg_y', goal: 'Something else', model: 'other' }),
      subagent({ id: 's1', delegationId: 'deleg_x', goal: 'Run the suite', taskIndex: 1, model: 'm1' }),
      subagent({ id: 's0', delegationId: 'deleg_x', goal: 'Run the suite', taskIndex: 0, model: 'm0' })
    ])

    expect(merged.map(r => r.model)).toEqual(['m0', 'm1'])
  })

  // A foreground call still running has no result, so no delegation id yet,
  // while its children already carry one.
  it('waits for a receipt before attaching a native child to an unfinished call', () => {
    const rows = delegateRowsFromCall({ tasks: [{ goal: 'A' }] }, undefined)

    const merged = mergeDelegateRows(rows, [subagent({ id: 's0', delegationId: 'deleg_x', goal: 'A', model: 'm0' })])

    expect(merged[0]).toMatchObject({ model: undefined, status: 'running' })
  })
})

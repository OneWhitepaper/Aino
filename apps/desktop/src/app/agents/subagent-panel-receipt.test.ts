import { afterEach, expect, it, vi } from 'vitest'

import { delegateRowsFromCall, mergeDelegateRows } from '@/components/assistant-ui/tool/delegate-model'
import { restoreTreePane } from '@/components/pane-shell/tree/store'
import { subagentAvatarSeed } from '@/lib/subagent-identity'
import type { SubagentProgress } from '@/store/subagents'

import { $subagentPanelSelection, openSubagentPanel, syncSubagentPanelRows } from './subagent-panel'

const source = vi.hoisted(() => ({
  current: {
    owner: { connectionId: 'connection', profile: 'default' },
    storedId: 'stored-parent',
    runtimeId: 'runtime-parent',
    sourceKey: 'source'
  }
}))

vi.mock('@/store/tool-session', () => ({ $toolSession: { get: () => source.current } }))
vi.mock('@/components/pane-shell/tree/store', async () => {
  const { atom } = await import('nanostores')

  return { $layoutTree: atom(null), restoreTreePane: vi.fn() }
})

afterEach(() => {
  $subagentPanelSelection.set(null)
  vi.clearAllMocks()
})

it('promotes the inspected pending row using its exact dispatch index without opening another surface', () => {
  const goal = 'Read and compare the dependency sources'
  const args = { tasks: [{ goal }] }
  const [pending] = delegateRowsFromCall(args, undefined, 'call-a')

  const intent = {
    parentRuntimeId: source.current.runtimeId,
    storedSessionId: source.current.storedId,
    toolCallId: 'call-a'
  }

  openSubagentPanel({ ...intent, row: pending })
  const pendingPortrait = subagentAvatarSeed($subagentPanelSelection.get()!.row!, 'stored-parent')

  const worker: SubagentProgress = {
    id: 'worker-a',
    displayName: 'Dependency audit',
    goal,
    parentId: null,
    status: 'running',
    taskIndex: 0,
    taskCount: 1,
    startedAt: 1,
    updatedAt: 2,
    stream: [{ at: 2, kind: 'tool', text: 'Read package.json' }],
    filesRead: [],
    filesWritten: []
  }

  const identified = mergeDelegateRows(
    delegateRowsFromCall(args, { status: 'dispatched', subagent_ids: ['worker-a'] }, 'call-a'),
    [worker],
    'call-a'
  )

  expect(syncSubagentPanelRows(intent, identified)).toBe(true)
  expect($subagentPanelSelection.get()).toMatchObject({
    taskId: 'worker-a',
    row: {
      subagentId: 'worker-a',
      displayName: 'Dependency audit',
      goal,
      activity: ['Read package.json']
    }
  })
  const portrait = subagentAvatarSeed($subagentPanelSelection.get()!.row!, 'stored-parent')
  expect(portrait).not.toBe(pendingPortrait)
  expect(portrait).toBe(subagentAvatarSeed(worker, 'stored-parent'))
  expect(restoreTreePane).toHaveBeenCalledTimes(1)
  expect(restoreTreePane).toHaveBeenCalledWith('subagents')
})

it('never lets an identical goal from another dispatch or source replace the inspected child', () => {
  const args = { tasks: [{ goal: 'Read and compare the dependency sources' }] }
  const [pending] = delegateRowsFromCall(args, undefined, 'call-a')

  const intent = {
    parentRuntimeId: source.current.runtimeId,
    storedSessionId: source.current.storedId,
    toolCallId: 'call-a'
  }

  openSubagentPanel({ ...intent, row: pending })
  const original = $subagentPanelSelection.get()
  const foreign = delegateRowsFromCall(args, { status: 'dispatched', subagent_ids: ['foreign-child'] }, 'call-b')
  expect(syncSubagentPanelRows({ ...intent, toolCallId: 'call-b' }, foreign)).toBe(false)
  expect(syncSubagentPanelRows({ ...intent, owner: { connectionId: 'another', profile: 'default' } }, foreign)).toBe(
    false
  )
  expect(syncSubagentPanelRows({ ...intent, parentRuntimeId: 'other', storedSessionId: 'other' }, foreign)).toBe(false)
  expect($subagentPanelSelection.get()).toBe(original)
  expect(restoreTreePane).toHaveBeenCalledTimes(1)
})

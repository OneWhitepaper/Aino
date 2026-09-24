import { describe, expect, it } from 'vitest'

import { toChatMessages } from '@/lib/chat-messages'
import type { SubagentProgress } from '@/store/subagents'
import type { SessionMessage } from '@/types/hermes'

import { summaryAgentCounts, summaryDelegations, summaryHistoryActivity } from './session-activity'

describe('summary activity history', () => {
  it('retains the last recorded plan and completed delegation after ephemeral runtime stores are cleared', () => {
    const raw: SessionMessage[] = [
      {
        role: 'tool',
        tool_call_id: 'todo-1',
        tool_name: 'todo_list',
        content: JSON.stringify({ todos: [{ id: '1', content: 'Create report', status: 'in_progress' }] })
      },
      {
        role: 'tool',
        tool_call_id: 'delegate-1',
        tool_name: 'delegate_task',
        args: { tasks: [{ goal: 'Check report' }] },
        content: JSON.stringify({ status: 'dispatched', delegation_id: 'batch-1', goals: ['Check report'] })
      },
      {
        role: 'tool',
        tool_call_id: 'todo-2',
        tool_name: 'todo_list',
        content: JSON.stringify({ todos: [{ id: '1', content: 'Create report', status: 'completed' }] })
      },
      {
        role: 'system',
        content: 'Finished',
        display_kind: 'async_delegation_complete',
        display_metadata: { delegation_id: 'batch-1', task_count: 1, completed_count: 1, failed_count: 0 }
      }
    ]

    const history = summaryHistoryActivity(toChatMessages(raw), raw)

    expect(history.todos).toEqual([{ id: '1', content: 'Create report', status: 'completed' }])
    expect(summaryAgentCounts(summaryDelegations(history.delegations, []))).toEqual({
      completed: 1,
      failed: 0,
      running: 0,
      dispatched: 0
    })
  })

  it('joins live workers to the exact delegation without double counting repeated task goals', () => {
    const raw: SessionMessage[] = ['old', 'new'].map(id => ({
      role: 'tool',
      tool_name: 'delegate_task',
      tool_call_id: id,
      args: { tasks: [{ goal: 'Review' }] },
      content: JSON.stringify({ status: 'dispatched', delegation_id: id, goals: ['Review'] })
    }))

    const history = summaryHistoryActivity(toChatMessages(raw), raw)

    const live: SubagentProgress = {
      id: 'child',
      parentId: null,
      goal: 'Review',
      delegationId: 'new',
      sessionId: 'child-session',
      status: 'running',
      taskCount: 1,
      taskIndex: 0,
      startedAt: 1,
      updatedAt: 2,
      filesRead: [],
      filesWritten: [],
      stream: []
    }

    const merged = summaryDelegations(history.delegations, [live])

    expect(summaryAgentCounts(merged)).toEqual({ completed: 0, failed: 0, running: 1, dispatched: 1 })
    expect(merged.find(group => group.delegationId === 'new')?.rows[0].sessionId).toBe(live.sessionId)
    expect(merged.find(group => group.delegationId === 'old')?.rows[0].status).toBe('dispatched')

    // A legacy event with only matching display text cannot replace either receipt.
    const legacy = { ...live, id: 'legacy-child', delegationId: undefined }
    const unattributed = summaryDelegations(history.delegations, [legacy])
    expect(summaryAgentCounts(unattributed)).toEqual({ completed: 0, failed: 0, running: 1, dispatched: 2 })
    expect(unattributed.find(group => group.id === legacy.id)?.rows[0].sessionId).toBe(legacy.sessionId)
  })
})

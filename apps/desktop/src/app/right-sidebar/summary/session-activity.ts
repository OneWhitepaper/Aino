import {
  type DelegateRow,
  delegateRowsFromCall,
  mergeDelegateRows
} from '@/components/assistant-ui/tool/delegate-model'
import { parseMaybeObject } from '@/components/assistant-ui/tool/fallback-model'
import type { ChatMessage } from '@/lib/chat-messages'
import { type TodoItem, todosFromMessageContent } from '@/lib/todos'
import type { SubagentProgress } from '@/store/subagents'
import type { SessionMessage } from '@/types/hermes'

export interface SummaryDelegation {
  id: string
  delegationId?: string
  completion?: { completed: number; failed: number }
  rows: DelegateRow[]
}

export interface SummaryActivity {
  delegations: SummaryDelegation[]
  todos: TodoItem[]
}

/** Standalone gateway tool rows hydrate their payload as result.context;
 * paired assistant/tool rows expose the payload directly. */
export function summaryToolResult(value: unknown): unknown {
  const record = parseMaybeObject(value)

  return Object.keys(record).length === 1 && typeof record.context === 'string' ? record.context : value
}

export function summaryHistoryActivity(
  messages: readonly ChatMessage[],
  raw: readonly SessionMessage[]
): SummaryActivity {
  const completions = new Map<string, SummaryDelegation['completion']>()

  for (const message of raw) {
    if (message.display_kind !== 'async_delegation_complete') {
      continue
    }

    const metadata = parseMaybeObject(message.display_metadata)

    if (
      typeof metadata.delegation_id === 'string' &&
      typeof metadata.completed_count === 'number' &&
      typeof metadata.failed_count === 'number'
    ) {
      completions.set(metadata.delegation_id, { completed: metadata.completed_count, failed: metadata.failed_count })
    }
  }

  const delegations = new Map<string, SummaryDelegation>()
  let todos: TodoItem[] = []

  for (const message of messages) {
    for (const [index, part] of message.parts.entries()) {
      if (part.type !== 'tool-call') {
        continue
      }

      const payload = summaryToolResult(part.result)
      const nextTodos = todosFromMessageContent([{ ...part, result: payload }])

      if (nextTodos !== null) {
        todos = nextTodos
      }

      if (part.toolName !== 'delegate_task') {
        continue
      }

      const callId = part.toolCallId || `${message.id}:delegate:${index}`
      const result = parseMaybeObject(payload)
      const delegationId = typeof result.delegation_id === 'string' ? result.delegation_id : undefined
      const completion = delegationId ? completions.get(delegationId) : undefined

      const rows = delegateRowsFromCall(part.args, payload, callId).map(row => ({
        ...row,
        // A persisted dispatch does not prove that a process is still running.
        status: row.status === 'running' || row.status === 'queued' ? ('dispatched' as const) : row.status
      }))

      if (rows.length) {
        delegations.set(callId, { id: callId, delegationId, completion, rows })
      }
    }
  }

  return { delegations: [...delegations.values()], todos }
}

/** Join the current runtime feed using the same receipt identities as the
 * transcript. Unattributed children remain visible as their own entries. */
export function summaryDelegations(
  history: readonly SummaryDelegation[],
  live: readonly SubagentProgress[]
): SummaryDelegation[] {
  const remaining = new Set(live)

  const merged = [...history]
    .reverse()
    .map(group => {
      const rows = mergeDelegateRows(group.rows, [...remaining], group.id)
      const matchedIds = new Set(rows.map(row => row.id))

      for (const item of remaining) {
        if (matchedIds.has(item.id)) {
          remaining.delete(item)
        }
      }

      return { ...group, rows }
    })
    .reverse()

  for (const item of remaining) {
    merged.push({
      id: item.id,
      delegationId: item.delegationId,
      rows: [
        {
          id: item.id,
          goal: item.goal,
          status: item.status,
          sessionId: item.sessionId,
          activity: item.stream.map(entry => entry.text),
          model: item.model
        }
      ]
    })
  }

  return merged
}

export function summaryAgentCounts(groups: readonly SummaryDelegation[]) {
  const counts = { completed: 0, failed: 0, running: 0, dispatched: 0 }

  for (const group of groups) {
    if (group.completion) {
      counts.completed += group.completion.completed
      counts.failed += group.completion.failed

      continue
    }

    for (const row of group.rows) {
      const key = row.status === 'queued' ? 'running' : row.status === 'interrupted' ? 'failed' : row.status
      counts[key] += 1
    }
  }

  return counts
}

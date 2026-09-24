import { translateNow } from '@/i18n'
import { firstStringField } from '@/lib/text'
import type { SubagentProgress, SubagentStatus } from '@/store/subagents'

import { numberValue, parseMaybeObject } from './fallback-model'

/**
 * A delegation runs somewhere the transcript can't see: the tool call carries
 * the goals it dispatched, the subagent store carries what those children are
 * actually doing, and the tool result carries how they finished. One row is
 * all three of those views of the same child.
 */
export interface DelegateRow {
  /** Relayed activity, oldest → newest, revealed when the child row is expanded. */
  activity: string[]
  durationSeconds?: number
  /** Receipt identities, never inferred from a task's display text. */
  delegationId?: string
  subagentId?: string
  goal: string
  id: string
  model?: string
  /** The child's own session id, when it reported one — opens its window. */
  sessionId?: string
  status: DelegateRowStatus
}

/**
 * `dispatched` is the state the other two sources can't describe: a background
 * delegation whose children outlived the turn, seen from a transcript that has
 * been reloaded since. It is running, but nothing here is watching it, so it
 * must not spin.
 */
export type DelegateRowStatus = SubagentStatus | 'dispatched'

const field = (record: Record<string, unknown>, key: string): string => firstStringField(record, [key])

/** The goals a `delegate_task` call dispatched, in task order. */
export function delegateGoals(args: unknown): string[] {
  const record = parseMaybeObject(args)
  const tasks = Array.isArray(record.tasks) ? record.tasks : []

  if (tasks.length > 0) {
    return tasks.map(
      (task, index) => field(parseMaybeObject(task), 'goal') || translateNow('assistant.tool.taskNumber', index + 1)
    )
  }

  const goal = field(record, 'goal')

  return goal ? [goal] : []
}

function resultRows(result: unknown): Record<string, unknown>[] {
  const record = parseMaybeObject(result)
  const results = Array.isArray(record.results) ? record.results : []

  return results.map(parseMaybeObject)
}

// The delegate tool settles result rows with statuses like 'ok', 'error',
// 'timeout', 'failed'/'failure' (tools/delegate_tool.py). Anything that is
// not a success must render as failed — mapping unknown statuses to
// 'completed' hid timed-out children behind a green check (#73728, #85492).
function settledRowStatus(status: string): DelegateRowStatus {
  return status === '' || status === 'ok' || status === 'completed' ? 'completed' : 'failed'
}

function dispatchedGoals(result: unknown): string[] {
  const record = parseMaybeObject(result)

  if (field(record, 'status') !== 'dispatched') {
    return []
  }

  return Array.isArray(record.goals) ? record.goals.filter((goal): goal is string => typeof goal === 'string') : []
}

/**
 * The rows a call describes on its own — before any live subagent state is
 * layered on. This is what a rehydrated transcript has to work with: the goals
 * it dispatched, and whatever the result said about how they went.
 *
 * A call with no result yet is still being placed, so its rows read as
 * running; the moment a background dispatch answers, they drop to parked.
 */
export function delegateRowsFromCall(args: unknown, result: unknown, toolCallId = ''): DelegateRow[] {
  const record = parseMaybeObject(result)
  const goals = delegateGoals(args)
  const finished = resultRows(result)
  const dispatched = dispatchedGoals(result)
  const subagentIds = Array.isArray(record.subagent_ids) ? record.subagent_ids : []
  const delegationId = field(record, 'delegation_id') || undefined

  const titles =
    goals.length > 0
      ? goals
      : dispatched.length > 0
        ? dispatched
        : finished.map(() => translateNow('assistant.tool.delegatedTask'))

  const idle: DelegateRowStatus = result === undefined ? 'running' : 'dispatched'

  return titles.map((goal, index) => {
    const entry = finished[index]
    const summary = entry ? field(entry, 'summary') || field(entry, 'error') : ''

    return {
      activity: summary ? [summary] : [],
      durationSeconds: entry ? (numberValue(entry.duration_seconds) ?? undefined) : undefined,
      delegationId,
      subagentId: typeof subagentIds[index] === 'string' && subagentIds[index] ? subagentIds[index] : undefined,
      goal,
      id: `${toolCallId}:${index}`,
      model: entry ? field(entry, 'model') || undefined : undefined,
      status: entry ? settledRowStatus(field(entry, 'status')) : idle
    }
  })
}

function fromSubagent(live: SubagentProgress, fallbackId: string, fallbackGoal: string): DelegateRow {
  return {
    activity: live.stream
      .map(entry => (entry.kind === 'summary' ? live.summary || entry.text : entry.text))
      .filter(Boolean),
    durationSeconds: live.durationSeconds,
    goal: live.goal || fallbackGoal,
    id: live.id || fallbackId,
    model: live.model,
    sessionId: live.sessionId,
    status: live.status
  }
}

/**
 * Layer the session's live subagents over the rows a call describes.
 *
 * A dispatch receipt names its children and batch. Before that receipt, only
 * the tool-call-keyed fallback is attributable here; native workers remain in
 * the session's agent list. Goals and task counts are not identities: repeated
 * delegations may have identical text and shape. A persisted child result is
 * authoritative over an older live snapshot or synthetic tool completion.
 */
export function mergeDelegateRows(
  rows: readonly DelegateRow[],
  live: readonly SubagentProgress[],
  toolCallId = ''
): DelegateRow[] {
  if (live.length === 0) {
    return [...rows]
  }

  const unclaimed = [...live]

  const claim = (predicate: (candidate: SubagentProgress) => boolean): SubagentProgress | undefined => {
    const index = unclaimed.findIndex(predicate)

    return index >= 0 ? unclaimed.splice(index, 1)[0] : undefined
  }

  const prefix = toolCallId ? `delegate-tool:${toolCallId}:` : ''

  return rows.map((row, index) => {
    const native = row.subagentId
      ? claim(candidate => candidate.id === row.subagentId)
      : row.delegationId
        ? claim(candidate => candidate.delegationId === row.delegationId && candidate.taskIndex === index)
        : undefined

    const matched = native ?? (prefix ? claim(candidate => candidate.id === `${prefix}${index}`) : undefined)

    if (!matched) {
      return row
    }

    const merged = { ...row, ...fromSubagent(matched, row.id, row.goal) }

    if (!isDelegateRowLive(row.status) && (row.status !== 'dispatched' || !native)) {
      return {
        ...merged,
        activity: row.activity.length ? row.activity : merged.activity,
        durationSeconds: row.durationSeconds ?? merged.durationSeconds,
        status: row.status
      }
    }

    return merged
  })
}

export const isDelegateRowLive = (status: DelegateRowStatus): boolean => status === 'running' || status === 'queued'

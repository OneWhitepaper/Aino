import { describe, expect, it } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'
import type { GatewayEventPayload } from '@/lib/chat-messages'
import { $subagentsBySession, pruneFinishedSessionSubagents, upsertSubagent } from '@/store/subagents'

import {
  completionErrorText,
  delegateTaskPayloads,
  hasSessionInfoStatePatch,
  sessionInfoStatePatch,
  toTodoPayload
} from './utils'

const payload = (over: Record<string, unknown>): GatewayEventPayload => over as GatewayEventPayload

describe('completionErrorText', () => {
  it('flags provider/HTTP/retry failures, ignores normal text', () => {
    expect(completionErrorText('API call failed after 3 retries: boom')).toMatch(/^API call failed/)
    expect(completionErrorText('HTTP 500 upstream')).toMatch(/^HTTP 500/)
    expect(completionErrorText('Gateway error: nope')).toMatch(/^Gateway error/)
    expect(completionErrorText('here is your answer')).toBeNull()
    expect(completionErrorText('   ')).toBeNull()
  })
})

describe('toTodoPayload', () => {
  it('routes named todo and anonymous todos-bearing events to the todo stream', () => {
    expect(toTodoPayload(payload({ name: 'todo' }))?.tool_id).toBe('todo-live')
    expect(toTodoPayload(payload({ todos: [] }))?.name).toBe('todo_list')
    expect(toTodoPayload(payload({ name: 'todo_list' }))?.tool_id).toBe('todo-live')
    expect(toTodoPayload(payload({ name: 'web_search' }))).toBeUndefined()
    expect(toTodoPayload(undefined)).toBeUndefined()
  })
})

describe('sessionInfoStatePatch / hasSessionInfoStatePatch', () => {
  it('extracts only present runtime fields', () => {
    const patch = sessionInfoStatePatch(payload({ model: 'gpt', fast: true, branch: 'main' }))
    expect(patch).toMatchObject({ model: 'gpt', fast: true, branch: 'main' })
    expect(hasSessionInfoStatePatch(patch)).toBe(true)
    expect(hasSessionInfoStatePatch(sessionInfoStatePatch(payload({})))).toBe(false)
  })
})

describe('delegateTaskPayloads', () => {
  it('returns [] for non-delegate events', () => {
    expect(delegateTaskPayloads(payload({ name: 'web_search' }), 'running')).toEqual([])
  })

  it('maps a running tool.start to a subagent.start spec', () => {
    const [spec] = delegateTaskPayloads(
      payload({ name: 'delegate_task', tool_id: 't1', args: { goal: 'do it' } }),
      'running',
      'tool.start'
    )

    expect(spec).toMatchObject({ event_type: 'subagent.start', goal: 'do it', status: 'running' })
  })

  it('maps completion (with error) to a failed subagent.complete', () => {
    const [spec] = delegateTaskPayloads(
      payload({ name: 'delegate_task', error: 'boom', result: { summary: 'failed run' } }),
      'complete'
    )

    expect(spec).toMatchObject({ event_type: 'subagent.complete', status: 'failed' })
  })

  it.each(['timeout', 'error', 'failed', 'failure', 'TIMEOUT'])(
    'maps completion with result.status=%s to a failed subagent.complete',
    resultStatus => {
      const [spec] = delegateTaskPayloads(
        payload({ name: 'delegate_task', result: { status: resultStatus, summary: 'timed out' } }),
        'complete'
      )

      expect(spec).toMatchObject({ event_type: 'subagent.complete', status: 'failed' })
    }
  )

  it('maps a successful completion to completed', () => {
    const [spec] = delegateTaskPayloads(
      payload({ name: 'delegate_task', result: { status: 'success', summary: 'done' } }),
      'complete'
    )

    expect(spec).toMatchObject({ event_type: 'subagent.complete', status: 'completed' })
  })

  it('keeps a background dispatch active until a child completion is actually observed', () => {
    const sid = 'dispatch-receipt-contract'

    try {
      const request = { name: 'delegate_task', tool_id: 't-background', args: { goal: 'Review' } }
      const [start] = delegateTaskPayloads(payload(request), 'running', 'tool.start')
      upsertSubagent(sid, start, true, 'delegate.running')

      const [receipt] = delegateTaskPayloads(
        payload({ ...request, duration_s: 1, result: { status: 'dispatched', goals: ['Review'] } }),
        'complete'
      )

      expect(receipt).toMatchObject({ event_type: 'subagent.progress', status: 'running' })
      expect(receipt.duration_seconds).toBeUndefined()
      upsertSubagent(sid, receipt, true, 'delegate.complete')
      pruneFinishedSessionSubagents(sid)
      expect($subagentsBySession.get()[sid]?.[0]?.status).toBe('running')

      upsertSubagent(
        sid,
        { subagent_id: receipt.subagent_id, status: 'completed', summary: 'Verified' },
        false,
        'subagent.complete'
      )
      expect($subagentsBySession.get()[sid]?.[0]?.status).toBe('completed')
    } finally {
      $subagentsBySession.set({})
    }
  })

  it('preserves top-level failure and each synchronous child result instead of completing the whole batch', () => {
    const request = { name: 'delegate_task', tool_id: 't-results', args: { goal: 'Review' } }

    const [failure] = delegateTaskPayloads(
      payload({ ...request, result: { error: 'Provider unavailable' } }),
      'complete'
    )

    expect(failure).toMatchObject({ status: 'failed', summary: 'Provider unavailable' })

    const results = delegateTaskPayloads(
      payload({
        ...request,
        args: { tasks: [{ goal: 'First' }, { goal: 'Second' }] },
        result: {
          results: [
            { task_index: 1, status: 'timeout', error: 'Timed out', duration_seconds: 4 },
            { task_index: 0, status: 'ok', summary: 'Verified', duration_seconds: 2 }
          ]
        }
      }),
      'complete'
    )

    expect(results).toMatchObject([
      { goal: 'First', status: 'completed', summary: 'Verified', duration_seconds: 2 },
      { goal: 'Second', status: 'failed', summary: 'Timed out', duration_seconds: 4 }
    ])
    expect(results[1].output_tail).toEqual([{ is_error: true, preview: 'Timed out', tool: 'delegate_task' }])
  })

  it('localizes the unnamed delegation fallback', () => {
    setRuntimeI18nLocale('zh')

    try {
      const [spec] = delegateTaskPayloads(payload({ name: 'delegate_task', args: {} }), 'running')

      expect(spec?.goal).toBe('已委派任务')
    } finally {
      setRuntimeI18nLocale('en')
    }
  })
})

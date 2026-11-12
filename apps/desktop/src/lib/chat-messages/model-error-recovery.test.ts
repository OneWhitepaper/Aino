import { describe, expect, it } from 'vitest'

import { toChatMessages } from './hydration'
import { captureModelErrors, modelErrorRecoveryReasons, resolveCapturedModelErrors } from './model-error-recovery'
import { preserveLocalAssistantErrors } from './reconciliation'
import type { ChatMessage } from './types'

const user: ChatMessage = { id: 'user', role: 'user', parts: [{ type: 'text', text: 'hello' }], rowId: 1 }

const failure = (id = 'failed', code = 'managed_model_access_denied'): ChatMessage => ({
  id,
  role: 'assistant',
  parts: [],
  error: 'unavailable',
  errorSurface: { layer: 'provider', code, retryable: false }
})

describe('model error recovery boundaries', () => {
  it('derives cold-load recovery from the committed model-switch marker but keeps a later failure active', () => {
    const surface = { layer: 'provider', code: 'managed_model_access_denied', retryable: false }

    const cold = toChatMessages([
      { id: 1, role: 'user', content: 'hello' },
      {
        id: 2,
        role: 'user',
        content: 'This turn failed before producing a response.',
        display_kind: 'failed_turn',
        display_metadata: { error: 'old failure', error_surface: surface }
      },
      {
        id: 3,
        role: 'user',
        content: 'model changed',
        display_kind: 'model_switch',
        display_metadata: {
          model: 'available-model',
          provider: 'aino',
          previous_model: 'unavailable-model',
          previous_provider: 'aino'
        }
      },
      {
        id: 4,
        role: 'user',
        content: 'This turn failed before producing a response.',
        display_kind: 'failed_turn',
        display_metadata: { error: 'new failure', error_surface: surface }
      }
    ])

    const errors = cold.filter(message => message.error)
    expect(errors).toHaveLength(2)
    expect([...modelErrorRecoveryReasons(cold)]).toEqual([[errors[0].id, 'model_changed']])
    expect(modelErrorRecoveryReasons(cold).has(errors[1].id)).toBe(false)
  })

  it('preserves a confirmed acknowledgement when the stored failed turn replaces the optimistic row', () => {
    const live = [user, { ...failure(), rowId: 2 }]
    const resolved = resolveCapturedModelErrors(live, captureModelErrors(live))

    const stored = [user, { ...failure('stored-failed'), rowId: 2 }]

    const hydrated = preserveLocalAssistantErrors(stored, resolved)
    expect(hydrated.find(message => message.error)?.rowId).toBe(2)
    expect(hydrated.find(message => message.error)?.id).not.toBe('failed')
    expect(hydrated.filter(message => message.error)).toHaveLength(1)
    expect(hydrated.find(message => message.error)).toMatchObject({
      error: 'unavailable',
      errorResolved: 'model_changed'
    })
    expect(modelErrorRecoveryReasons(hydrated).size).toBe(1)
  })

  it('never transfers a resolved marker to an ambiguous newer failure with the same code', () => {
    const old = { ...failure(), errorResolved: 'model_changed' as const }

    const pivot: ChatMessage = {
      id: 'pivot',
      role: 'system',
      parts: [],
      modelSwitch: { model: 'new-model', provider: 'aino', previous_model: 'old-model', previous_provider: 'aino' }
    }

    const newFailure = { ...failure('new-failure'), error: 'new request failed', rowId: 4 }

    const hydrated = preserveLocalAssistantErrors(
      [user, { ...failure('stored-old'), rowId: 2 }, pivot, newFailure],
      [user, old, pivot]
    )

    expect(hydrated.find(message => message.id === newFailure.id)?.errorResolved).toBeUndefined()
    expect(modelErrorRecoveryReasons(hydrated).has(newFailure.id)).toBe(false)
  })

  it('does not infer failed-turn identity from matching partial prose', () => {
    const partial = [{ type: 'text' as const, text: 'I will check it.' }]
    const resolved = { ...failure('old-failure'), parts: partial, errorResolved: 'model_changed' as const }
    const newer = { ...failure('new-failure'), parts: partial }
    const hydrated = preserveLocalAssistantErrors([user, newer], [user, resolved])
    expect(hydrated.find(message => message.id === newer.id)?.errorResolved).toBeUndefined()
  })

  it('does not acknowledge unrelated or later failures, or an attempt that has not succeeded', () => {
    const old = failure()
    const initial = [user, old, failure('billing', 'billing')]
    const captured = captureModelErrors(initial)
    const newer = failure('new-failure')
    const pending = [...initial, newer]
    expect(modelErrorRecoveryReasons(pending).size).toBe(0)
    const resolved = resolveCapturedModelErrors(pending, captured)
    expect(resolved.find(message => message.id === old.id)?.errorResolved).toBe('model_changed')
    expect(resolved.find(message => message.id === 'billing')?.errorResolved).toBeUndefined()
    expect(resolved.find(message => message.id === newer.id)?.errorResolved).toBeUndefined()
    expect(modelErrorRecoveryReasons([newer]).size).toBe(0)
  })

  it('does not treat thinking, a failed retry, or a previous reply as proof of recovery', () => {
    const answer: ChatMessage = { id: 'reply', role: 'assistant', parts: [{ type: 'text', text: 'answer' }] }
    expect(modelErrorRecoveryReasons([answer, failure()]).size).toBe(0)
    expect(modelErrorRecoveryReasons([failure(), { ...answer, pending: true }]).size).toBe(0)
    expect(modelErrorRecoveryReasons([failure(), { ...answer, error: 'request failed' }]).size).toBe(0)
    expect(modelErrorRecoveryReasons([failure(), { ...answer, interim: true }]).size).toBe(0)
    expect(modelErrorRecoveryReasons([failure(), { ...answer, interrupted: true }]).size).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'

import { chatMessagesEquivalent } from '@/app/session/hooks/use-session-actions/utils'
import { toRuntimeMessage } from '@/lib/chat-runtime'

import { toChatMessages } from './hydration'

describe('reply metrics hydration', () => {
  it('keeps final reply metrics when tool activity is merged and publishes them to the renderer', () => {
    const metrics = { duration_s: 12, total_tokens: 1600, session_elapsed_s: 100 }

    const messages = toChatMessages([
      { role: 'user', content: 'question' },
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'terminal', arguments: '{}' } }]
      },
      { role: 'assistant', content: 'Done.', display_metadata: { turn_metrics: metrics } }
    ])

    const reply = messages.at(-1)!
    expect(reply.turnMetrics).toEqual(metrics)
    expect(toRuntimeMessage(reply).metadata?.custom?.turnMetrics).toEqual(metrics)
    expect(chatMessagesEquivalent(reply, { ...reply, turnMetrics: { ...metrics } })).toBe(true)
    expect(chatMessagesEquivalent(reply, { ...reply, turnMetrics: { ...metrics, total_tokens: 1800 } })).toBe(false)
  })

  it('leaves old or malformed metrics absent instead of inventing historical usage', () => {
    const [old, malformed] = toChatMessages([
      { role: 'assistant', content: 'Old reply.' },
      {
        role: 'assistant',
        content: 'Bad metadata.',
        display_metadata: { turn_metrics: { duration_s: -1, total_tokens: '500' } }
      }
    ])

    expect(old.turnMetrics).toBeUndefined()
    expect(malformed.turnMetrics).toBeUndefined()
  })

  it('preserves explicit non-Aino call facts alongside Aino billing and leaves old history unknown', () => {
    const [old, external, mixed, malformed] = toChatMessages([
      { role: 'assistant', content: 'Old reply.', display_metadata: { turn_metrics: { duration_s: 2 } } },
      {
        role: 'assistant',
        content: 'External reply.',
        display_metadata: { turn_metrics: { duration_s: 3, non_aino_model_calls: true } }
      },
      {
        role: 'assistant',
        content: 'Mixed reply.',
        display_metadata: {
          turn_metrics: {
            duration_s: 4,
            non_aino_model_calls: true,
            billing: {
              source: 'aino',
              user_id: '17',
              session_id: '6ccf86e3-f42c-4d1b-9fbe-9b7ea58a03ca',
              turn_id: 'b8664a58-472a-4ba6-b853-94aadee41bb1',
              status: 'pending',
              calls: [{ call_id: 'cbec3bce-4de2-4fbe-a6ee-5ab3e7d990cb', purpose: 'chat' }],
              calls_complete: true,
              revision: 2
            }
          }
        }
      },
      {
        role: 'assistant',
        content: 'Unknown reply.',
        display_metadata: { turn_metrics: { duration_s: 5, non_aino_model_calls: 'current_model' } }
      }
    ])

    expect(old.turnMetrics).toEqual({ duration_s: 2 })
    expect(external.turnMetrics).toEqual({ duration_s: 3, non_aino_model_calls: true })
    expect(mixed.turnMetrics).toMatchObject({ duration_s: 4, non_aino_model_calls: true, billing: { source: 'aino' } })
    expect(malformed.turnMetrics).toEqual({ duration_s: 5 })
    expect(chatMessagesEquivalent(external, { ...external, turnMetrics: { ...external.turnMetrics } })).toBe(true)
    expect(
      chatMessagesEquivalent(external, {
        ...external,
        turnMetrics: { duration_s: 3 }
      })
    ).toBe(false)
  })
})

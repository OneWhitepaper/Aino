import { describe, expect, it } from 'vitest'

import { parseTurnBilling } from './turn-billing'
import { parseTurnMetrics, turnMetricsEquivalent } from './turn-metrics'

describe('managed reply correlation', () => {
  it('preserves valid receipts without trusting runtime settlement or secret fields', () => {
    const raw = {
      source: 'aino',
      user_id: '17',
      session_id: crypto.randomUUID(),
      turn_id: crypto.randomUUID(),
      calls: ['compression', 'session_summary', 'approval', 'mcp', 'tts_audio_tags', 'side_question'].map(purpose => ({
        call_id: crypto.randomUUID(),
        purpose
      })),
      calls_complete: true,
      revision: 3,
      status: 'settled',
      actual_cost: '0.00',
      api_key: 'fixture-secret'
    }

    const parsed = parseTurnBilling(raw)
    expect(parsed?.calls).toEqual(raw.calls)
    expect(parsed?.status).toBe('pending')
    expect(parsed).not.toHaveProperty('actual_cost')
    expect(parsed).not.toHaveProperty('api_key')
    expect(parseTurnMetrics({ billing: raw })?.billing).toEqual(parsed)
    expect(turnMetricsEquivalent({ billing: parsed }, { billing: parseTurnBilling(raw) })).toBe(true)
    expect(turnMetricsEquivalent({ billing: parsed }, { billing: parseTurnBilling({ ...raw, revision: 4 }) })).toBe(
      false
    )
    expect(parseTurnBilling({ ...raw, calls: [...raw.calls, ...raw.calls] })).toBeUndefined()
    expect(parseTurnBilling({ ...raw, turn_id: 'not-an-id' })).toBeUndefined()
    expect(parseTurnBilling({ ...raw, calls_complete: 'true' })).toBeUndefined()
  })
})

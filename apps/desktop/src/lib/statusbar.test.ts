import { describe, expect, it } from 'vitest'

import { cacheHitLabel, contextBarLabel, tokensPerSecondLabel, usageContextLabel } from '@/lib/statusbar'

const base = { calls: 0, input: 0, output: 0, total: 0 }

describe('statusbar usage readouts', () => {
  it('never presents lifetime throughput or unknown occupancy as the current context', () => {
    expect(usageContextLabel({ ...base, total: 900_000 })).toBe('')
    expect(usageContextLabel({ ...base, context_max: 100_000 })).toBe('—/100k')
    expect(contextBarLabel({ ...base, context_max: 100_000 })).toBe('')
    expect(usageContextLabel({ ...base, context_used: 12_000 })).toBe('12k tok')
    expect(usageContextLabel({ ...base, context_used: 0, context_max: 100_000, context_percent: 0 })).toBe('0/100k')
  })

  it('paints the backend cache-hit and throughput fields, and stays blank when they are absent', () => {
    // The backend omits both fields (rather than sending 0) when it has no data
    // — a provider with no cache reads, or a session before its first call.
    expect(cacheHitLabel(base)).toBe('')
    expect(tokensPerSecondLabel(base)).toBe('')

    expect(cacheHitLabel({ ...base, cache_hit_pct: 87 })).toBe('87%')
    expect(tokensPerSecondLabel({ ...base, avg_tps: 41.6 })).toBe('42 t/s')
  })
})

import { describe, expect, it } from 'vitest'

import { clampPoolLimits, parsePoolLimits, POOL_LIMITS_DEFAULTS } from './pool-limits'

describe('desktop profile connection limits', () => {
  it('clamps saved values to the supported range', () => {
    expect(clampPoolLimits({ maxBackends: 99, idleMs: 1 })).toEqual({
      maxBackends: 64,
      idleMs: 60_000
    })
  })

  it('keeps compatible values from the prior pool-limits.json format', () => {
    expect(parsePoolLimits('{"maxBackends":5,"idleMs":900000}')).toEqual({
      maxBackends: 5,
      idleMs: 900_000
    })
  })

  it.each([null, '', '{', '[]', '"bad"'])('uses defaults for unreadable settings: %s', value => {
    expect(parsePoolLimits(value)).toEqual(POOL_LIMITS_DEFAULTS)
  })
})

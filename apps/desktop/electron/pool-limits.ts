/** Device-local limits for speculative profile gateway connections. */
export interface PoolLimits {
  /** Maximum number of non-primary profile connections to keep open. */
  maxBackends: number
  /** Idle lifetime of a secondary profile connection, in milliseconds. */
  idleMs: number
}

export const POOL_LIMITS_DEFAULTS: PoolLimits = {
  maxBackends: 3,
  idleMs: 10 * 60_000
}

export const POOL_LIMITS_BOUNDS = {
  maxBackendsMin: 1,
  maxBackendsMax: 64,
  idleMsMin: 60_000,
  idleMsMax: 7 * 24 * 60 * 60_000
} as const

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : fallback
}

export function clampPoolLimits(raw: Partial<PoolLimits>): PoolLimits {
  return {
    maxBackends: boundedInteger(
      raw?.maxBackends,
      POOL_LIMITS_DEFAULTS.maxBackends,
      POOL_LIMITS_BOUNDS.maxBackendsMin,
      POOL_LIMITS_BOUNDS.maxBackendsMax
    ),
    idleMs: boundedInteger(
      raw?.idleMs,
      POOL_LIMITS_DEFAULTS.idleMs,
      POOL_LIMITS_BOUNDS.idleMsMin,
      POOL_LIMITS_BOUNDS.idleMsMax
    )
  }
}

export function parsePoolLimits(json: string | null | undefined): PoolLimits {
  if (!json) {
    return { ...POOL_LIMITS_DEFAULTS }
  }

  try {
    const parsed: unknown = JSON.parse(json)

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...POOL_LIMITS_DEFAULTS }
    }

    return clampPoolLimits(parsed as Partial<PoolLimits>)
  } catch {
    return { ...POOL_LIMITS_DEFAULTS }
  }
}

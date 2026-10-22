/** Device-local profile-connection limits shared with Electron main. */

import { atom } from 'nanostores'

import { clampPoolLimits, POOL_LIMITS_DEFAULTS, type PoolLimits } from '../../electron/pool-limits'

export { clampPoolLimits, POOL_LIMITS_BOUNDS, POOL_LIMITS_DEFAULTS } from '../../electron/pool-limits'
export type { PoolLimits } from '../../electron/pool-limits'

export const $poolLimits = atom<PoolLimits>({ ...POOL_LIMITS_DEFAULTS })

/** Navigation intent consumed by the shell, which owns React Router. */
export const $poolLimitsSettingsRequest = atom(0)

export function requestPoolLimitsSettings(): void {
  $poolLimitsSettingsRequest.set($poolLimitsSettingsRequest.get() + 1)
}

/** Read the device-local preference owned by Electron main. */
export async function loadPoolLimits(): Promise<void> {
  try {
    const limits = await window.hermesDesktop?.getPoolLimits?.()

    if (limits) {
      $poolLimits.set(clampPoolLimits(limits))
    }
  } catch {
    // Keep the last known values; a later settings visit can retry.
  }
}

/** Save through Electron main and adopt its clamped, persisted values. */
export async function savePoolLimits(next: { maxBackends?: number; idleMs?: number }): Promise<void> {
  const current = $poolLimits.get()
  const optimistic = clampPoolLimits({ ...current, ...next })
  const setPoolLimits = window.hermesDesktop?.setPoolLimits

  if (!setPoolLimits) {
    throw new Error('Desktop pool settings are unavailable')
  }

  $poolLimits.set(optimistic)

  try {
    const result = await setPoolLimits(next)

    if (!result?.limits) {
      throw new Error('Desktop pool settings were not saved')
    }

    $poolLimits.set(clampPoolLimits(result.limits))
  } catch {
    $poolLimits.set(current)
    throw new Error('Applying pool limits failed')
  }
}

if (typeof window !== 'undefined') {
  window.hermesDesktop?.onPoolLimitsChanged?.(limits => $poolLimits.set(clampPoolLimits(limits)))
  void loadPoolLimits()
}

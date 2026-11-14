import { INSTALL_STAMP, installShape, type InstallStamp } from './install-stamp'

export function clampBootProgress(value: unknown): number {
  const numeric = Number(value)

  if (!Number.isFinite(numeric)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(numeric)))
}

export function bootstrapSnapshot<State>(
  state: State,
  stamp: Readonly<InstallStamp> | null = INSTALL_STAMP
): State & { bundled: boolean } {
  return { ...state, bundled: installShape(stamp) === 'bundled' }
}

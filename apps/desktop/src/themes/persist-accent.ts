import { setAccentOverride } from './accent-override'
import { monoTheme } from './presets'

/** Aino retains its neutral palette when an older onboarding card submits an accent. */
export function persistAccent(_accent: null | string): void {
  setAccentOverride(null)
}

export const ownAccent = (): string => monoTheme.colors.primary

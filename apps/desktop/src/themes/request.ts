/** Compatibility entry for plugins; Aino Desktop only accepts its fixed palette. */

import { atom } from 'nanostores'

import { $pendingSkinApply } from './backend-sync'
import type { ThemeMode } from './context'
import { DEFAULT_SKIN_NAME } from './presets'

/** Return false for unsupported palettes without changing the appearance. */
export function requestTheme(name: string): boolean {
  if (name !== DEFAULT_SKIN_NAME) {
    return false
  }

  $pendingSkinApply.set(name)

  return true
}

/** One-shot light/dark/system switch the ThemeProvider drains through `setMode` (it clears this). */
export const $pendingModeApply = atom<null | ThemeMode>(null)

/** Ask for a mode switch from outside React; persisted per profile like a manual pick. */
export function requestMode(mode: ThemeMode): void {
  $pendingModeApply.set(mode)
}

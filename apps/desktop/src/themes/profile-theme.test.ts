import { beforeEach, describe, expect, it } from 'vitest'

import { modePref, skinPref } from './context'
import { DEFAULT_SKIN_NAME } from './presets'

// Brightness is per-profile; legacy palette assignments always resolve to Aino.
interface Pref {
  resolve: (profile: string) => string
  assign: (profile: string, value: string) => void
}

const cases = [
  { name: 'mode', pref: modePref as unknown as Pref, fallback: 'system', a: 'dark', b: 'light', junk: 'dusk' }
]

it('normalizes legacy palette assignments without overwriting unrelated storage', () => {
  window.localStorage.clear()
  window.localStorage.setItem('hermes-desktop-profile-themes-v1', JSON.stringify({ work: 'catppuccin' }))
  window.localStorage.setItem('hermes-desktop-theme-v2', 'everforest')
  expect(skinPref.resolve('work')).toBe(DEFAULT_SKIN_NAME)
  expect(skinPref.resolve('default')).toBe(DEFAULT_SKIN_NAME)
  expect(window.localStorage.getItem('hermes-desktop-theme-v2')).toBe('everforest')
})

describe.each(cases)('per-profile $name', ({ pref, fallback, a, b, junk }) => {
  beforeEach(() => window.localStorage.clear())

  it('falls back to the default when unassigned', () => {
    expect(pref.resolve('default')).toBe(fallback)
    expect(pref.resolve('work')).toBe(fallback)
  })

  it('keeps each profile on its own value', () => {
    pref.assign('work', a)
    pref.assign('default', b)
    expect(pref.resolve('work')).toBe(a)
    expect(pref.resolve('default')).toBe(b)
  })

  it('lets unassigned profiles inherit the default profile as the global fallback', () => {
    pref.assign('default', a)
    expect(pref.resolve('never-themed')).toBe(a)
  })

  it('normalizes an unknown stored value back to the default', () => {
    pref.assign('work', junk)
    expect(pref.resolve('work')).toBe(fallback)
  })
})

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { registerLayoutPresets } from '@/app/contrib/layout-presets'
import { $activePresetId } from '@/components/pane-shell/tree/store'
import { $pendingSkinApply } from '@/themes/backend-sync'
import { $pendingModeApply } from '@/themes/request'

import { applyAppearance } from './appearance-apply'
import { $interfaceMode, setInterfaceMode } from './interface-mode'

describe('applyAppearance', () => {
  beforeAll(() => {
    registerLayoutPresets()
  })

  afterEach(() => {
    $pendingSkinApply.set(null)
    $pendingModeApply.set(null)
  })

  it('applies every value and reports the ids the agent reads', () => {
    setInterfaceMode('simple')

    expect(applyAppearance({ accent: 'mono', layout: 'terminal-deck', mode: 'dark' })).toEqual({
      applied: { accent: 'mono', layout: 'terminal-deck', mode: 'dark' },
      success: true
    })
    expect($pendingSkinApply.get()).toBeNull()
    expect($pendingModeApply.get()).toBe('dark')
    expect($activePresetId.get()).toBe('terminal-deck')
    expect($interfaceMode.get()).toBe('advanced')
  })

  it('applies nothing when one value is unknown, and names what exists', () => {
    const answer = applyAppearance({ accent: 'mono', layout: 'cockpit' })

    expect(answer.success).toBe(false)
    expect(!answer.success && answer.available).toEqual(expect.arrayContaining(['sidebar-left', 'terminal-deck']))
    expect($pendingSkinApply.get()).toBeNull()
  })
})

it('rejects a color change atomically while retaining Aino brightness and layout', () => {
  $pendingModeApply.set(null)
  const layout = $activePresetId.get()
  expect(applyAppearance({ accent: 'violet', mode: 'dark', layout: 'terminal-deck' })).toEqual({
    available: ['mono', 'theme'],
    error: 'Aino uses a fixed neutral palette.',
    success: false
  })
  expect($pendingModeApply.get()).toBeNull()
  expect($activePresetId.get()).toBe(layout)
})

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'

import { __resetBackendSkinSync } from './backend-sync'
import { modePref, skinPref, ThemeProvider, useTheme } from './context'
import { midnightTheme } from './presets'
import { requestMode, requestTheme } from './request'
import type { DesktopTheme } from './types'
import { THEMES_AREA } from './user-themes'

const cssVar = (name: string) => window.document.documentElement.style.getPropertyValue(name)

describe('requestTheme', () => {
  let ctx: ReturnType<typeof useTheme>

  function Probe() {
    ctx = useTheme()

    return null
  }

  const renderProbe = () =>
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )

  beforeEach(() => {
    window.localStorage.clear()
    __resetBackendSkinSync()
  })

  afterEach(cleanup)

  it('accepts the fixed palette without overwriting a legacy assignment', () => {
    window.localStorage.setItem('hermes-desktop-theme-v2', 'everforest')
    renderProbe()

    let accepted = false
    act(() => {
      accepted = requestTheme('mono')
    })

    expect(accepted).toBe(true)
    expect(ctx.themeName).toBe('mono')
    expect(window.localStorage.getItem('hermes-desktop-theme-v2')).toBe('everforest')
  })

  // Plugin requests must obey the same fixed-palette policy as React callers.
  it('refuses alternate built-in palettes without changing the current appearance', () => {
    renderProbe()

    let accepted = true
    act(() => {
      accepted = requestTheme('midnight')
    })

    expect(accepted).toBe(false)
    expect(skinPref.resolve('default')).toBe('mono')
  })

  it('switches and persists light/dark from outside React', () => {
    renderProbe()

    act(() => requestMode('dark'))

    expect(ctx.mode).toBe('dark')
    expect(modePref.resolve('default')).toBe('dark')
  })

  it('refuses a name that does not resolve, leaving the appearance untouched', () => {
    renderProbe()

    act(() => void requestTheme('mono'))
    const painted = cssVar('--theme-foreground')

    let accepted = true
    act(() => {
      accepted = requestTheme('a-theme-nobody-installed')
    })

    expect(accepted).toBe(false)
    expect(ctx.themeName).toBe('mono')
    expect(cssVar('--theme-foreground')).toBe(painted)
  })

  // Contributing an asset does not make it an available desktop palette.
  it('refuses an alternate palette contributed through the registry', () => {
    const zeus: DesktopTheme = { ...midnightTheme, description: 'Zeus', label: 'Zeus', name: 'zeus' }
    const dispose = registry.register({ area: THEMES_AREA, data: zeus, id: 'zeus' })

    renderProbe()

    let accepted = false
    act(() => {
      accepted = requestTheme('zeus')
    })

    expect(accepted).toBe(false)
    expect(ctx.themeName).toBe('mono')

    dispose()
  })
})

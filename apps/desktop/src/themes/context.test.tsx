import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { $activeGatewayProfile } from '@/store/profile'

import { __resetBackendSkinSync, ingestBackendSkin } from './backend-sync'
import { modePref, skinPref, ThemeProvider, useTheme } from './context'
import { monoTheme } from './presets'

// Backend skins can still change for CLI/TUI without recoloring the desktop.
const bloomberg = (foreground: string) => ({
  name: 'bloomberg',
  colors: { background: '#000000', ui_text: foreground, ui_accent: '#ff8000' }
})

const cssVar = (name: string) => window.document.documentElement.style.getPropertyValue(name)
const ACTIVE_PROFILE_KEY = 'hermes-desktop-active-profile-v1'

describe('fixed Aino appearance', () => {
  afterEach(() => {
    cleanup()
    $activeGatewayProfile.set('default')
    __resetBackendSkinSync()
  })

  it('uses the Aino palette for legacy skin picks and backend changes without changing the brightness preference', () => {
    window.localStorage.clear()
    window.localStorage.setItem('hermes-desktop-theme-v2', 'everforest')
    window.localStorage.setItem('hermes-desktop-profile-themes-v1', JSON.stringify({ work: 'catppuccin' }))
    modePref.assign('default', 'light')
    modePref.assign('work', 'dark')
    $activeGatewayProfile.set('default')
    let ctx: ReturnType<typeof useTheme>

    function Probe() {
      ctx = useTheme()

      return null
    }

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(cssVar('--theme-background-seed')).toBe('#ffffff')
    expect(ctx!.themeName).toBe(monoTheme.name)
    expect(ctx!.mode).toBe('light')

    act(() => $activeGatewayProfile.set('work'))
    expect(ctx!.mode).toBe('dark')
    expect(cssVar('--theme-background-seed')).toBe(monoTheme.darkColors!.background)
    act(() => ingestBackendSkin(bloomberg('#ff9f0a'), { apply: true }))
    act(() => ctx!.setTheme('everforest'))
    expect(ctx!.themeName).toBe(monoTheme.name)
    expect(ctx!.mode).toBe('dark')
    expect(cssVar('--theme-foreground')).toBe(monoTheme.darkColors!.foreground)

    act(() => ingestBackendSkin({ name: 'mono', colors: {} }, { apply: true }))
    expect(JSON.parse(window.localStorage.getItem('hermes-desktop-profile-themes-v1')!)).toEqual({
      work: 'catppuccin'
    })

    act(() => ctx!.setMode('system'))
    expect(modePref.resolve('work')).toBe('system')
    expect(modePref.resolve('default')).toBe('light')
  })
})

describe('ThemeProvider profile authority', () => {
  beforeEach(() => {
    window.localStorage.clear()
    $activeGatewayProfile.set('default')
    skinPref.assign('default', 'mono')
    modePref.assign('default', 'light')
    skinPref.assign('work', 'everforest')
    modePref.assign('work', 'dark')
    window.localStorage.setItem(ACTIVE_PROFILE_KEY, 'work')
  })

  afterEach(() => {
    cleanup()
    $activeGatewayProfile.set('default')
  })

  it('keeps a gatewayless auxiliary surface on the remembered profile and follows peer storage changes', () => {
    let ctx: ReturnType<typeof useTheme>

    function Probe() {
      ctx = useTheme()

      return null
    }

    render(
      <ThemeProvider auxiliary>
        <Probe />
      </ThemeProvider>
    )

    expect(ctx!.themeName).toBe('mono')
    expect(ctx!.mode).toBe('dark')
    expect(window.localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe('work')

    act(() => {
      modePref.assign('work', 'light')
      window.dispatchEvent(new StorageEvent('storage', { key: 'hermes-desktop-profile-modes-v1' }))
    })

    expect(ctx!.themeName).toBe('mono')
    expect(ctx!.mode).toBe('light')

    act(() => {
      window.localStorage.setItem(ACTIVE_PROFILE_KEY, 'default')
      window.dispatchEvent(new StorageEvent('storage', { key: ACTIVE_PROFILE_KEY }))
    })

    expect(ctx!.themeName).toBe('mono')
    expect(ctx!.mode).toBe('light')
    expect(window.localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe('default')
  })

  it('keeps the normal provider authoritative for the actual gateway profile', () => {
    act(() => $activeGatewayProfile.set('work'))

    let ctx: ReturnType<typeof useTheme>

    function Probe() {
      ctx = useTheme()

      return null
    }

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )

    expect(ctx!.themeName).toBe('mono')
    expect(ctx!.mode).toBe('dark')
    expect(window.localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe('work')
  })
})

describe('ThemeProvider highlight preview', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetBackendSkinSync()
    modePref.assign('default', 'light')
  })

  afterEach(cleanup)

  // Read the live context so the tests drive the real provider, not a mock.
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

  it('previews brightness without persisting it, then restores the committed mode', () => {
    renderProbe()
    const committed = cssVar('--theme-background-seed')
    act(() => ctx.previewTheme(ctx.themeName, 'dark'))
    expect(cssVar('--theme-background-seed')).toBe(monoTheme.darkColors!.background)
    expect(ctx.mode).toBe('light')
    expect(modePref.resolve('default')).toBe('light')

    act(() => ctx.clearThemePreview())
    expect(cssVar('--theme-background-seed')).toBe(committed)
  })

  it('commits brightness and keeps it after the preview is cleared', () => {
    renderProbe()
    act(() => ctx.previewTheme(ctx.themeName, 'dark'))
    act(() => ctx.setMode('dark'))
    act(() => ctx.clearThemePreview())

    expect(ctx.mode).toBe('dark')
    expect(modePref.resolve('default')).toBe('dark')
    expect(cssVar('--theme-background-seed')).toBe(monoTheme.darkColors!.background)
  })

  it('ignores a preview of an alternate or unknown palette', () => {
    renderProbe()

    const painted = cssVar('--theme-foreground')

    act(() => ctx.previewTheme('everforest', 'dark'))
    expect(cssVar('--theme-foreground')).toBe(painted)
    act(() => ctx.previewTheme('does-not-exist', 'dark'))
    expect(cssVar('--theme-foreground')).toBe(painted)
  })
})

describe('Aino boot-failure palette', () => {
  afterEach(cleanup)

  it('persists the same palette the fixed desktop paints', () => {
    window.localStorage.clear()
    $activeGatewayProfile.set('default')
    modePref.assign('default', 'dark')
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>
    )

    const snapshot = JSON.parse(window.localStorage.getItem('hermes-boot-palette')!)
    expect(snapshot).toEqual({
      background: window.localStorage.getItem('aino-boot-background-v1'),
      foreground: cssVar('--theme-foreground'),
      accent: cssVar('--theme-midground'),
      accentForeground: cssVar('--dt-midground-foreground')
    })
  })
})

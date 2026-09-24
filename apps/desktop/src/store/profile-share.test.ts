import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'
import type { DesktopTheme } from '@/themes/types'
import type { ProfileDesktopOverlay } from '@/types/hermes'

// Keep side-effecting transitive imports inert (gateway sockets, REST).
vi.mock('@/store/gateway', async () => {
  const { atom } = await import('nanostores')

  return {
    $gateway: atom<unknown>(null),
    ensureGatewayForProfile: vi.fn(async () => undefined),
    openGatewayForProfile: vi.fn(async () => undefined)
  }
})
vi.mock('@/hermes', () => ({
  exportProfileArchive: vi.fn(async () => ({ archive: '/tmp/out.tar.gz', ok: true })),
  getProfiles: vi.fn(async () => ({ profiles: [] })),
  importProfileArchive: vi.fn(async () => ({ desktop: null, name: 'imported', ok: true, path: '/tmp/p' })),
  setApiRequestProfile: vi.fn()
}))
vi.mock('@/lib/query-client', () => ({ invalidateProfileScopedQueries: vi.fn() }))
vi.mock('@/store/starmap', () => ({ resetStarmapGraph: vi.fn() }))

const { applyDesktopOverlay, buildDesktopOverlay, exportProfileBundle, runExportProfileFlow } =
  await import('./profile-share')

const { $profileColors, setProfileColor } = await import('./profile')
const { modePref, skinPref } = await import('@/themes/context')
const { $userThemes } = await import('@/themes/user-themes')
const { $layoutTree } = await import('@/components/pane-shell/tree/store')
const { exportProfileArchive } = await import('@/hermes')

// isValidTheme only requires background/foreground/primary at runtime; the
// static type wants the full palette, hence the cast.
const roseTheme = {
  name: 'rose-quartz',
  label: 'Rose Quartz',
  description: 'test theme',
  colors: { background: '#fff0f5', foreground: '#221122', primary: '#e91e63' }
} as unknown as DesktopTheme

beforeEach(() => {
  window.localStorage.clear()
  $userThemes.set({})
  $profileColors.set({})
  setRuntimeI18nLocale('en')
})

afterEach(() => {
  vi.clearAllMocks()
  setRuntimeI18nLocale('en')
})

describe('buildDesktopOverlay', () => {
  it('snapshots skin, mode, rail color, and the layout tree for the profile', () => {
    skinPref.assign('glam', 'mono')
    modePref.assign('glam', 'dark')
    setProfileColor('glam', '#e91e63')

    const overlay = buildDesktopOverlay('glam')

    expect(overlay.version).toBe(1)
    expect(overlay.skin).toBe('mono')
    expect(overlay.mode).toBe('dark')
    expect(overlay.profileColor).toBe('#e91e63')
    // Built-in skin → no bundled theme definitions.
    expect(overlay.themes).toBeUndefined()
  })

  it('exports the fixed desktop palette without bundling an inactive legacy theme', () => {
    $userThemes.set({ 'rose-quartz': roseTheme })
    window.localStorage.setItem('hermes-desktop-profile-themes-v1', JSON.stringify({ glam: 'rose-quartz' }))

    const overlay = buildDesktopOverlay('glam')

    expect(overlay.skin).toBe('mono')
    expect(overlay.themes).toBeUndefined()
    expect($userThemes.get()['rose-quartz']).toEqual(roseTheme)
  })
})

describe('applyDesktopOverlay', () => {
  it('ignores bundled legacy palettes while importing brightness and profile color', () => {
    applyDesktopOverlay('glam-copy', {
      version: 1,
      skin: 'rose-quartz',
      mode: 'dark',
      themes: { 'rose-quartz': roseTheme },
      profileColor: '#e91e63'
    })

    expect($userThemes.get()).toEqual({})
    expect(skinPref.resolve('glam-copy')).toBe('mono')
    expect(modePref.resolve('glam-copy')).toBe('dark')
    expect($profileColors.get()['glam-copy']).toBe('#e91e63')
  })

  it('ignores a skin that resolves to nothing and junk layout trees', () => {
    const before = $layoutTree.get()

    applyDesktopOverlay('glam-copy', {
      skin: 'no-such-skin',
      layoutTree: { bogus: true }
    } as ProfileDesktopOverlay)

    // Unresolvable skin → pref falls back to the default resolution.
    expect(skinPref.resolve('glam-copy')).toBe(skinPref.resolve('some-unassigned'))
    expect($layoutTree.get()).toBe(before)
  })

  it('is a no-op for a plain CLI archive (no overlay)', () => {
    expect(() => applyDesktopOverlay('glam-copy', null)).not.toThrow()
    expect(() => applyDesktopOverlay('glam-copy', undefined)).not.toThrow()
  })
})

describe('exportProfileBundle', () => {
  it('stages desktop.json into the archive through extra_files', async () => {
    skinPref.assign('glam', 'mono')

    const archive = await exportProfileBundle('glam', '/tmp/glam.tar.gz')

    expect(archive).toBe('/tmp/out.tar.gz')
    const call = vi.mocked(exportProfileArchive).mock.calls[0]
    expect(call[0]).toBe('glam')
    const overlay = JSON.parse(call[1]?.extraFiles?.['desktop.json'] ?? '{}') as ProfileDesktopOverlay
    expect(overlay.skin).toBe('mono')
    expect(call[1]?.output).toBe('/tmp/glam.tar.gz')
  })

  it('localizes the native archive filter without changing its extensions', async () => {
    const selectSavePath = vi.fn(async () => '/tmp/glam.tar.gz')

    ;(window as unknown as { hermesDesktop: { selectSavePath: typeof selectSavePath } }).hermesDesktop = {
      selectSavePath
    }
    setRuntimeI18nLocale('zh')

    await runExportProfileFlow('glam')

    expect(selectSavePath).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ extensions: ['tar.gz', 'tgz'], name: 'Aino 工作区' }]
      })
    )
  })
})

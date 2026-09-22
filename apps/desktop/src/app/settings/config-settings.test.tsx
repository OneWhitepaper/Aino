import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { createRef } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ConfigApi from '@/api/config'

import type { ConfigSettings as ConfigSettingsType } from './config-settings'

const getHermesConfigRecord = vi.fn()
const getHermesConfigSchema = vi.fn()
const saveHermesConfig = vi.fn()
const getElevenLabsVoices = vi.fn()

// Keep the real read-origin helpers (WeakMap peek/bind) live: the shared
// config hook reaches them through the barrel, and a bare mock would throw.
vi.mock('@/hermes', async () => ({
  ...(await vi.importActual<typeof ConfigApi>('@/api/config')),
  getHermesConfigRecord: () => getHermesConfigRecord(),
  getHermesConfigSchema: () => getHermesConfigSchema(),
  saveHermesConfig: (config: unknown, profile?: string) => saveHermesConfig(config, profile),
  getElevenLabsVoices: () => getElevenLabsVoices(),
  setApiRequestProfile: () => {}
}))

vi.mock('../hooks/use-on-profile-switch', () => ({
  useOnProfileSwitch: () => {}
}))

// The real stores pull in the gateway/profile stack, which needs a live
// backend connection. This page only reads the "applies to" scope override
// and the repo-discovery signature, neither of which this test touches. The
// scope chip it renders also reads the selected profile and the loud-note
// selector, so those are stubbed to the single-profile default shape.
vi.mock('@/store/settings-scope', () => ({
  $settingsRequestProfile: atom<string | undefined>(undefined),
  $settingsScopeEditsNonDefault: atom(false),
  $settingsScopeOverride: atom<null | string>(null),
  $settingsScopeProfile: atom<string>('default')
}))

vi.mock('@/store/projects', () => ({
  repoDiscoveryPolicyFromConfig: () => ({ enabled: true, roots: [], exclude_paths: [] }),
  repoDiscoveryPolicySignature: (policy: unknown) => JSON.stringify(policy),
  scanAndRecordRepos: vi.fn().mockResolvedValue(undefined)
}))

// The module graph behind ConfigSettings is large (1.5s cold here, >10s on a
// saturated CI runner); load it once under the hook timeout so the 15s test
// budget is spent on the autosave behaviour, not on transform + import.
let ConfigSettings: typeof ConfigSettingsType

beforeAll(async () => {
  ;({ ConfigSettings } = await import('./config-settings'))
}, 60_000)

beforeEach(() => {
  getElevenLabsVoices.mockResolvedValue({ available: false })
  getHermesConfigSchema.mockResolvedValue({ fields: {} })
  saveHermesConfig.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function LocationProbe() {
  return <output data-testid="settings-location">{useLocation().search}</output>
}

function renderConfigSettings(activeSectionId = 'safety', route = '/settings') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const importInputRef = createRef<HTMLInputElement>()

  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <LocationProbe />
      <QueryClientProvider client={client}>
        <ConfigSettings activeSectionId={activeSectionId} importInputRef={importInputRef} />
      </QueryClientProvider>
    </MemoryRouter>
  )

  return { importInputRef, ...result }
}

describe('ConfigSettings autosave', () => {
  it('shows every group in a category while locating and editing a legacy field link', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    getHermesConfigRecord.mockResolvedValue({
      memory: { memory_enabled: true },
      compression: { enabled: true }
    })
    getHermesConfigSchema.mockResolvedValue({
      fields: {
        'memory.memory_enabled': { type: 'boolean' },
        'compression.enabled': { type: 'boolean' }
      }
    })

    const { container } = renderConfigSettings(
      'memory',
      '/settings?tab=config:memory&page=context&field=compression.enabled'
    )

    expect(await screen.findByText('Persistent memory')).toBeTruthy()
    expect(screen.getByText('Context & compression')).toBeTruthy()
    expect(screen.getAllByRole('switch')).toHaveLength(2)

    const target = container.querySelector<HTMLElement>('[id="setting-field-compression.enabled"]')!
    await waitFor(() => expect(target.ownerDocument.activeElement).toBe(target))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(new URLSearchParams(screen.getByTestId('settings-location').textContent ?? '').has('field')).toBe(false)

    fireEvent.click(within(target).getByRole('switch'))

    await waitFor(() => expect(saveHermesConfig).toHaveBeenCalledWith({ compression: { enabled: false } }, undefined))
  })

  it('renders and saves the Codex compression auto-raise setting', async () => {
    getHermesConfigRecord.mockResolvedValue({
      compression: { codex_gpt55_autoraise: true }
    })
    getHermesConfigSchema.mockResolvedValue({
      fields: {
        'compression.codex_gpt55_autoraise': { type: 'boolean' }
      }
    })

    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      renderConfigSettings('memory')

      expect(await screen.findByText('Codex Compression Auto-Raise')).toBeTruthy()
      expect(screen.getByText('Raise compression to 85% for supported ChatGPT Codex OAuth models.')).toBeTruthy()

      screen.getByRole('switch').click()
      await vi.advanceTimersByTimeAsync(700)

      await vi.waitFor(() =>
        expect(saveHermesConfig).toHaveBeenCalledWith({ compression: { codex_gpt55_autoraise: false } }, undefined)
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends a later revert instead of diffing it away against the stale page-load baseline', async () => {
    getHermesConfigRecord.mockResolvedValue({ checkpoints: { enabled: false }, other: 'untouched' })

    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      renderConfigSettings()

      const toggle = await screen.findByRole('switch')

      // Edit: flip checkpoints.enabled on, let the debounced autosave fire.
      toggle.click()
      await vi.advanceTimersByTimeAsync(700)

      await vi.waitFor(() => expect(saveHermesConfig).toHaveBeenCalledTimes(1))
      expect(saveHermesConfig.mock.calls[0][0]).toEqual({ checkpoints: { enabled: true } })

      // Revert: flip it back to its original value and let autosave fire again.
      toggle.click()
      await vi.advanceTimersByTimeAsync(700)

      await vi.waitFor(() => expect(saveHermesConfig).toHaveBeenCalledTimes(2))
      // Must still explicitly send the reverted value — diffing against the
      // never-advanced page-load baseline would produce an empty patch here
      // (the field is back to its original value) and leave disk stuck at
      // `enabled: true` from the first save.
      expect(saveHermesConfig.mock.calls[1][0]).toEqual({ checkpoints: { enabled: false } })
    } finally {
      vi.useRealTimers()
    }
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { createRef } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import type * as ConfigApi from '@/api/config'

import type { ConfigSettings as ConfigSettingsType } from './config-settings'

const getRecord = vi.fn()
const saveConfig = vi.fn()

vi.mock('@/hermes', async () => ({
  ...(await vi.importActual<typeof ConfigApi>('@/api/config')),
  profileScopeKey: (scope?: unknown) => (typeof scope === 'string' && scope.trim()) || 'default',
  getHermesConfigRecord: () => getRecord(),
  getHermesConfigSchema: () => Promise.resolve({ fields: { 'display.show_reasoning': { type: 'boolean' } } }),
  saveHermesConfig: (record: unknown, profile: unknown) => saveConfig(record, profile),
  getElevenLabsVoices: () => Promise.resolve({ available: false }),
  getProfiles: () => Promise.resolve({ profiles: [] }),
  setApiRequestProfile: () => {}
}))
vi.mock('../hooks/use-on-profile-switch', () => ({ useOnProfileSwitch: () => {} }))
vi.mock('@/store/settings-scope', () => ({
  $settingsRequestProfile: atom('default'),
  $settingsScopeEditsNonDefault: atom(false),
  $settingsScopeOverride: atom(null),
  $settingsScopeProfile: atom('default')
}))
vi.mock('@/store/projects', () => ({
  $worktreeRefreshToken: atom(0),
  repoDiscoveryPolicyFromConfig: () => ({}),
  repoDiscoveryPolicySignature: () => '',
  scanAndRecordRepos: vi.fn().mockResolvedValue(undefined)
}))

let ConfigSettings: typeof ConfigSettingsType

beforeAll(async () => {
  ;({ ConfigSettings } = await import('./config-settings'))
}, 60_000)
beforeEach(() => {
  saveConfig.mockResolvedValue({ ok: true })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderChat() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ConfigSettings activeSectionId="chat" importInputRef={createRef<HTMLInputElement>()} subpage="behavior" />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

it('shows the effective local reasoning setting and changes both local and global keys', async () => {
  getRecord.mockResolvedValue({
    display: {
      show_reasoning: true,
      platforms: { cli: { show_reasoning: false }, telegram: { show_reasoning: false } }
    }
  })
  renderChat()
  const toggle = await screen.findByRole('switch')
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(toggle)
  await waitFor(() =>
    expect(saveConfig).toHaveBeenCalledWith({ display: { platforms: { cli: { show_reasoning: true } } } }, 'default')
  )
})

it('writes the local key when a global-only reasoning preference is changed', async () => {
  getRecord.mockResolvedValue({ display: { show_reasoning: true } })
  renderChat()
  const toggle = await screen.findByRole('switch')
  fireEvent.click(toggle)
  await waitFor(() =>
    expect(saveConfig).toHaveBeenCalledWith(
      { display: { show_reasoning: false, platforms: { cli: { show_reasoning: false } } } },
      'default'
    )
  )
})

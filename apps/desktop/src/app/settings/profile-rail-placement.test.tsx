import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { atom } from 'nanostores'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as BillingState from './billing/use-billing-state'

import { SettingsView } from './index'

vi.mock('@/hermes', () => ({
  getHermesConfigDefaults: vi.fn(),
  getHermesConfigRecord: vi.fn(),
  getProfileSoul: vi.fn(async () => ({ content: '' })),
  saveHermesConfig: vi.fn(),
  updateProfileSoul: vi.fn()
}))

vi.mock('@/store/connections', () => ({
  $activeConnectionId: atom(null),
  $connectionsRegistry: atom(null),
  $hasMultipleConnections: atom(false),
  selectConnection: vi.fn()
}))

vi.mock('@/store/profile', () => ({
  $activeGatewayProfile: atom('default'),
  $profileColors: atom({}),
  $profileCreateRequest: atom(0),
  $profileOrder: atom([]),
  $profiles: atom([{ is_default: true, name: 'default' }]),
  $profileScope: atom('default'),
  ALL_PROFILES: '*',
  normalizeProfileKey: (name: string) => name,
  profileLabel: (profile: { display_name?: string; name: string }) =>
    (profile.display_name ?? '').trim() || profile.name,
  refreshActiveProfile: vi.fn(async () => undefined),
  selectProfile: vi.fn(),
  setProfileColor: vi.fn(),
  setProfileOrder: vi.fn(),
  setShowAllProfiles: vi.fn(),
  sortByProfileOrder: (profiles: unknown[]) => profiles
}))

vi.mock('@/store/profile-remote-override', () => ({
  $profileRemoteOverrides: atom({}),
  openRemoteOverrideDialog: vi.fn(),
  refreshProfileRemoteOverrides: vi.fn(async () => undefined)
}))

vi.mock('@/store/profile-share', () => ({
  runExportProfileFlow: vi.fn(),
  runImportProfileFlow: vi.fn()
}))

vi.mock('../chat/sidebar/use-fleet-roster', () => ({ useFleetRoster: () => undefined }))
vi.mock('../chat/sidebar/use-profile-prewarm', () => ({
  useProfilePrewarm: () => ({ cancelPrewarm: vi.fn(), startPrewarm: vi.fn() })
}))
vi.mock('../chat/sidebar/use-profile-rail-refresh-on-active', () => ({
  useProfileRailRefreshOnActive: () => undefined
}))

vi.mock('@/components/chat/code-editor', () => ({ CodeEditor: () => null }))
vi.mock('../profiles/create-profile-dialog', () => ({ CreateProfileDialog: () => null }))
vi.mock('../profiles/delete-profile-dialog', () => ({ DeleteProfileDialog: () => null }))
vi.mock('../profiles/rename-profile-dialog', () => ({ RenameProfileDialog: () => null }))
vi.mock('../chat/sidebar/profile-remote-override-dialog', () => ({ ProfileRemoteOverrideDialog: () => null }))

vi.mock('./about-settings', () => ({ AboutSettings: () => null }))
vi.mock('./account-settings', () => ({ AccountSettings: () => <div data-testid="account-settings" /> }))
vi.mock('./appearance-settings', () => ({ AppearanceSettings: () => null }))
vi.mock('./billing', () => ({ BILLING_VIEWS: ['overview', 'plans'], BillingSettings: () => null }))
vi.mock('./billing/use-billing-state', async importOriginal => ({
  ...(await importOriginal<typeof BillingState>()),
  useBillingState: () => ({ data: undefined }),
  useSubscriptionState: () => ({ data: undefined })
}))
vi.mock('./config-settings', () => ({
  ConfigSettings: ({ activeSectionId, subpage }: { activeSectionId: string; subpage?: string }) => (
    <div data-section={activeSectionId} data-subpage={subpage ?? ''} data-testid="config-settings" />
  )
}))
vi.mock('./gateway-settings', () => ({ GatewaySettings: () => null }))
vi.mock('./keybind-settings', () => ({ KeybindSettings: () => null }))
vi.mock('./keys-settings', () => ({ KEYS_VIEWS: ['tools', 'settings'], KeysSettings: () => null }))
vi.mock('./notifications-settings', () => ({ NotificationsSettings: () => null }))
vi.mock('./plugins-settings', () => ({ PluginsSettings: () => null }))
vi.mock('./providers-settings', () => ({
  PROVIDER_VIEWS: ['accounts', 'keys', 'custom-endpoints'],
  ProvidersSettings: ({ view }: { view: string }) => <div data-testid="providers-settings">{view}</div>
}))
vi.mock('./sessions-settings', () => ({ SessionsSettings: () => null }))
vi.mock('./system-resources-settings', () => ({ SystemResourcesSettings: () => null }))
vi.mock('./system-status-controls', () => ({ SettingsSystemControls: () => null }))

afterEach(cleanup)

function LocationProbe() {
  const { search } = useLocation()

  return <output data-testid="settings-location">{search}</output>
}

describe('Settings profile controls placement', () => {
  it('keeps workspace management in the main sidebar instead of settings navigation', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/settings?tab=about']}>
        <SettingsView
          onClose={vi.fn()}
          onOpenCommandCenter={vi.fn()}
          onOpenCommandCenterSection={vi.fn()}
          requestGateway={vi.fn()}
        />
      </MemoryRouter>
    )

    const settingsNav = container.querySelector<HTMLElement>('[data-settings-workspace] [data-tour="overlay-nav"]')!

    expect(settingsNav?.querySelector('[data-slot="profile-rail"]')).toBeNull()
    expect(within(settingsNav).queryByRole('button', { name: 'Manage profiles…' })).toBeNull()
  })

  it('opens the account by default, uses category pages, and preserves provider subviews', () => {
    const view = render(
      <MemoryRouter initialEntries={['/settings']}>
        <LocationProbe />
        <SettingsView
          onClose={vi.fn()}
          onOpenCommandCenter={vi.fn()}
          onOpenCommandCenterSection={vi.fn()}
          requestGateway={vi.fn()}
        />
      </MemoryRouter>
    )

    expect(view.getByTestId('account-settings')).toBeTruthy()

    fireEvent.click(view.container.querySelector('[data-tour="nav-config:model"]')!)

    expect(view.getByTestId('config-settings').getAttribute('data-section')).toBe('model')
    expect(view.getByTestId('config-settings').getAttribute('data-subpage')).toBe('')
    expect(new URLSearchParams(view.getByTestId('settings-location').textContent ?? '').has('page')).toBe(false)
    expect(view.container.querySelector('[data-tour="nav-toggle-config:model"]')).toBeNull()
    fireEvent.click(view.container.querySelector('[data-tour="nav-providers"]')!)

    expect(view.container.querySelector('[data-tour="nav-providers"]')?.getAttribute('data-active')).toBe('true')
    expect(view.getByTestId('providers-settings').textContent).toBe('accounts')

    fireEvent.click(view.container.querySelector('[data-tour="nav-pview:custom-endpoints"]')!)

    expect(view.getByTestId('providers-settings').textContent).toBe('custom-endpoints')
    const params = new URLSearchParams(view.getByTestId('settings-location').textContent ?? '')
    expect(params.get('pview')).toBe('custom-endpoints')
    expect(params.has('page')).toBe(false)
    expect(params.has('field')).toBe(false)
  })
})

import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $activeConnectionId } from '@/store/connections'

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
  refreshProfiles: vi.fn(async () => undefined),
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
vi.mock('./contributed-status-settings', () => ({ ContributedStatusSettings: () => null }))
vi.mock('./config-settings', () => ({
  ConfigSettings: ({
    activeSectionId,
    afterContent,
    subpage,
    importFile,
    onImportConsumed
  }: {
    activeSectionId: string
    afterContent?: ReactNode
    subpage?: string
    importFile?: File
    onImportConsumed?: (file: File) => void
  }) => (
    <div data-section={activeSectionId} data-subpage={subpage ?? ''} data-testid="config-settings">
      {afterContent}
      {importFile && <button onClick={() => onImportConsumed?.(importFile)}>Consume {importFile.name}</button>}
    </div>
  )
}))
vi.mock('./gateway-settings', () => ({ GatewaySettings: () => null }))
vi.mock('./keybind-settings', () => ({ KeybindSettings: () => null }))
vi.mock('./keys-settings', () => ({
  KEYS_VIEWS: ['tools', 'settings'],
  KeysSettings: ({ embedded, view }: { embedded?: boolean; view: string }) => (
    <div data-embedded={embedded ? 'true' : 'false'} data-testid="keys-settings" data-view={view} />
  )
}))
vi.mock('./notifications-settings', () => ({ NotificationsSettings: () => null }))
vi.mock('./plugins-settings', () => ({ PluginsSettings: () => null }))
vi.mock('./providers-settings', () => ({
  PROVIDER_VIEWS: ['third-party', 'custom-endpoints', 'local'],
  ProvidersSettings: ({ view }: { view: string }) => <div data-testid="providers-settings">{view}</div>
}))
vi.mock('./sessions-settings', () => ({ SessionsSettings: () => null }))
vi.mock('./system-status-controls', () => ({ SettingsSystemControls: () => null }))
vi.mock('./vault-settings', () => ({
  vaultOwnerKey: (connectionId: string | null, profile: string) => `${connectionId ?? ''}::${profile}`,
  VaultSettings: ({ defaultExpanded, embedded }: { defaultExpanded?: boolean; embedded?: boolean }) => (
    <div
      data-default-expanded={defaultExpanded ? 'true' : 'false'}
      data-embedded={embedded ? 'true' : 'false'}
      data-testid="vault-settings"
    />
  )
}))

afterEach(cleanup)

function LocationProbe() {
  const { search } = useLocation()

  return <output data-testid="settings-location">{search}</output>
}

describe('Settings profile controls placement', () => {
  it('hands an account-page import to Advanced and clears it after the existing importer consumes it', () => {
    const view = render(
      <MemoryRouter initialEntries={['/settings?tab=account']}>
        <LocationProbe />
        <SettingsView
          onClose={vi.fn()}
          onOpenCommandCenter={vi.fn()}
          onOpenCommandCenterSection={vi.fn()}
          requestGateway={vi.fn()}
        />
      </MemoryRouter>
    )

    const picker = view.container.querySelector<HTMLInputElement>('[data-settings-import-picker]')!
    fireEvent.change(picker, { target: { files: [new File(['{}'], 'handoff.json', { type: 'application/json' })] } })
    expect(view.getByTestId('config-settings').getAttribute('data-section')).toBe('advanced')
    fireEvent.click(view.getByRole('button', { name: 'Consume handoff.json' }))
    expect(view.queryByRole('button', { name: 'Consume handoff.json' })).toBeNull()
  })

  it('drops a selected configuration file when the connection changes', () => {
    const view = render(
      <MemoryRouter initialEntries={['/settings?tab=account']}>
        <SettingsView
          onClose={vi.fn()}
          onOpenCommandCenter={vi.fn()}
          onOpenCommandCenterSection={vi.fn()}
          requestGateway={vi.fn()}
        />
      </MemoryRouter>
    )

    const picker = view.container.querySelector<HTMLInputElement>('[data-settings-import-picker]')!
    fireEvent.change(picker, { target: { files: [new File(['{}'], 'handoff.json', { type: 'application/json' })] } })
    expect(view.getByRole('button', { name: 'Consume handoff.json' })).toBeTruthy()
    const connection = $activeConnectionId as unknown as { set: (value: string | null) => void }
    act(() => connection.set('other'))
    expect(view.queryByRole('button', { name: 'Consume handoff.json' })).toBeNull()
    act(() => connection.set(null))
  })

  it('removes standalone system resources and opens About for an existing resource bookmark', () => {
    const view = render(
      <MemoryRouter initialEntries={['/settings?tab=resources']}>
        <LocationProbe />
        <SettingsView
          onClose={vi.fn()}
          onOpenCommandCenter={vi.fn()}
          onOpenCommandCenterSection={vi.fn()}
          requestGateway={vi.fn()}
        />
      </MemoryRouter>
    )

    expect(view.container.querySelector('[data-tour="nav-resources"]')).toBeNull()
    expect(view.container.querySelector('[data-tour="nav-about"]')?.getAttribute('data-active')).toBe('true')
    expect(new URLSearchParams(view.getByTestId('settings-location').textContent ?? '').get('tab')).toBe('about')
  })

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

  it('opens the account by default, uses category pages, and gives model services one nav entry', () => {
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
    expect(view.container.querySelector('[data-tour="nav-billing"]')).toBeNull()

    fireEvent.click(view.container.querySelector('[data-tour="nav-config:model"]')!)

    expect(view.getByTestId('config-settings').getAttribute('data-section')).toBe('model')
    expect(view.getByTestId('config-settings').getAttribute('data-subpage')).toBe('')
    expect(new URLSearchParams(view.getByTestId('settings-location').textContent ?? '').has('page')).toBe(false)
    expect(view.container.querySelector('[data-tour="nav-toggle-config:model"]')).toBeNull()
    fireEvent.click(view.container.querySelector('[data-tour="nav-providers"]')!)

    expect(view.container.querySelector('[data-tour="nav-providers"]')?.getAttribute('data-active')).toBe('true')
    expect(view.getByTestId('providers-settings').textContent).toBe('custom-endpoints')
    expect(view.container.querySelector('[data-tour="nav-pview:accounts"]')).toBeNull()
    expect(view.container.querySelector('[data-tour="nav-pview:keys"]')).toBeNull()
    expect(view.container.querySelector('[data-tour="nav-pview:custom-endpoints"]')).toBeNull()
  })

  it.each(['third-party', 'custom-endpoints'])('keeps the %s model-service route addressable', providerView => {
    const view = render(
      <MemoryRouter initialEntries={[`/settings?tab=providers&pview=${providerView}`]}>
        <LocationProbe />
        <SettingsView
          onClose={vi.fn()}
          onOpenCommandCenter={vi.fn()}
          onOpenCommandCenterSection={vi.fn()}
          requestGateway={vi.fn()}
        />
      </MemoryRouter>
    )

    expect(view.getByTestId('providers-settings').textContent).toBe(providerView)
    expect(new URLSearchParams(view.getByTestId('settings-location').textContent ?? '').get('pview')).toBe(providerView)
  })

  it('redirects retired account and provider-key links to Model settings', () => {
    const view = render(
      <MemoryRouter initialEntries={['/settings?tab=providers&pview=accounts&key=OPENAI_API_KEY']}>
        <LocationProbe />
        <SettingsView
          onClose={vi.fn()}
          onOpenCommandCenter={vi.fn()}
          onOpenCommandCenterSection={vi.fn()}
          requestGateway={vi.fn()}
        />
      </MemoryRouter>
    )

    expect(view.getByTestId('config-settings').getAttribute('data-section')).toBe('model')
    const params = new URLSearchParams(view.getByTestId('settings-location').textContent ?? '')
    expect(params.get('tab')).toBe('config:model')
    expect(params.has('pview')).toBe(false)
    expect(params.has('key')).toBe(false)
  })

  it('merges Tools & Keys into Advanced and redirects existing keys links', () => {
    const view = render(
      <MemoryRouter initialEntries={['/settings?tab=keys&kview=settings&key=BRAVE_SEARCH']}>
        <LocationProbe />
        <SettingsView
          onClose={vi.fn()}
          onOpenCommandCenter={vi.fn()}
          onOpenCommandCenterSection={vi.fn()}
          requestGateway={vi.fn()}
        />
      </MemoryRouter>
    )

    expect(view.container.querySelector('[data-tour="nav-config:advanced"]')?.getAttribute('data-active')).toBe('true')
    expect(view.container.querySelector('[data-tour="nav-keys"]')).toBeNull()
    expect(view.getByTestId('config-settings').getAttribute('data-section')).toBe('advanced')
    expect(view.getByTestId('keys-settings').getAttribute('data-view')).toBe('all')
    expect(view.getByTestId('keys-settings').getAttribute('data-embedded')).toBe('true')

    const params = new URLSearchParams(view.getByTestId('settings-location').textContent ?? '')
    expect(params.get('tab')).toBe('config:advanced')
    expect(params.get('key')).toBe('BRAVE_SEARCH')
    expect(params.has('kview')).toBe(false)
  })

  it('merges Passwords & Logins into Safety and preserves vault deep links', () => {
    const view = render(
      <MemoryRouter initialEntries={['/settings?tab=vault&kind=login&label=github&origin=https%3A%2F%2Fgithub.com']}>
        <LocationProbe />
        <SettingsView
          onClose={vi.fn()}
          onOpenCommandCenter={vi.fn()}
          onOpenCommandCenterSection={vi.fn()}
          requestGateway={vi.fn()}
        />
      </MemoryRouter>
    )

    expect(view.container.querySelector('[data-tour="nav-config:safety"]')?.getAttribute('data-active')).toBe('true')
    expect(view.container.querySelector('[data-tour="nav-vault"]')).toBeNull()
    expect(view.getByTestId('config-settings').getAttribute('data-section')).toBe('safety')
    expect(view.getByTestId('vault-settings').getAttribute('data-embedded')).toBe('true')
    expect(view.getByTestId('vault-settings').getAttribute('data-default-expanded')).toBe('true')

    const params = new URLSearchParams(view.getByTestId('settings-location').textContent ?? '')
    expect(params.get('tab')).toBe('config:safety')
    expect(params.get('kind')).toBe('login')
    expect(params.get('label')).toBe('github')
    expect(params.get('origin')).toBe('https://github.com')
  })
})

it('keeps every existing settings destination addressable after regrouping', () => {
  const view = render(
    <MemoryRouter initialEntries={['/settings?tab=account']}>
      <SettingsView
        onClose={vi.fn()}
        onOpenCommandCenter={vi.fn()}
        onOpenCommandCenterSection={vi.fn()}
        requestGateway={vi.fn()}
      />
    </MemoryRouter>
  )

  const destinations = [
    'account',
    'config:appearance',
    'notifications',
    'keybinds',
    'config:model',
    'config:chat',
    'config:memory',
    'config:voice',
    'sessions',
    'config:workspace',
    'config:browser',
    'providers',
    'gateway',
    'plugins',
    'config:safety',
    'config:advanced',
    'about'
  ]

  const nav = view.container.querySelector('[data-aino-overlay-nav]')!

  expect(nav.querySelectorAll('[data-overlay-nav-section]')).toHaveLength(4)

  for (const destination of destinations) {
    const button = nav.querySelector<HTMLElement>('[data-tour="nav-' + destination + '"]')!
    expect(button).toBeTruthy()
    fireEvent.click(button)
    expect(button.getAttribute('aria-current')).toBe('page')
    expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  }
})

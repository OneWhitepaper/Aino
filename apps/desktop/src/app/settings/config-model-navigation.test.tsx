import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { createRef, type ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigSettings } from './config-settings'

const api = vi.hoisted(() => ({
  read: vi.fn(),
  schema: vi.fn(),
  save: vi.fn()
}))

vi.mock('@/hermes', async () => ({
  ...(await vi.importActual('@/api/config')),
  profileScopeKey: (scope?: unknown) => (typeof scope === 'string' && scope.trim()) || 'default',
  getHermesConfigRecord: (...args: unknown[]) => api.read(...args),
  getHermesConfigSchema: () => api.schema(),
  saveHermesConfig: (...args: unknown[]) => api.save(...args),
  getElevenLabsVoices: async () => ({ available: false }),
  setApiRequestProfile: () => {}
}))
vi.mock('@/store/settings-scope', () => ({
  $settingsRequestProfile: atom('research')
}))
vi.mock('@/store/projects', () => ({
  $worktreeRefreshToken: atom(0),
  repoDiscoveryPolicyFromConfig: () => ({ enabled: true, roots: [], exclude_paths: [] }),
  repoDiscoveryPolicySignature: (policy: unknown) => JSON.stringify(policy),
  scanAndRecordRepos: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../hooks/use-on-profile-switch', () => ({ useOnProfileSwitch: () => {} }))
vi.mock('./profile-scope', () => ({ SettingsProfileScope: () => null }))
vi.mock('./model-settings', () => ({
  ModelSettings: ({ subpage, mainSettings }: { subpage?: string; mainSettings?: ReactNode }) =>
    subpage === 'fallbacks' || subpage === 'delegation' ? null : (
      <section aria-label="Model editor">{mainSettings}</section>
    ),
  ModelSettingsSkeleton: () => <div>Loading models</div>
}))
vi.mock('./delegation/routing-section', () => ({ DelegationRoutingSlot: () => null }))

function LocationProbe() {
  return <output data-testid="route">{useLocation().search}</output>
}

function mount(route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={client}>
        <LocationProbe />
        <ConfigSettings activeSectionId="model" importInputRef={createRef<HTMLInputElement>()} />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

function selectTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false })
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  api.read.mockResolvedValue({
    fallback_providers: [{ provider: 'openai', model: 'test-fallback' }],
    delegation: { max_iterations: 50 }
  })
  api.schema.mockResolvedValue({
    fields: {
      fallback_providers: { type: 'array', description: 'Fallback sequence fixture' },
      'delegation.max_iterations': { type: 'number' }
    }
  })
  api.save.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('model settings navigation', () => {
  it('opens the main model by default and routes other tabs without losing the editing scope', async () => {
    const { container } = mount('/settings?tab=config:model&profile=research&owner=connection-a')

    expect((await screen.findByRole('tab', { name: 'Main model' })).getAttribute('aria-selected')).toBe('true')
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    expect(container.querySelector('[id="setting-field-fallback_providers"]')).toBeNull()

    selectTab('Fallback models')

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Fallback models' }).getAttribute('aria-selected')).toBe('true')
      expect(container.querySelector('[id="setting-field-fallback_providers"]')).not.toBeNull()
    })
    const route = new URLSearchParams(screen.getByTestId('route').textContent ?? '')
    expect(route.get('page')).toBe('fallbacks')
    expect(route.get('profile')).toBe('research')
    expect(route.get('owner')).toBe('connection-a')
    expect(api.read).toHaveBeenCalledWith('research')
  })

  it('opens a legacy field link on its correct tab and keeps scoped configuration edits available', async () => {
    const { container } = mount('/settings?tab=config:model&profile=research&field=delegation.max_iterations')

    expect((await screen.findByRole('tab', { name: 'Subagents' })).getAttribute('aria-selected')).toBe('true')
    const field = container.querySelector<HTMLElement>('[id="setting-field-delegation.max_iterations"]')!
    expect(field).not.toBeNull()
    const input = field.querySelector('input')!
    fireEvent.change(input, { target: { value: '60' } })
    fireEvent.blur(input)

    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ delegation: { max_iterations: 60 } }, 'research'))

    selectTab('Auxiliary models')
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Auxiliary models' }).getAttribute('aria-selected')).toBe('true')
    )
    expect(container.querySelector('[id="setting-field-delegation.max_iterations"]')).toBeNull()
    expect(new URLSearchParams(screen.getByTestId('route').textContent ?? '').has('field')).toBe(false)
  })
})

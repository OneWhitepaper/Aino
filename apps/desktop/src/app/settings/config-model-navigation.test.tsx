import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { createRef, type ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubMenuDomApis } from '@/test/jsdom'

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

beforeEach(() => {
  stubMenuDomApis()
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
  it('opens the default model without extra tabs and routes preferences without losing the editing scope', async () => {
    const { container } = mount('/settings?tab=config:model&profile=research&owner=connection-a')

    expect(await screen.findByRole('heading', { name: 'Model preferences' })).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(container.querySelector('[id="setting-field-fallback_providers"]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Fallback models' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Fallback models' })).toBeTruthy()
      expect(container.querySelector('[id="setting-field-fallback_providers"]')).not.toBeNull()
    })
    const route = new URLSearchParams(screen.getByTestId('route').textContent ?? '')
    expect(route.get('page')).toBe('fallbacks')
    expect(route.get('profile')).toBe('research')
    expect(route.get('owner')).toBe('connection-a')
    expect(api.read).toHaveBeenCalledWith('research')
  })

  it('opens legacy field links and keeps every model category available through the scoped menu', async () => {
    const { container } = mount('/settings?tab=config:model&profile=research&field=delegation.max_iterations')

    const menu = await screen.findByRole('button', { name: 'Subagents' })
    const field = container.querySelector<HTMLElement>('[id="setting-field-delegation.max_iterations"]')!
    expect(field).not.toBeNull()
    const input = field.querySelector('input')!
    fireEvent.change(input, { target: { value: '60' } })
    fireEvent.blur(input)

    await waitFor(() => expect(api.save).toHaveBeenCalledWith({ delegation: { max_iterations: 60 } }, 'research'))

    fireEvent.pointerDown(menu, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    expect(screen.getAllByRole('menuitem')).toHaveLength(5)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Auxiliary models' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Auxiliary models' })).toBeTruthy())
    expect(container.querySelector('[id="setting-field-delegation.max_iterations"]')).toBeNull()
    expect(new URLSearchParams(screen.getByTestId('route').textContent ?? '').has('field')).toBe(false)
  })
})

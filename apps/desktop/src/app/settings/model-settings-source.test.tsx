import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import { platformAccountActions } from '@/api/platform'
import type * as Hermes from '@/hermes'
import { I18nProvider } from '@/i18n'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { $notifications, clearNotifications } from '@/store/notifications'
import { platformModelCatalog, readPlatformDefault, writePlatformDefault } from '@/store/platform-models'
import { $activeSessionId, $currentModel, $currentProvider, setCurrentModel, setCurrentProvider } from '@/store/session'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { ModelSettings } from './model-settings'

stubResizeObserver()
stubMenuDomApis()

const api = vi.hoisted(() => ({
  info: { provider: 'fixture-provider', model: 'third-party-model' },
  saveConfig: vi.fn(),
  assign: vi.fn(),
  env: vi.fn(),
  options: vi.fn()
}))

vi.mock('@/hermes', async original => ({
  ...(await original<typeof Hermes>()),
  getGlobalModelInfo: async () => api.info,
  getGlobalModelOptions: (...args: unknown[]) => api.options(...args),
  getEnvVars: async () => ({}),
  validateProviderCredential: async () => ({ ok: true, reachable: true, message: '' }),
  getAuxiliaryModels: async () => ({ main: api.info, tasks: [] }),
  getMoaModels: async () => null,
  getRecommendedDefaultModel: async () => ({ provider: 'fixture-provider', model: 'third-party-model' }),
  setEnvVar: (...args: unknown[]) => api.env(...args),
  getHermesConfigRecord: async () => ({ agent: { reasoning_effort: 'medium' } }),
  saveHermesConfig: (...args: unknown[]) => api.saveConfig(...args),
  setModelAssignment: (...args: unknown[]) => api.assign(...args)
}))

const providerRows = [
  {
    slug: 'fixture-provider',
    name: 'Fixture provider',
    authenticated: true,
    auth_type: 'api_key',
    key_env: 'FIXTURE_API_KEY',
    models: ['third-party-model', 'another-third-model']
  },
  {
    slug: 'lab',
    name: 'Private Lab',
    is_user_defined: true,
    aliases: ['custom:lab'],
    source: 'user-config',
    api_url: 'https://private.example/v1',
    authenticated: true,
    models: ['custom-model', 'another-custom-model']
  }
]

afterEach(() => {
  cleanup()
  clearNotifications()
  Reflect.deleteProperty(window, 'hermesDesktop')
  clearGatewayManagedCapabilities()
  localStorage.clear()
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  $activeSessionId.set(null)
  setCurrentModel('')
  setCurrentProvider('')
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

async function openModelSettings(
  initialInfo = { provider: 'fixture-provider', model: 'third-party-model' },
  unavailablePreference = false
) {
  api.info = initialInfo
  api.options.mockResolvedValue({ providers: providerRows })
  api.env.mockResolvedValue({ ok: true })
  api.saveConfig.mockImplementation(async () => {
    api.info = { provider: '', model: '' }

    return { ok: true }
  })
  api.assign.mockResolvedValue({ ok: true, provider: 'fixture-provider', model: 'another-third-model' })
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformAccount: {
        capabilities: async () => ({}),
        status: async () => platformSnapshot(),
        onChanged: () => () => {}
      },
      platformModels: {
        list: async () => [
          platformModel('first'),
          {
            ...platformModel('chosen'),
            display_name: 'Chosen built-in model',
            is_default: false,
            state: unavailablePreference ? 'quota_exhausted' : 'available'
          }
        ],
        owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' })
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  setApiRequestConnection('model-source-test')
  recordGatewayReadyCapability(
    { connectionId: 'model-source-test', profile: 'work' },
    { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
  )
  await platformModelCatalog().load()

  if (unavailablePreference) {
    writePlatformDefault('user-a', 'chosen', { connectionId: 'model-source-test', profile: 'work' }, 'development')
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <I18nProvider configClient={null} initialLocale="en">
          <ModelSettings scopeProfile="work" subpage="main" />
        </I18nProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )

  if (initialInfo.provider) {
    await screen.findByRole('combobox', {
      name: initialInfo.provider.startsWith('custom:') ? 'Custom connection' : 'Provider'
    })
  } else {
    await screen.findByText('Default main model')
  }

  return { client, view }
}

it('uses one apply boundary for both sources without modifying a live conversation', async () => {
  await openModelSettings()
  $activeSessionId.set('existing-session')
  setCurrentProvider('live-provider')
  setCurrentModel('live-model')
  fireEvent.click(screen.getByRole('button', { name: 'Aino built-in models' }))
  expect(screen.queryByRole('combobox', { name: 'Provider' })).toBeNull()
  expect(api.saveConfig).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Choose an Aino built-in model' }))
  fireEvent.click(await screen.findByRole('option', { name: /Chosen built-in model/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm choice' }))
  expect(api.saveConfig).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Apply as default' }))
  await waitFor(() =>
    expect(readPlatformDefault('user-a', { connectionId: 'model-source-test', profile: 'work' }, 'development')).toBe(
      'chosen'
    )
  )
  expect(api.saveConfig).toHaveBeenCalledWith(
    { model: { default: '', name: '', provider: '' } },
    expect.objectContaining({ connectionId: 'model-source-test', profile: 'work' })
  )
  await waitFor(() => expect(screen.getAllByText('Chosen built-in model').length).toBeGreaterThan(0))
  expect([$currentProvider.get(), $currentModel.get()]).toEqual(['live-provider', 'live-model'])
})

it('keeps the applied summary when a source change cannot be saved', async () => {
  await openModelSettings()
  api.saveConfig.mockRejectedValueOnce(new Error('save rejected'))
  fireEvent.click(screen.getByRole('button', { name: 'Aino built-in models' }))
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: 'Apply as default' }))
  await screen.findByText(/save rejected/)
  expect(screen.getByText('Current default model').parentElement?.textContent).toContain('third-party-model')
  expect(
    readPlatformDefault('user-a', { connectionId: 'model-source-test', profile: 'work' }, 'development')
  ).toBeNull()
})

it('shows the same available fallback as new-session resolution when the saved model is exhausted', async () => {
  await openModelSettings({ provider: '', model: '' }, true)
  expect(screen.getByText('Current default model').parentElement?.textContent).toContain('Fixture Model')
  expect(screen.getByText('Current default model').parentElement?.textContent).not.toContain('Chosen built-in model')
})

it('reconfigures an existing provider key without applying a different main model', async () => {
  await openModelSettings()
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
  fireEvent.click(screen.getByRole('option', { name: 'another-third-model' }))
  fireEvent.click(screen.getByRole('button', { name: 'Configure a provider' }))
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'fixture-replacement-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Get models' }))
  await waitFor(() =>
    expect(api.env).toHaveBeenCalledWith(
      'FIXTURE_API_KEY',
      'fixture-replacement-key',
      { connectionId: 'model-source-test', profile: 'work' },
      { providerSetup: true }
    )
  )
  await waitFor(() => expect(screen.queryByLabelText('API key')).toBeNull())
  expect(api.assign).not.toHaveBeenCalled()
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toContain('another-third-model')
  expect(api.saveConfig).not.toHaveBeenCalled()
  expect(screen.getByText('Current default model').parentElement?.textContent).toContain('third-party-model')
})

it('rereads the applied route after an account changes during successful activation', async () => {
  await openModelSettings()
  api.saveConfig.mockImplementationOnce(async () => {
    api.info = { provider: '', model: '' }
    platformAccountActions(window.hermesDesktop.platformAccount).snapshot.set(platformSnapshot('user-b', 2))

    return { ok: true }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Aino built-in models' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Apply as default' }))
  })
  await screen.findByText(/This model belongs to another account/)
  await waitFor(() =>
    expect(screen.getByText('Current default model').parentElement?.textContent).not.toContain('third-party-model')
  )
  expect($notifications.get().some(item => item.kind === 'success')).toBe(false)
})

it('keeps official and custom provider/model drafts independent until Apply', async () => {
  await openModelSettings()
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
  fireEvent.click(screen.getByRole('option', { name: 'another-third-model' }))
  fireEvent.click(screen.getByRole('button', { name: 'Custom models' }))
  expect(screen.getByRole('combobox', { name: 'Custom connection' }).textContent).not.toContain('Fixture provider')
  fireEvent.click(screen.getByRole('combobox', { name: 'Custom connection' }))
  expect(screen.queryByRole('option', { name: 'Fixture provider' })).toBeNull()
  fireEvent.click(screen.getByRole('option', { name: 'Private Lab' }))
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
  fireEvent.click(screen.getByRole('option', { name: 'another-custom-model' }))
  fireEvent.click(screen.getByRole('button', { name: 'Third-party service' }))
  expect(screen.getByRole('combobox', { name: 'Provider' }).textContent).toContain('Fixture provider')
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toContain('another-third-model')
  fireEvent.click(screen.getByRole('button', { name: 'Custom models' }))
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toContain('another-custom-model')
  expect(api.assign).not.toHaveBeenCalled()
  expect(api.saveConfig).not.toHaveBeenCalled()
})

it('classifies a custom alias default as a custom model even if its name matches a provider', async () => {
  await openModelSettings({ provider: 'custom:lab', model: 'custom-model' })
  expect(screen.getByRole('button', { name: 'Custom models' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('combobox', { name: 'Custom connection' }).textContent).toContain('Private Lab')
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toContain('custom-model')
})

it('does not overwrite a custom draft with a late provider-key result', async () => {
  await openModelSettings()
  let finish!: (value: { providers: typeof providerRows }) => void
  api.options.mockReturnValueOnce(new Promise(resolve => (finish = resolve)))
  fireEvent.click(screen.getByRole('button', { name: 'Configure a provider' }))
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'pending-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Get models' }))
  await waitFor(() => expect(api.env).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'Custom models' }))
  fireEvent.click(screen.getByRole('combobox', { name: 'Custom connection' }))
  fireEvent.click(screen.getByRole('option', { name: 'Private Lab' }))
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
  fireEvent.click(screen.getByRole('option', { name: 'another-custom-model' }))
  await act(async () => finish({ providers: providerRows }))
  expect(screen.getByRole('combobox', { name: 'Custom connection' }).textContent).toContain('Private Lab')
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toContain('another-custom-model')
  expect(api.assign).not.toHaveBeenCalled()
})

it('refreshes saved custom services when the shared model-options cache is invalidated', async () => {
  const { client } = await openModelSettings()
  api.options.mockResolvedValue({
    providers: [
      ...providerRows,
      {
        slug: 'new-private',
        name: 'New private service',
        is_user_defined: true,
        source: 'user-config',
        authenticated: true,
        models: ['new-model']
      }
    ]
  })
  await act(async () => client.invalidateQueries({ queryKey: ['model-options'] }))
  fireEvent.click(screen.getByRole('button', { name: 'Custom models' }))
  fireEvent.click(screen.getByRole('combobox', { name: 'Custom connection' }))
  expect(screen.getByRole('option', { name: 'New private service' })).toBeTruthy()
  expect(api.assign).not.toHaveBeenCalled()
})

it('keeps the new scope selection when an old scope key submission finishes late', async () => {
  const { client, view } = await openModelSettings()
  let finish!: (value: { ok: boolean }) => void
  api.env.mockReturnValueOnce(new Promise(resolve => (finish = resolve)))
  fireEvent.click(screen.getByRole('button', { name: 'Configure a provider' }))
  fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'old-scope-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Get models' }))
  await waitFor(() => expect(api.env).toHaveBeenCalledOnce())
  api.info = { provider: 'next-provider', model: 'next-model' }
  api.options.mockResolvedValue({
    providers: [
      {
        slug: 'next-provider',
        name: 'Next provider',
        auth_type: 'api_key',
        key_env: 'NEXT_API_KEY',
        authenticated: true,
        models: ['next-model']
      }
    ]
  })
  view.rerender(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <I18nProvider configClient={null} initialLocale="en">
          <ModelSettings scopeProfile="other" subpage="main" />
        </I18nProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Provider' }).textContent).toContain('Next provider'))
  await act(async () => finish({ ok: true }))
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toContain('next-model')
  expect(api.env).toHaveBeenCalledWith(
    'FIXTURE_API_KEY',
    'old-scope-key',
    { connectionId: 'model-source-test', profile: 'work' },
    { providerSetup: true }
  )
  expect(api.assign).not.toHaveBeenCalled()
})

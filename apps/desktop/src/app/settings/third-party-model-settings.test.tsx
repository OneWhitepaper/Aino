import type { ModelOptionProvider } from '@hermes/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { profileScopeKey, setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import { I18nProvider } from '@/i18n'
import { $settingsScopeOverride } from '@/store/settings-scope'
import { deferred } from '@/test/deferred'
import { stubMenuDomApis } from '@/test/jsdom'

import { envVar } from './test-utils'
import { ThirdPartyModelConfigDialog, ThirdPartyModelSettings } from './third-party-model-settings'

const api = vi.hoisted(() => ({
  env: vi.fn(),
  options: vi.fn(),
  validate: vi.fn(),
  saveKey: vi.fn(),
  recommend: vi.fn(),
  assign: vi.fn()
}))

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEnvVars: (...args: unknown[]) => api.env(...args),
  getGlobalModelOptions: (...args: unknown[]) => api.options(...args),
  validateProviderCredential: (...args: unknown[]) => api.validate(...args),
  setEnvVar: (...args: unknown[]) => api.saveKey(...args),
  getRecommendedDefaultModel: (...args: unknown[]) => api.recommend(...args),
  setModelAssignment: (...args: unknown[]) => api.assign(...args)
}))

stubMenuDomApis()

const owner = { connectionId: 'remote-studio', profile: 'director' }
const providerId = 'server-defined-api'

const connected: ModelOptionProvider = {
  slug: providerId,
  name: 'Server-defined API',
  authenticated: true,
  models: ['first-model', 'recommended-model']
}

let credentialSaved = false
let modelsLoaded = false

function TestProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <I18nProvider configClient={null} initialLocale="en">
        {children}
      </I18nProvider>
    </QueryClientProvider>
  )
}

function setupDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const onConfigSaved = vi.fn()
  const onOpenChange = vi.fn()

  const dialog = (scope = owner, open = true) => (
    <TestProviders client={client}>
      <ThirdPartyModelConfigDialog
        onConfigSaved={onConfigSaved}
        onOpenChange={onOpenChange}
        open={open}
        providerId={providerId}
        scope={scope}
      />
    </TestProviders>
  )

  const view = render(dialog())

  return { ...view, client, dialog, onConfigSaved, onOpenChange }
}

async function submitKey(key = 'fixture-official-key') {
  const input = await screen.findByLabelText<HTMLInputElement>(/^API key$/i)
  fireEvent.change(input, { target: { value: key } })
  fireEvent.click(screen.getByRole('button', { name: 'Get models' }))
}

beforeEach(() => {
  vi.resetAllMocks()
  credentialSaved = false
  modelsLoaded = false
  api.env.mockImplementation(async () => ({
    SERVER_PRIMARY_KEY: envVar('provider', {
      is_set: credentialSaved,
      provider: providerId,
      provider_label: 'Server-defined API',
      provider_primary: true
    })
  }))
  api.options.mockImplementation(async (options?: { refresh?: boolean }) => {
    if (options?.refresh) {
      modelsLoaded = true
    }

    return { providers: modelsLoaded ? [connected] : [] }
  })
  api.validate.mockResolvedValue({ ok: true, reachable: true, message: '' })
  api.saveKey.mockImplementation(async () => {
    credentialSaved = true

    return { ok: true }
  })
  api.recommend.mockResolvedValue({ provider: providerId, model: 'recommended-model' })
})

afterEach(() => {
  cleanup()
  $settingsScopeOverride.set(null)
  setApiRequestConnection(null)
  setApiRequestProfile(null)
})

it('uses server credential metadata to connect a remote provider and load models without changing the default', async () => {
  const { onConfigSaved } = setupDialog()
  const key = await screen.findByLabelText<HTMLInputElement>(/^API key$/i)
  expect(screen.getByRole('combobox', { name: 'Provider' }).textContent).toBe('Server-defined API')
  expect(screen.queryByRole('textbox', { name: 'Endpoint URL' })).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Get models' }).disabled).toBe(true)
  expect(key.type).toBe('password')
  fireEvent.change(key, { target: { value: 'fixture-official-key' } })
  fireEvent.click(screen.getByRole('button', { name: 'Get models' }))

  expect((await screen.findByRole('status')).textContent).toContain('2 models loaded')
  expect(screen.getByRole<HTMLInputElement>('combobox', { name: 'Model name' }).value).toBe('recommended-model')
  expect(key.value).toBe('')
  expect(api.env).toHaveBeenCalledWith(owner)
  expect(api.options).toHaveBeenCalledWith({ includeUnconfigured: true }, owner)
  expect(api.options).toHaveBeenCalledWith({ refresh: true, includeUnconfigured: true }, owner)
  expect(api.validate).toHaveBeenCalledWith('SERVER_PRIMARY_KEY', 'fixture-official-key', undefined, owner)
  expect(api.saveKey).toHaveBeenCalledWith('SERVER_PRIMARY_KEY', 'fixture-official-key', owner, {
    providerSetup: true
  })
  expect(onConfigSaved).toHaveBeenCalledOnce()
  expect(api.assign).not.toHaveBeenCalled()
})

it('keeps a rejected key editable without saving it or reporting loaded models', async () => {
  api.validate.mockResolvedValue({ ok: false, reachable: true, message: 'The provider rejected this key.' })
  const { onConfigSaved } = setupDialog()
  await submitKey('wrong-key')

  expect((await screen.findByRole('alert')).textContent).toContain('The provider rejected this key.')
  expect(screen.getByLabelText<HTMLInputElement>(/^API key$/i).value).toBe('wrong-key')
  expect(screen.getByLabelText<HTMLInputElement>(/^API key$/i).disabled).toBe(false)
  expect(api.saveKey).not.toHaveBeenCalled()
  expect(onConfigSaved).not.toHaveBeenCalled()
  expect(api.assign).not.toHaveBeenCalled()
})

it('drops the pending discovery result after the dialog is cancelled', async () => {
  const pending = deferred<{ providers: ModelOptionProvider[] }>()
  api.options.mockImplementation(async (options?: { refresh?: boolean }) =>
    options?.refresh ? pending.promise : { providers: [] }
  )
  const { client, dialog, onConfigSaved, onOpenChange, rerender } = setupDialog()
  await submitKey()
  await waitFor(() => expect(api.options).toHaveBeenCalledWith({ refresh: true, includeUnconfigured: true }, owner))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onOpenChange).toHaveBeenCalledWith(false)
  rerender(dialog(owner, false))
  await act(async () => pending.resolve({ providers: [connected] }))

  expect(onConfigSaved).not.toHaveBeenCalled()
  expect(client.getQueryData(['model-options', profileScopeKey(owner), 'provider-setup'])).toEqual({ providers: [] })
  expect(screen.queryByRole('status')).toBeNull()
  expect(api.assign).not.toHaveBeenCalled()
})

it('clears the credential draft on owner change and rejects the previous owner completion', async () => {
  const pending = deferred<{ providers: ModelOptionProvider[] }>()
  const nextOwner = { connectionId: 'another-host', profile: 'writer' }
  api.options.mockImplementation(async (options?: { refresh?: boolean }, scope?: { connectionId?: string }) => {
    if (options?.refresh && scope?.connectionId === owner.connectionId) {
      return pending.promise
    }

    return { providers: [] }
  })
  const { client, dialog, onConfigSaved, rerender } = setupDialog()
  await submitKey()
  await waitFor(() => expect(api.options).toHaveBeenCalledWith({ refresh: true, includeUnconfigured: true }, owner))
  rerender(dialog(nextOwner))
  await waitFor(() => expect(api.env).toHaveBeenCalledWith(nextOwner))
  await act(async () => pending.resolve({ providers: [connected] }))

  expect(screen.getByLabelText<HTMLInputElement>(/^API key$/i).value).toBe('')
  expect(screen.queryByRole('combobox', { name: 'Model name' })).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(onConfigSaved).not.toHaveBeenCalled()
  expect(client.getQueryData(['model-options', profileScopeKey(nextOwner), 'provider-setup'])).toEqual({
    providers: []
  })
  expect(api.saveKey).toHaveBeenCalledWith('SERVER_PRIMARY_KEY', 'fixture-official-key', owner, {
    providerSetup: true
  })
  expect(api.assign).not.toHaveBeenCalled()
})

it('keeps the settings page on an untagged legacy profile route', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  $settingsScopeOverride.set('legacy-remote-profile')
  setApiRequestConnection(null)
  setApiRequestProfile('legacy-remote-profile')
  render(
    <TestProviders client={client}>
      <ThirdPartyModelSettings embedded />
    </TestProviders>
  )
  await submitKey()
  await screen.findByRole('status')

  const capturedOwner = { connectionId: null, profile: 'legacy-remote-profile' }
  expect(api.env).toHaveBeenCalledWith(capturedOwner)
  expect(api.options).toHaveBeenCalledWith({ includeUnconfigured: true }, capturedOwner)
  expect(api.saveKey).toHaveBeenCalledWith('SERVER_PRIMARY_KEY', 'fixture-official-key', capturedOwner, {
    providerSetup: true
  })
})

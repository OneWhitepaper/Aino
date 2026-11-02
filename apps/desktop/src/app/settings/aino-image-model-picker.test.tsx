import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { getToolsetConfig, getToolsetModels, selectToolsetModel } from '@/hermes'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { stubMenuDomApis, stubResizeObserver } from '@/test/jsdom'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import { ToolsetConfigPanel } from './toolset-config-panel'

vi.mock('@/hermes', () => ({
  getToolsetConfig: vi.fn(),
  getToolsetModels: vi.fn(),
  selectToolsetModel: vi.fn(),
  selectToolsetProvider: vi.fn(),
  deleteEnvVar: vi.fn(),
  getActionStatus: vi.fn(),
  pollOAuthSession: vi.fn(),
  revealEnvVar: vi.fn(),
  runToolsetPostSetup: vi.fn(),
  setEnvVar: vi.fn(),
  startOAuthLogin: vi.fn()
}))
vi.mock('@/store/notifications', () => ({ notify: vi.fn(), notifyError: vi.fn() }))
vi.mock('./voice-provider-fields', () => ({ VoiceProviderFields: () => null }))
vi.mock('@/store/profile', async () => {
  const { atom } = await import('nanostores')

  return { $activeGatewayProfile: atom('default') }
})
vi.mock('@/store/connections', async () => {
  const { atom } = await import('nanostores')

  return { $activeConnectionId: atom('local') }
})

afterEach(() => {
  cleanup()
  clearGatewayManagedCapabilities()
  Reflect.deleteProperty(window, 'hermesDesktop')
  vi.clearAllMocks()
})

it.each([true, false])(
  'keeps image selection atomic and quality gated by runtime support (%s)',
  async qualitySupported => {
    stubResizeObserver()
    stubMenuDomApis()
    const account = platformSnapshot()

    const image = {
      ...platformModel('image-catalog'),
      display_name: 'Aino Image Fixture',
      purpose: 'image' as const,
      api_mode: 'images_generations' as const,
      capabilities: {
        ...platformModel().capabilities,
        image_generation: true,
        image_quality_options: ['auto', 'low', 'high']
      }
    }

    const bind = vi.fn()
    const api = vi.fn()
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        api,
        platformAccount: { status: async () => account, capabilities: async () => ({}), onChanged: () => () => {} },
        platformModels: {
          list: async () => [platformModel('chat-catalog'), image],
          owner: async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:1234' }),
          bind
        }
      }
    })
    await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
    const scope = { connectionId: 'remote', profile: 'writer' }
    recordGatewayReadyCapability(scope, {
      type: 'gateway.ready',
      payload: { managed_model_binding: 1, managed_image_binding: 1 }
    } as never)
    const provider = { badge: '', tag: '', env_vars: [], post_setup: null, requires_nous_auth: false }
    vi.mocked(getToolsetConfig).mockResolvedValue({
      name: 'image_gen',
      has_category: true,
      active_provider: 'Nous Subscription',
      providers: [
        { ...provider, name: 'Aino account', image_gen_plugin_name: 'aino', is_active: false },
        { ...provider, name: 'Nous Subscription', requires_nous_auth: true, is_active: true },
        { ...provider, name: 'FAL.ai', image_gen_plugin_name: 'fal', is_active: false }
      ]
    } as never)
    vi.mocked(getToolsetModels).mockResolvedValue({
      name: 'image_gen',
      has_models: true,
      ...(qualitySupported ? { quality_configurable: true } : {}),
      models: [],
      current: null,
      default: null
    })
    vi.mocked(selectToolsetModel).mockResolvedValue({ ok: true, name: 'image_gen', model: 'image-catalog' })

    const configured = vi.fn()
    render(
      <MemoryRouter>
        <ToolsetConfigPanel onConfiguredChange={configured} profile={scope} toolset="image_gen" />
      </MemoryRouter>
    )
    await screen.findByRole('option', { name: /Aino Image Fixture/ })
    expect(screen.queryByText('Nous Subscription')).toBeNull()
    expect(screen.queryByText('FAL.ai')).toBeNull()
    expect(screen.queryByText('Use this backend')).toBeNull()
    expect(screen.queryByRole('option', { name: /Fixture Model/ })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Aino Image Fixture/ }))
    await waitFor(() =>
      expect(selectToolsetModel).toHaveBeenCalledWith(
        'image_gen',
        'image-catalog',
        'Aino account',
        expect.objectContaining(scope),
        { activate: true, ...(qualitySupported ? { quality: 'auto' } : {}) }
      )
    )
    expect(bind).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
    expect(configured).toHaveBeenCalledOnce()

    if (!qualitySupported) {
      expect(screen.getByRole('status').textContent).toContain('Update the runtime')
      expect(screen.queryByRole('button', { name: 'High' })).toBeNull()

      return
    }

    fireEvent.click(screen.getByRole('button', { name: 'High' }))
    await waitFor(() =>
      expect(selectToolsetModel).toHaveBeenLastCalledWith(
        'image_gen',
        'image-catalog',
        'Aino account',
        expect.objectContaining(scope),
        { activate: true, quality: 'high' }
      )
    )
    expect(screen.queryByRole('button', { name: 'Medium' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }))
    await waitFor(() =>
      expect(selectToolsetModel).toHaveBeenLastCalledWith(
        'image_gen',
        'image-catalog',
        'Aino account',
        expect.objectContaining(scope),
        { activate: true, quality: 'auto' }
      )
    )
  }
)

it('shows an unavailable state without offering other image services when the Aino provider is absent', async () => {
  vi.mocked(getToolsetConfig).mockResolvedValue({
    name: 'image_gen',
    has_category: true,
    active_provider: 'Nous Subscription',
    providers: [{ name: 'Nous Subscription', requires_nous_auth: true, env_vars: [] }]
  } as never)
  render(
    <MemoryRouter>
      <ToolsetConfigPanel profile={{ connectionId: 'remote', profile: 'writer' }} toolset="image_gen" />
    </MemoryRouter>
  )
  await screen.findByRole('alert')
  expect(screen.queryByText('Nous Subscription')).toBeNull()
  expect(getToolsetModels).not.toHaveBeenCalled()
  expect(selectToolsetModel).not.toHaveBeenCalled()
})

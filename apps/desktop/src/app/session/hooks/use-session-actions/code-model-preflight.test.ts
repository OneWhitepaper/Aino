import { beforeEach, expect, it, vi } from 'vitest'

import { getCustomEndpoints } from '@/api/config'
import { getGlobalModelOptions } from '@/api/models'
import { resolveModelDefault } from '@/lib/model-default'
import { setDraftExecutionMode } from '@/store/execution-mode'
import { requestGatewayForAgent, requestGatewayForProfile } from '@/store/gateway'
import type * as ProfileStore from '@/store/profile'
import { $activeGatewayProfile, $newChatProfile, $newChatRoute } from '@/store/profile'
import {
  markComposerSelectionManual,
  setCurrentModel,
  setCurrentModelSource,
  setCurrentProvider
} from '@/store/session'
import { deferred } from '@/test/deferred'
import type { CustomEndpointsResponse } from '@/types/hermes'

import { desktopSessionCreateParams } from './create-params'

vi.mock('@/api/config', () => ({ getCustomEndpoints: vi.fn() }))
vi.mock('@/api/models', () => ({ getGlobalModelOptions: vi.fn() }))
vi.mock('@/lib/model-default', () => ({ resolveModelDefault: vi.fn() }))
vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  requestGatewayForProfile: vi.fn()
}))
vi.mock('@/store/profile', async importOriginal => ({
  ...(await importOriginal<typeof ProfileStore>()),
  ensureGatewayProfile: async () => undefined,
  ensureGatewayAgent: async () => undefined
}))

const endpoints: CustomEndpointsResponse = {
  current: { provider: 'custom:lab', model: 'm1', base_url: 'https://example.invalid/v1' },
  endpoints: [
    {
      id: 'lab',
      name: 'Lab',
      base_url: 'https://example.invalid/v1',
      model: 'm1',
      models: ['m1'],
      api_mode: 'chat_completions',
      discover_models: false,
      has_api_key: false
    }
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: [] })
  vi.mocked(requestGatewayForProfile).mockResolvedValue({ capabilities: [] })
  $activeGatewayProfile.set('default')
  $newChatProfile.set(null)
  $newChatRoute.set(null)
  setDraftExecutionMode('code')
  setCurrentProvider('custom:lab')
  setCurrentModel('m1')
  markComposerSelectionManual()
  vi.mocked(getGlobalModelOptions).mockResolvedValue({
    providers: [{ slug: 'custom:lab', name: 'Lab', models: ['m1'] }]
  })
  vi.mocked(getCustomEndpoints).mockResolvedValue(endpoints)
  vi.mocked(resolveModelDefault).mockResolvedValue({ provider: 'custom:lab', model: 'm1', platform: null })
})

it('refuses a Work-only Code model before returning any session.create parameters', async () => {
  await expect(desktopSessionCreateParams('', { connectionId: 'source-a', profile: 'writer' })).rejects.toThrow(
    /Responses/
  )
  expect(getCustomEndpoints).toHaveBeenCalledWith(
    expect.objectContaining({ connectionId: 'source-a', profile: 'writer' })
  )
})

it.each(['chat_completions', 'anthropic_messages'] as const)(
  'creates Code on the same custom %s route only when its owner advertises the bridge',
  async api_mode => {
    vi.mocked(getCustomEndpoints).mockResolvedValue({
      ...endpoints,
      endpoints: [{ ...endpoints.endpoints[0], api_mode }]
    })
    vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: ['code-model-protocol-bridge-v1'] })
    const owner = { connectionId: 'source-a', profile: 'writer' }
    expect((await desktopSessionCreateParams('', owner)).params).toMatchObject({
      execution_mode: 'code',
      provider: 'custom:lab',
      model: 'm1'
    })
    expect(requestGatewayForAgent).toHaveBeenCalledWith(
      'source-a',
      'writer',
      'runtime.describe',
      {},
      expect.any(Number),
      undefined
    )
    expect(requestGatewayForProfile).not.toHaveBeenCalled()
    vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: [] })
    await expect(desktopSessionCreateParams('', owner)).rejects.toThrow()
  }
)

it('checks the resolved Settings default rather than a stale composer pill', async () => {
  setCurrentModelSource('default')
  setCurrentProvider('old-provider')
  setCurrentModel('old-model')
  await expect(desktopSessionCreateParams('')).rejects.toThrow(/Responses/)
})

it('keeps a manually selected Responses route and does not pin a Settings default', async () => {
  vi.mocked(getCustomEndpoints).mockResolvedValue({
    ...endpoints,
    endpoints: [{ ...endpoints.endpoints[0], api_mode: 'codex_responses' }]
  })
  expect((await desktopSessionCreateParams('')).params).toMatchObject({
    execution_mode: 'code',
    provider: 'custom:lab',
    model: 'm1'
  })
  setCurrentModelSource('default')
  const result = await desktopSessionCreateParams('')
  expect(result.params).not.toHaveProperty('provider')
  expect(result.params).not.toHaveProperty('model')
})

it('does no compatibility reads for Work and leaves unknown Code routes selectable', async () => {
  setDraftExecutionMode('work')
  expect((await desktopSessionCreateParams('')).params).toMatchObject({ provider: 'custom:lab', model: 'm1' })
  expect(getCustomEndpoints).not.toHaveBeenCalled()
  setDraftExecutionMode('code')
  vi.mocked(getCustomEndpoints).mockResolvedValue({ ...endpoints, endpoints: [] })
  expect((await desktopSessionCreateParams('')).params).toMatchObject({ provider: 'custom:lab', model: 'm1' })
})

it('rejects a selection changed while metadata was loading', async () => {
  const pending = deferred<CustomEndpointsResponse>()
  vi.mocked(getCustomEndpoints).mockReturnValue(pending.promise)

  const creation = desktopSessionCreateParams('').then(
    value => value,
    error => error
  )

  await vi.waitFor(() => expect(getCustomEndpoints).toHaveBeenCalled())
  setCurrentProvider('custom:other')
  pending.resolve({ ...endpoints, endpoints: [{ ...endpoints.endpoints[0], api_mode: 'codex_responses' }] })
  expect(await creation).toBeInstanceOf(Error)
})

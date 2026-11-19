import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getCustomEndpoints } from '@/api/config'
import { getGlobalModelOptions } from '@/api/models'
import { requestGatewayForAgent, requestGatewayForProfile } from '@/store/gateway'
import { deferred } from '@/test/deferred'
import { platformModel } from '@/test/platform-model'

import { assertCodeModelCompatible, codeModelCapability } from './code-model-capability'

vi.mock('@/api/config', () => ({ getCustomEndpoints: vi.fn() }))
vi.mock('@/api/models', () => ({ getGlobalModelOptions: vi.fn() }))
vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  requestGatewayForProfile: vi.fn()
}))

const selection = { provider: 'lab', model: 'm1' }
const bridge = ['code-model-protocol-bridge-v1']

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: [] })
  vi.mocked(requestGatewayForProfile).mockResolvedValue({ capabilities: [] })
})

describe('Code protocol eligibility', () => {
  it.each(['chat_completions', 'anthropic_messages'] as const)(
    'adapts %s only with an advertised bridge, preserving the selected catalog route',
    async api_mode => {
      const platformModel = { id: 'm1', api_mode }
      const input = { provider: 'aino', model: 'm1', platformModel }
      expect(codeModelCapability({ ...input, runtimeCapabilities: bridge })).toBe('adapted')
      expect(codeModelCapability({ ...input, runtimeCapabilities: [] })).toBe('work-only')
      expect(codeModelCapability({ ...input, runtimeCapabilities: ['unrelated'] })).toBe('work-only')
      expect(codeModelCapability({ ...input, model: 'other', runtimeCapabilities: bridge })).toBe('unverified')

      vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: bridge })
      await expect(
        assertCodeModelCompatible({ ...input, scope: { connectionId: 'owner-a', profile: 'writer' } })
      ).resolves.toBe('adapted')
      expect(requestGatewayForAgent).toHaveBeenCalledWith(
        'owner-a',
        'writer',
        'runtime.describe',
        {},
        expect.any(Number),
        undefined
      )
      expect(platformModel).toEqual({ id: 'm1', api_mode })
    }
  )

  it.each([
    ['responses', 'compatible'],
    ['codex_responses', 'compatible'],
    ['images_generations', 'work-only'],
    ['bedrock_converse', 'work-only'],
    ['future_transport', 'unverified']
  ] as const)('keeps %s independent of bridge support', (api_mode, expected) => {
    expect(
      codeModelCapability({
        ...selection,
        providers: [{ slug: 'lab', name: 'Lab', api_mode }],
        runtimeCapabilities: bridge
      })
    ).toBe(expected)
  })

  it('rejects bridge evidence after its owner changes and never uses the ambient gateway', async () => {
    const pending = deferred<{ capabilities: string[] }>()
    vi.mocked(requestGatewayForAgent).mockReturnValue(pending.promise)
    let current = true

    const result = assertCodeModelCompatible({
      ...selection,
      providers: [{ slug: 'lab', name: 'Lab', api_mode: 'chat_completions' }],
      scope: { connectionId: 'owner-a', profile: 'writer' },
      isCurrent: () => current
    }).catch(error => error)

    await vi.waitFor(() => expect(requestGatewayForAgent).toHaveBeenCalled())
    current = false
    pending.resolve({ capabilities: bridge })
    expect(await result).toMatchObject({ reason: 'changed' })
    expect(requestGatewayForProfile).not.toHaveBeenCalled()
  })

  it('keeps an older backend without runtime.describe Work-only and surfaces a failed capability read', async () => {
    const input = {
      ...selection,
      providers: [{ slug: 'lab', name: 'Lab', api_mode: 'chat_completions' }],
      scope: { connectionId: 'owner-a', profile: 'writer' }
    }

    vi.mocked(requestGatewayForAgent).mockRejectedValue({ code: -32601, message: 'method not found' })
    await expect(assertCodeModelCompatible(input)).rejects.toMatchObject({ reason: 'work-only' })
    const offline = new Error('offline')
    vi.mocked(requestGatewayForAgent).mockRejectedValue(offline)
    await expect(assertCodeModelCompatible(input)).rejects.toBe(offline)
  })

  it.each([
    ['responses', 'compatible'],
    ['codex_responses', 'compatible'],
    ['chat_completions', 'work-only'],
    ['anthropic_messages', 'work-only'],
    ['', 'unverified'],
    ['future_transport', 'unverified']
  ] as const)('classifies the selected route %s as %s', (api_mode, expected) => {
    expect(codeModelCapability({ ...selection, providers: [{ slug: 'lab', name: 'Lab', api_mode }] })).toBe(expected)
  })

  it('never borrows a route from another provider, model, display name or stale session info', () => {
    const providers = [
      { slug: 'custom:other', name: 'lab', api_mode: 'responses' },
      { slug: 'lab', name: 'Lab' }
    ]

    expect(
      codeModelCapability({
        ...selection,
        providers,
        sessionInfo: { provider: 'lab', model: 'old', api_mode: 'responses' }
      })
    ).toBe('unverified')
    expect(
      codeModelCapability({
        ...selection,
        providers,
        sessionInfo: { provider: 'other', model: 'm1', api_mode: 'responses' }
      })
    ).toBe('unverified')
    expect(
      codeModelCapability({
        ...selection,
        providers,
        sessionInfo: { provider: 'lab', model: 'm1', api_mode: 'chat_completions' }
      })
    ).toBe('work-only')
    expect(
      codeModelCapability({ ...selection, platformModel: { ...platformModel('m1'), api_mode: 'responses' } })
    ).toBe('unverified')
  })

  it('uses the exact managed catalog model id and honors model protocols independently', () => {
    expect(
      codeModelCapability({
        provider: 'aino',
        model: 'one',
        platformModel: { ...platformModel('one'), api_mode: 'responses' }
      })
    ).toBe('compatible')
    expect(
      codeModelCapability({
        provider: 'aino',
        model: 'two',
        platformModel: { ...platformModel('one'), api_mode: 'responses' }
      })
    ).toBe('unverified')
    expect(
      codeModelCapability({
        provider: 'aino',
        model: 'two',
        platformModel: { ...platformModel('two'), api_mode: 'anthropic_messages' }
      })
    ).toBe('work-only')
  })

  it('leaves absent metadata unverified and does not invent a protocol from a model or URL', () => {
    expect(
      codeModelCapability({
        provider: 'openai',
        model: 'gpt-5',
        providers: [{ slug: 'openai', name: 'OpenAI', api_url: 'https://api.openai.com/v1' }]
      })
    ).toBe('unverified')
  })

  it('discards an otherwise compatible response when the caller owner changes', async () => {
    vi.mocked(getGlobalModelOptions).mockResolvedValue({
      providers: [{ slug: 'lab', name: 'Lab', api_mode: 'responses' }]
    })
    await expect(
      assertCodeModelCompatible({ ...selection, scope: { connectionId: 'a', profile: 'b' }, isCurrent: () => false })
    ).rejects.toThrow()
  })

  it('retains an unknown route on old or unavailable metadata APIs', async () => {
    vi.mocked(getGlobalModelOptions).mockRejectedValue(new Error('offline'))
    vi.mocked(getCustomEndpoints).mockRejectedValue(new Error('offline'))
    await expect(assertCodeModelCompatible({ ...selection, scope: { connectionId: 'a', profile: 'b' } })).resolves.toBe(
      'unverified'
    )
  })
})

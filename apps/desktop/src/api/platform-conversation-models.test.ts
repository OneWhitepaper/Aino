import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { deferred } from '@/test/deferred'
import { platformModel, platformSnapshot } from '@/test/platform-model'

const io = vi.hoisted(() => ({ account: null as unknown, models: [] as unknown[], owner: null as unknown,
  phase: 'ready', load: vi.fn(), request: vi.fn() }))

vi.mock('@/store/platform-models', () => ({
  platformModelCatalog: () => ({ account: { get: () => io.account }, state: { get: () => ({ phase: io.phase, models: io.models }) },
    owner: { state: { get: () => ({ owner: io.owner }) } }, load: io.load }),
  PlatformSelectionError: class extends Error { constructor(readonly code: string) { super(code) } }
}))
vi.mock('@/store/gateway', () => ({ requestGatewayForAgent: io.request }))

import { answerPlatformConversationModelRequest } from './platform-conversation-models'

const originalDesktop = window.hermesDesktop
const owner = { user_id: 'user-a', platform_origin: 'https://aino.test' }
const builtin = { ...platformModel('deepseek-flash'), display_name: 'DeepSeek Flash', model: 'upstream/deepseek-flash' }
const route = { connectionId: 'owned-connection', profile: 'robot-profile' }

beforeEach(() => {
  vi.clearAllMocks()
  io.account = platformSnapshot()
  io.models = [builtin]
  io.owner = owner
  io.phase = 'ready'
  io.load.mockResolvedValue(undefined)
  io.request.mockResolvedValue({ providers: [
    { slug: 'deepseek', name: 'DeepSeek', authenticated: false, models: ['deepseek-flash'], api_key: 'must-not-leak' },
    { slug: 'custom:relay', name: 'Relay', authenticated: true, models: ['deepseek-flash'], api_url: 'private-route', key_env: 'PRIVATE_KEY' }
  ] })
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { accountAdapter: 'platform' } })
})

afterEach(() => Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop }))

it('prefers the actual available Aino model and returns metadata without touching a live route', async () => {
  const result = await answerPlatformConversationModelRequest(route, { action: 'select', query: 'DeepSeek Flash' })
  expect(result).toEqual({ status: 'selected', selection: {
    model_id: 'deepseek-flash', model_source: 'aino', provider: 'aino', name: 'DeepSeek Flash', owner
  } })
  expect(io.request).toHaveBeenCalledExactlyOnceWith('owned-connection', 'robot-profile', 'model.options', {
    explicit_only: true, include_unconfigured: false
  })
})

it('lists only available chat models and authenticated configured providers, without endpoint or key fields', async () => {
  io.models = [builtin, { ...platformModel('image'), purpose: 'image' }, { ...platformModel('down'), state: 'model_unavailable' }]
  const result = await answerPlatformConversationModelRequest(route, { action: 'list' })
  expect(result).toEqual({ status: 'available', models: [
    { model_id: 'deepseek-flash', model_source: 'aino', provider: 'aino', name: 'DeepSeek Flash', owner },
    { model_id: 'deepseek-flash', model_source: 'provider', provider: 'custom:relay', name: 'deepseek-flash' }
  ] })
  expect(JSON.stringify(result)).not.toMatch(/private-route|PRIVATE_KEY|must-not-leak/)
})

it('does not guess a model when a family matches two available built-ins', async () => {
  io.models = [builtin, { ...builtin, id: 'deepseek-pro', display_name: 'DeepSeek Pro' }]
  const result = await answerPlatformConversationModelRequest(route, { action: 'select', query: 'deepseek' })
  expect(result.status).toBe('ambiguous')
  expect(result.models?.map(row => row.model_id)).toEqual(['deepseek-flash', 'deepseek-pro'])
  expect(result.selection).toBeUndefined()
})

it('respects an explicit configured provider but refuses an unconfigured official provider', async () => {
  expect(await answerPlatformConversationModelRequest(route, { action: 'select', query: 'deepseek-flash', provider: 'deepseek' }))
    .toEqual({ status: 'not_found', models: [] })
  expect(await answerPlatformConversationModelRequest(route, { action: 'select', query: 'deepseek-flash', provider: 'custom:relay' }))
    .toMatchObject({ status: 'selected', selection: { provider: 'custom:relay', model_source: 'provider' } })
})

it('fences an account switch while the actual catalog is loading', async () => {
  const gate = deferred<void>()
  io.load.mockReturnValue(gate.promise)
  const pending = answerPlatformConversationModelRequest(route, { action: 'select', query: 'deepseek' })
  io.account = platformSnapshot('user-b', 2)
  gate.resolve()
  await expect(pending).rejects.toMatchObject({ code: 'platform_account_changed' })
})

it('never chooses an unrelated model for punctuation-only input', async () => {
  expect(await answerPlatformConversationModelRequest(route, { action: 'select', query: '--' }))
    .toEqual({ status: 'not_found', models: [] })
})

it('keeps configured providers usable without an Aino login', async () => {
  io.account = null
  io.owner = null
  io.phase = 'signed_out'
  const result = await answerPlatformConversationModelRequest(route, { action: 'select', query: 'deepseek-flash' })
  expect(result).toMatchObject({ status: 'selected', selection: { model_source: 'provider', provider: 'custom:relay' } })
})

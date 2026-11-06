import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { host } from '@/sdk'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { platformModelCatalog } from '@/store/platform-models'
import { $activeGatewayProfile } from '@/store/profile'
import { $connection, setCurrentModel, setCurrentProvider } from '@/store/session'
import { deferred } from '@/test/deferred'
import { platformModel, platformSnapshot } from '@/test/platform-model'

const io = vi.hoisted(() => ({
  order: [] as string[],
  globalModel: vi.fn(),
  retain: vi.fn(),
  agent: vi.fn(),
  profile: vi.fn(),
  active: vi.fn(),
  bind: vi.fn(),
  clear: vi.fn(),
  release: vi.fn()
}))

vi.mock('@/hermes', async original => ({
  ...await original<Record<string, unknown>>(),
  getGlobalModelInfo: io.globalModel
}))

vi.mock('@/store/gateway', async original => ({
  ...await original<Record<string, unknown>>(),
  retainGatewayForAgent: io.retain,
  requestGatewayForAgent: io.agent,
  requestGatewayForProfile: io.profile
}))

const route = { connectionId: 'local', profile: 'new-bot', targetProfile: 'backend-bot', mode: 'local' as const }
const account = platformSnapshot()
const owner = { user_id: account.account!.id, platform_origin: 'http://127.0.0.1:7001' }
const originalDesktop = window.hermesDesktop

function transport(method: string, params: Record<string, unknown> = {}) {
  io.order.push(method)

  if (method === 'session.create') {
    return { session_id: 'bot-runtime', stored_session_id: 'bot-stored', info: {
      model_source: params.model_source, model_id: params.model_id,
      model_status: 'awaiting_managed_credentials'
    } }
  }

  if (method === 'session.managed_model_ticket') {
    return { managed_model_binding: 1, session_ticket: 'private-ticket' }
  }

  if (method === 'session.close') { return {} }

  if (method === 'setup.runtime_check') { return { ok: false, error: 'No profile credential' } }
  throw new Error(`Unexpected ${method}`)
}

beforeEach(async () => {
  vi.clearAllMocks()
  io.order.length = 0
  localStorage.clear()
  clearGatewayManagedCapabilities()
  io.globalModel.mockImplementation(async () => {
    io.order.push('defaults')

    return { model: '', provider: '' }
  })
  io.retain.mockImplementation(async (connectionId, profile) => {
    io.order.push('ready')
    recordGatewayReadyCapability({ connectionId, profile }, { type: 'gateway.ready', payload: { managed_model_binding: 1 } } as never)

    return io.release
  })
  io.agent.mockImplementation(async (_connectionId, _profile, method, params) => transport(method, params))
  io.profile.mockImplementation(async (_profile, method, params) => transport(method, params))
  io.active.mockImplementation(async (method, params) => transport(method, params))
  io.bind.mockImplementation(async () => {
    io.order.push('bind')

    return { ok: true, ready: true, model_id: 'catalog-a', billing_source: 'aino' }
  })
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: {
    accountAdapter: 'platform',
    platformAccount: { status: async () => account, capabilities: async () => ({}), onChanged: () => () => undefined },
    platformModels: { list: async () => [platformModel()], owner: async () => owner, bind: io.bind, clear: io.clear }
  } })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  setCurrentProvider('another-provider')
  setCurrentModel('occupied-chat-model')
})

afterEach(() => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
  $connection.set(null)
  $activeGatewayProfile.set('default')
  clearGatewayManagedCapabilities()
})

it('creates and binds a follow-profile Bot Chat using its exact default route without composer state', async () => {
  const params = { source: 'desktop', profile: route.targetProfile, follow_profile_config: true, title: 'Bot Chat' }
  const created = await host.requestProfile<{ info: { model_status: string } }>(route, 'session.create', params)

  expect(created.info.model_status).toBe('ready')
  expect(io.order).toEqual(['ready', 'defaults', 'session.create', 'session.managed_model_ticket', 'bind'])
  expect(io.globalModel).toHaveBeenCalledWith({ connectionId: route.connectionId, profile: route.targetProfile })
  expect(io.agent.mock.calls.find(call => call[2] === 'session.create')?.slice(0, 4)).toEqual([
    route.connectionId, route.profile, 'session.create', { ...params, model_source: 'aino', model_id: 'catalog-a' }
  ])
  expect(io.bind).toHaveBeenCalledWith(expect.objectContaining({
    connection_id: route.connectionId, profile: route.profile, session_id: 'bot-runtime', model_id: 'catalog-a'
  }))
  expect(io.agent.mock.calls.some(call => call[2] === 'config.set')).toBe(false)
  expect(io.release).toHaveBeenCalledOnce()
})

it('keeps configured provider and explicit session selections on their existing create path', async () => {
  io.globalModel.mockResolvedValue({ model: 'third-party-model', provider: 'custom' })
  const followed = { follow_profile_config: true, profile: route.targetProfile }
  await host.requestProfile(route, 'session.create', followed)
  expect(io.agent.mock.calls.find(call => call[2] === 'session.create')?.[3]).toBe(followed)
  expect(io.bind).not.toHaveBeenCalled()

  io.globalModel.mockClear()
  const explicit = { ...followed, model: 'explicit-model', provider: 'custom' }
  await host.requestProfile(route, 'session.create', explicit)
  expect(io.globalModel).not.toHaveBeenCalled()
  expect(io.agent.mock.lastCall?.[3]).toBe(explicit)
})

it('captures the ambient SDK owner before asynchronous defaults and binding', async () => {
  const gatewayStore = await import('@/store/gateway')
  const ready = deferred<() => void>()
  io.retain.mockImplementation(async (connectionId, profile) => {
    recordGatewayReadyCapability({ connectionId, profile }, { type: 'gateway.ready', payload: { managed_model_binding: 1 } } as never)

    return ready.promise
  })
  $connection.set({ connectionId: 'remote-a', mode: 'remote' } as never)
  $activeGatewayProfile.set('ambient-bot')
  gatewayStore.$gateway.set({ request: io.active } as never)
  const pending = host.request('session.create', { follow_profile_config: true })
  $connection.set({ connectionId: 'remote-b', mode: 'remote' } as never)
  $activeGatewayProfile.set('other-bot')
  ready.resolve(io.release)
  await pending

  expect(io.globalModel).toHaveBeenCalledWith({ connectionId: 'remote-a', profile: 'ambient-bot' })
  expect(io.bind).toHaveBeenCalledWith(expect.objectContaining({ connection_id: 'remote-a', profile: 'ambient-bot' }))
  expect(io.active.mock.calls.find(call => call[0] === 'session.create')?.[1]).toMatchObject({
    profile: 'ambient-bot', follow_profile_config: true, model_source: 'aino', model_id: 'catalog-a'
  })
})

it('closes and clears a failed managed draft on the original bot route', async () => {
  io.bind.mockResolvedValue({ ok: false, error: { code: 'insufficient_balance' } })

  await expect(host.requestProfile(route, 'session.create', { follow_profile_config: true }))
    .rejects.toMatchObject({ code: 'insufficient_balance' })
  expect(io.agent.mock.calls.find(call => call[2] === 'session.close')?.slice(0, 4)).toEqual([
    route.connectionId, route.profile, 'session.close', { session_id: 'bot-runtime' }
  ])
  expect(io.clear).toHaveBeenCalledWith({ connection_id: route.connectionId, profile: route.profile, session_id: 'bot-runtime' })
  expect(io.release).toHaveBeenCalledOnce()
})

it('leaves non-platform sessions on the original SDK path', async () => {
  Object.assign(window.hermesDesktop, { accountAdapter: 'legacy-development' })
  const params = { follow_profile_config: true }
  await host.requestProfile(route, 'session.create', params)

  expect(io.globalModel).not.toHaveBeenCalled()
  expect(io.retain).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.agent.mock.lastCall?.[3]).toBe(params)
})

it('refuses to bind a Bot Chat when the account changes while creation is in flight', async () => {
  const creating = deferred<void>()
  const created = deferred<ReturnType<typeof transport>>()
  io.agent.mockImplementation(async (_connectionId, _profile, method, params) => {
    if (method === 'session.create') {
      creating.resolve()

      return created.promise
    }

    return transport(method, params)
  })
  const pending = host.requestProfile(route, 'session.create', { follow_profile_config: true })
  await creating.promise
  window.hermesDesktop.platformAccount.status = async () => platformSnapshot('user-b', 2)
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  created.resolve(transport('session.create', { model_source: 'aino', model_id: 'catalog-a' }))

  await expect(pending).rejects.toMatchObject({ code: 'platform_account_changed' })
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.clear).toHaveBeenCalledWith({ connection_id: route.connectionId, profile: route.profile, session_id: 'bot-runtime' })
  expect(io.release).toHaveBeenCalledOnce()
})

it('recognizes the new bot account default when its profile has no provider credential', async () => {
  const target = { ...route, profile: 'default', targetProfile: 'default' }
  const result = await host.requestProfile(target, 'setup.runtime_check', { profile: 'new-bot' })

  expect(result).toEqual({ ok: true, provider: 'aino', model: 'catalog-a' })
  expect(io.globalModel).toHaveBeenCalledWith({ connectionId: target.connectionId, profile: 'new-bot' })
  expect(io.agent.mock.calls.some(call => call[2] === 'setup.runtime_check')).toBe(false)
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.release).toHaveBeenCalledOnce()
})

it('preserves the runtime failure for a configured third-party profile', async () => {
  io.globalModel.mockResolvedValue({ model: 'custom-model', provider: 'custom' })
  const result = await host.requestProfile(route, 'setup.runtime_check', { profile: route.targetProfile })

  expect(result).toEqual({ ok: false, error: 'No profile credential' })
  expect(io.bind).not.toHaveBeenCalled()
})

it('does not mark an unknown managed gateway ready from the catalog alone', async () => {
  io.retain.mockResolvedValue(io.release)
  const result = await host.requestProfile(route, 'setup.runtime_check', { profile: route.targetProfile })

  expect(result).toEqual({ ok: false, error: 'No profile credential' })
  expect(io.bind).not.toHaveBeenCalled()
})

it('rejects an old account revision while waiting for the bot socket', async () => {
  const retained = deferred<() => void>()
  io.retain.mockImplementation(async (connectionId, profile) => {
    recordGatewayReadyCapability({ connectionId, profile }, { type: 'gateway.ready', payload: { managed_model_binding: 1 } } as never)

    return retained.promise
  })
  const pending = host.requestProfile(route, 'session.create', { follow_profile_config: true })
  window.hermesDesktop.platformAccount.status = async () => platformSnapshot('user-a', 2)
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  retained.resolve(io.release)

  await expect(pending).rejects.toMatchObject({ code: 'platform_account_changed' })
  expect(io.agent.mock.calls.some(call => call[2] === 'session.create')).toBe(false)
  expect(io.release).toHaveBeenCalledOnce()
})

it('rejects an old account revision refreshed during authority capture', async () => {
  window.hermesDesktop.platformAccount.status = async () => platformSnapshot('user-a', 2)

  await expect(host.requestProfile(route, 'session.create', { follow_profile_config: true }))
    .rejects.toMatchObject({ code: 'platform_account_changed' })
  expect(io.agent.mock.calls.some(call => call[2] === 'session.create')).toBe(false)
  expect(io.release).toHaveBeenCalledOnce()
})

it('keeps the active desktop alias distinct from the requested backend target', async () => {
  const gatewayStore = await import('@/store/gateway')
  $connection.set({ connectionId: 'alias-source', mode: 'remote', profile: 'backend-target' } as never)
  $activeGatewayProfile.set('desktop-alias')
  gatewayStore.$gateway.set({ request: io.active } as never)
  window.hermesDesktop.getProfileRoutes = vi.fn(async () => [
    { connectionId: 'alias-source', profile: 'desktop-alias', targetProfile: 'backend-target', mode: 'remote' as const }
  ])
  await host.request('session.create', { profile: 'backend-target', follow_profile_config: true })

  expect(io.retain).toHaveBeenCalledWith('alias-source', 'desktop-alias', expect.anything())
  expect(io.bind).toHaveBeenCalledWith(expect.objectContaining({ connection_id: 'alias-source', profile: 'desktop-alias' }))
  expect(io.active.mock.calls.find(call => call[0] === 'session.create')?.[1]).toMatchObject({ profile: 'backend-target' })
})

it('resolves a newly created bot through native routes before the cached roster knows it', async () => {
  const gatewayStore = await import('@/store/gateway')
  $connection.set({ connectionId: 'local', mode: 'local', profile: 'default' } as never)
  $activeGatewayProfile.set('default')
  gatewayStore.$gateway.set({ request: io.active } as never)
  window.hermesDesktop.getProfileRoutes = vi.fn(async () => [
    { connectionId: 'local', profile: 'default', targetProfile: 'default', mode: 'local' as const },
    { connectionId: 'local', profile: 'cold-new-bot', targetProfile: 'cold-new-bot', mode: 'local' as const }
  ])
  await host.request('session.create', { profile: 'cold-new-bot', follow_profile_config: true })

  expect(window.hermesDesktop.getProfileRoutes).toHaveBeenCalledWith(['default', 'cold-new-bot'])
  expect(io.agent.mock.calls.find(call => call[2] === 'session.create')?.slice(0, 2)).toEqual(['local', 'cold-new-bot'])
  expect(io.bind).toHaveBeenCalledWith(expect.objectContaining({ connection_id: 'local', profile: 'cold-new-bot' }))
  expect(io.active).not.toHaveBeenCalled()
})

it('rejects an account change while resolving an ambient cross-profile route', async () => {
  const gatewayStore = await import('@/store/gateway')
  const routes = deferred<Awaited<ReturnType<NonNullable<Window['hermesDesktop']['getProfileRoutes']>>>>()
  $connection.set({ connectionId: 'local', mode: 'local', profile: 'default' } as never)
  $activeGatewayProfile.set('default')
  gatewayStore.$gateway.set({ request: io.active } as never)
  window.hermesDesktop.getProfileRoutes = vi.fn(async () => routes.promise)
  const pending = host.request('session.create', { profile: 'cold-new-bot', follow_profile_config: true })
  window.hermesDesktop.platformAccount.status = async () => platformSnapshot('user-a', 2)
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  routes.resolve([{ connectionId: 'local', profile: 'cold-new-bot', targetProfile: 'cold-new-bot', mode: 'local' }])

  await expect(pending).rejects.toMatchObject({ code: 'platform_account_changed' })
  expect(io.agent).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
})

it('refuses a managed cross-profile create when native inventory cannot prove its route', async () => {
  const gatewayStore = await import('@/store/gateway')
  $connection.set({ connectionId: 'local', mode: 'local', profile: 'default' } as never)
  $activeGatewayProfile.set('default')
  gatewayStore.$gateway.set({ request: io.active } as never)
  window.hermesDesktop.getProfileRoutes = vi.fn(async () => [])

  await expect(host.request('session.create', { profile: 'unresolved-bot', follow_profile_config: true }))
    .rejects.toMatchObject({ code: 'unsupported_gateway' })
  expect(io.agent).not.toHaveBeenCalled()
  expect(io.active).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
})

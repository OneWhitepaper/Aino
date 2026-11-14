import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { host } from '@/sdk'
import { clearGatewayManagedCapabilities, recordGatewayReadyCapability } from '@/store/gateway-managed-capability'
import { platformModelCatalog, readPlatformDefault, writePlatformDefault } from '@/store/platform-models'
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
  ...(await original<Record<string, unknown>>()),
  getGlobalModelInfo: io.globalModel
}))

vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
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
    return {
      session_id: 'bot-runtime',
      stored_session_id: 'bot-stored',
      info: {
        model_source: params.model_source,
        model_id: params.model_id,
        model_status: 'awaiting_managed_credentials'
      }
    }
  }

  if (method === 'session.managed_model_ticket') {
    return { managed_model_binding: 1, session_ticket: 'private-ticket' }
  }

  if (method === 'session.close') {
    return {}
  }

  if (method === 'profiles.create') {
    return { ok: true, name: params.name }
  }

  if (method === 'setup.runtime_check') {
    return { ok: false, error: 'No profile credential' }
  }

  if (method === 'groups.capabilities') {
    return { methods: ['groups.prepare_model'] }
  }

  if (method === 'groups.state') {
    return {
      room: {
        members: [
          { member_id: 'seat-a', profile: 'bot-a', target: { kind: 'local' } },
          { member_id: 'seat-b', profile: 'bot-b', target: { kind: 'local' } }
        ]
      }
    }
  }

  if (method === 'groups.prepare_model') {
    return {
      profile: params.member_id === 'seat-a' ? 'bot-a' : 'bot-b',
      session_id: `group-${params.member_id}`,
      model_id: params.model_id,
      ...(params.follow_profile_config === true ? { follow_profile_config: true } : {}),
      managed_model_binding: 1,
      session_ticket: `group-ticket-${params.member_id}`
    }
  }

  if (['groups.send', 'groups.retry', 'groups.approve', 'groups.stop'].includes(method)) {
    return { ok: true }
  }

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
    recordGatewayReadyCapability({ connectionId, profile }, {
      type: 'gateway.ready',
      payload: { managed_model_binding: 1 }
    } as never)

    return io.release
  })
  io.agent.mockImplementation(async (_connectionId, _profile, method, params) => transport(method, params))
  io.profile.mockImplementation(async (_profile, method, params) => transport(method, params))
  io.active.mockImplementation(async (method, params) => transport(method, params))
  io.bind.mockImplementation(async () => {
    io.order.push('bind')

    return { ok: true, ready: true, model_id: 'catalog-a', billing_source: 'aino' }
  })
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      accountAdapter: 'platform',
      platformAccount: {
        status: async () => account,
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: async () => [platformModel()], owner: async () => owner, bind: io.bind, clear: io.clear }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().load()
  setCurrentProvider('another-provider')
  setCurrentModel('occupied-chat-model')
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
  $connection.set(null)
  $activeGatewayProfile.set('default')
  clearGatewayManagedCapabilities()
})

it('binds each hosted member independently before sending the exact journaled group intent', async () => {
  const params = { room_id: 'room-a', event_id: 'same-event', payload: { text: '@bot-a hello' } }
  await host.requestProfile(route, 'groups.send', params)

  expect(io.bind).toHaveBeenCalledTimes(2)
  expect(io.bind).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      connection_id: route.connectionId,
      profile: 'bot-a',
      session_id: 'group-seat-a',
      model_id: 'catalog-a',
      session_ticket: 'group-ticket-seat-a'
    })
  )
  expect(io.bind).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      connection_id: route.connectionId,
      profile: 'bot-b',
      session_id: 'group-seat-b',
      session_ticket: 'group-ticket-seat-b'
    })
  )
  expect(io.order.at(-1)).toBe('groups.send')
  expect(io.agent.mock.lastCall?.slice(0, 4)).toEqual([route.connectionId, route.profile, 'groups.send', params])
  expect(io.agent.mock.lastCall?.[3]).toBe(params)
  expect(io.agent.mock.calls.filter(call => call[2] === 'groups.prepare_model').map(call => call[3])).toEqual([
    { profile: route.targetProfile, room_id: 'room-a', member_id: 'seat-a', model_id: 'catalog-a', owner },
    { profile: route.targetProfile, room_id: 'room-a', member_id: 'seat-b', model_id: 'catalog-a', owner }
  ])
  expect(
    io.agent.mock.calls.some(call => call[2] === 'session.create' || call[2] === 'session.managed_model_ticket')
  ).toBe(false)
  expect(io.release).toHaveBeenCalledOnce()
})

it('restores only the failed member binding before retry after a runtime restart', async () => {
  const params = {
    room_id: 'room-a',
    member_id: 'seat-a',
    task_id: 'old-task',
    execution_generation: 1,
    choice: 'once'
  }

  await host.requestProfile(route, 'groups.retry', params)
  expect(io.bind).toHaveBeenCalledOnce()
  expect(io.order.at(-1)).toBe('groups.retry')
  expect(io.agent.mock.lastCall?.[3]).toBe(params)
})

it('approves the existing task without switching its frozen model to a newer default', async () => {
  const params = {
    room_id: 'room-a',
    member_id: 'seat-a',
    task_id: 'old-task',
    execution_generation: 1,
    choice: 'once'
  }

  await host.requestProfile(route, 'groups.approve', params)
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.globalModel).not.toHaveBeenCalled()
  expect(io.agent.mock.lastCall?.[3]).toBe(params)
})

it('does not replace explicitly configured providers or prepare bindings for stop', async () => {
  io.globalModel.mockResolvedValue({ model: 'external', provider: 'custom' })
  await host.requestProfile(route, 'groups.send', { room_id: 'room-a', payload: { text: 'hello' } })
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.agent.mock.calls.filter(call => call[2] === 'groups.prepare_model').map(call => call[3])).toEqual([
    { profile: route.targetProfile, room_id: 'room-a', member_id: 'seat-a', follow_profile_config: true },
    { profile: route.targetProfile, room_id: 'room-a', member_id: 'seat-b', follow_profile_config: true }
  ])
  io.globalModel.mockClear()
  await host.requestProfile(route, 'groups.stop', { room_id: 'room-a' })
  expect(io.globalModel).not.toHaveBeenCalled()
})

it('blocks group execution when one member cannot bind without retiring its exact intent', async () => {
  io.bind.mockResolvedValue({ ok: false, error: { code: 'insufficient_balance' } })
  await expect(
    host.requestProfile(route, 'groups.send', { room_id: 'room-a', payload: { text: 'hello' } })
  ).rejects.toMatchObject({ code: 'insufficient_balance', data: { admitted: false } })
  expect(io.agent.mock.calls.some(call => call[2] === 'groups.send')).toBe(false)
  expect(io.agent.mock.calls.some(call => call[2] === 'session.close')).toBe(false)
  expect(io.release).toHaveBeenCalledOnce()
})

it('fences account changes while a group member ticket is prepared', async () => {
  const preparing = deferred<void>()
  const prepared = deferred<ReturnType<typeof transport>>()
  io.agent.mockImplementation(async (_connectionId, _profile, method, params) => {
    if (method === 'groups.prepare_model') {
      preparing.resolve()

      return prepared.promise
    }

    return transport(method, params)
  })
  const pending = host.requestProfile(route, 'groups.send', { room_id: 'room-a', payload: { text: 'hello' } })
  // A broken implementation must fail the test promptly instead of hanging on a never-issued ticket.
  await vi.waitFor(() => expect(io.agent.mock.calls.some(call => call[2] === 'groups.prepare_model')).toBe(true))
  await preparing.promise
  window.hermesDesktop.platformAccount.status = async () => platformSnapshot('user-b', 2)
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  prepared.resolve(transport('groups.prepare_model', { member_id: 'seat-a', model_id: 'catalog-a' }))
  await expect(pending).rejects.toMatchObject({ code: 'platform_account_changed', data: { admitted: false } })
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.agent.mock.calls.some(call => call[2] === 'groups.send')).toBe(false)
})

it.each(['retain', 'defaults', 'prepare'] as const)(
  'proves a group Send admitted nothing when %s fails before dispatch',
  async phase => {
    const failure = Object.freeze(
      Object.assign(new Error(`${phase} unavailable`), {
        code: 4201,
        data: Object.freeze({ reason: 'unavailable', retryable: true })
      })
    )

    if (phase === 'retain') {
      io.retain.mockRejectedValueOnce(failure)
    } else if (phase === 'defaults') {
      io.globalModel.mockRejectedValueOnce(failure)
    } else {
      io.agent.mockImplementation(async (_connectionId, _profile, method, params) => {
        if (method === 'groups.prepare_model') {
          throw failure
        }

        return transport(method, params)
      })
    }

    await expect(
      host.requestProfile(route, 'groups.send', { room_id: 'room-a', payload: { text: 'hello' } })
    ).rejects.toMatchObject({
      message: failure.message,
      code: 4201,
      data: { reason: 'unavailable', retryable: true, admitted: false }
    })
    expect(failure.data).toEqual({ reason: 'unavailable', retryable: true })
    expect(io.agent.mock.calls.some(call => call[2] === 'groups.send')).toBe(false)
    expect(io.release).toHaveBeenCalledTimes(phase === 'retain' ? 0 : 1)
  }
)

it('preserves the original error once group Send dispatch begins even if lease cleanup also fails', async () => {
  const failure = Object.assign(new Error('send result unknown'), { code: 4202, data: { reason: 'disconnected' } })
  io.agent.mockImplementation(async (_connectionId, _profile, method, params) => {
    if (method === 'groups.send') {
      throw failure
    }

    return transport(method, params)
  })
  io.release.mockImplementationOnce(() => {
    throw new Error('lease cleanup failed')
  })
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  try {
    await expect(
      host.requestProfile(route, 'groups.send', { room_id: 'room-a', payload: { text: 'hello' } })
    ).rejects.toBe(failure)
    expect(failure.data).toEqual({ reason: 'disconnected' })
    expect(io.agent.mock.calls.filter(call => call[2] === 'groups.send')).toHaveLength(1)
    expect(io.release).toHaveBeenCalledOnce()
  } finally {
    warning.mockRestore()
  }
})

it('does not add a group Send admission marker to retry preparation failures', async () => {
  const failure = Object.assign(new Error('retry retain failed'), { code: 4203 })
  io.retain.mockRejectedValueOnce(failure)
  await expect(host.requestProfile(route, 'groups.retry', { room_id: 'room-a', member_id: 'seat-a' })).rejects.toBe(
    failure
  )
  expect(failure).not.toHaveProperty('data')
})

it('creates and binds a follow-profile Bot Chat using its exact default route without composer state', async () => {
  const params = { source: 'desktop', profile: route.targetProfile, follow_profile_config: true, title: 'Bot Chat' }
  const created = await host.requestProfile<{ info: { model_status: string } }>(route, 'session.create', params)

  expect(created.info.model_status).toBe('ready')
  expect(io.order).toEqual(['ready', 'defaults', 'session.create', 'session.managed_model_ticket', 'bind'])
  expect(io.globalModel).toHaveBeenCalledWith({ connectionId: route.connectionId, profile: route.targetProfile })
  expect(io.agent.mock.calls.find(call => call[2] === 'session.create')?.slice(0, 4)).toEqual([
    route.connectionId,
    route.profile,
    'session.create',
    { ...params, model_source: 'aino', model_id: 'catalog-a' }
  ])
  expect(io.bind).toHaveBeenCalledWith(
    expect.objectContaining({
      connection_id: route.connectionId,
      profile: route.profile,
      session_id: 'bot-runtime',
      model_id: 'catalog-a'
    })
  )
  expect(io.agent.mock.calls.some(call => call[2] === 'config.set')).toBe(false)
  expect(io.release).toHaveBeenCalledOnce()
})

it.each(['', 'nous'])('opens an unselected canonical Bot despite an ambient provider (%s)', async provider => {
  window.hermesDesktop.platformModels.list = async () => [{ ...platformModel(), is_default: false }]
  await platformModelCatalog().refresh()

  const params = {
    source: 'desktop',
    profile: route.targetProfile,
    title: 'Bot Chat',
    hidden: true,
    follow_profile_config: true
  }

  io.agent.mockImplementation(async (_connectionId, _profile, method, payload) => {
    if (method === 'session.create') {
      return {
        session_id: 'empty-runtime',
        stored_session_id: 'empty-stored',
        info: { model: 'z-ai/glm-5.3', provider }
      }
    }

    if (method === 'model.options') {
      return {
        model: 'z-ai/glm-5.3',
        provider,
        providers: [],
        session_info: { model: 'z-ai/glm-5.3', provider, running: false }
      }
    }

    return transport(method, payload)
  })

  await expect(host.requestProfile(route, 'session.create', params)).resolves.toMatchObject({
    session_id: 'empty-runtime',
    info: { model: '', provider: '' }
  })
  expect(io.agent.mock.calls.find(call => call[2] === 'session.create')?.slice(0, 4)).toEqual([
    route.connectionId,
    route.profile,
    'session.create',
    params
  ])
  expect(io.bind).not.toHaveBeenCalled()
  expect(readPlatformDefault(account.account!.id, route, account.mode, owner.platform_origin)).toBeNull()
})

it('rejects an unselected canonical creation response after its account changed', async () => {
  window.hermesDesktop.platformModels.list = async () => [{ ...platformModel(), is_default: false }]
  await platformModelCatalog().refresh()
  const created = deferred<Record<string, unknown>>()
  io.agent.mockImplementation(async (_connectionId, _profile, method, payload) =>
    method === 'session.create' ? created.promise : transport(method, payload)
  )

  const pending = host.requestProfile(route, 'session.create', {
    title: 'Bot Chat',
    hidden: true,
    follow_profile_config: true
  })

  await vi.waitFor(() => expect(io.agent.mock.calls.some(call => call[2] === 'session.create')).toBe(true))
  window.hermesDesktop.platformAccount.status = async () => platformSnapshot('user-b', 2)
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  created.resolve({ session_id: 'old-runtime', info: { model: 'z-ai/glm-5.3' } })
  await expect(pending).rejects.toMatchObject({ code: 'platform_account_changed' })
  expect(io.bind).not.toHaveBeenCalled()
})

it.each([
  { title: 'Other Chat', hidden: true },
  { title: 'Bot Chat', hidden: false }
])('does not waive model selection for noncanonical creation: %j', async params => {
  window.hermesDesktop.platformModels.list = async () => [{ ...platformModel(), is_default: false }]
  await platformModelCatalog().refresh()

  await expect(
    host.requestProfile(route, 'session.create', { follow_profile_config: true, ...params })
  ).rejects.toMatchObject({ code: 'model_unavailable' })
  expect(io.agent.mock.calls.some(call => call[2] === 'session.create')).toBe(false)
})

it('does not create an unselected canonical Bot when no text model is available', async () => {
  window.hermesDesktop.platformModels.list = async () => []
  await platformModelCatalog().refresh()

  await expect(
    host.requestProfile(route, 'session.create', {
      title: 'Bot Chat',
      hidden: true,
      follow_profile_config: true
    })
  ).rejects.toMatchObject({ code: 'model_unavailable' })
  expect(io.agent.mock.calls.some(call => call[2] === 'session.create')).toBe(false)
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
    recordGatewayReadyCapability({ connectionId, profile }, {
      type: 'gateway.ready',
      payload: { managed_model_binding: 1 }
    } as never)

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
    profile: 'ambient-bot',
    follow_profile_config: true,
    model_source: 'aino',
    model_id: 'catalog-a'
  })
})

it('closes and clears a failed managed draft on the original bot route', async () => {
  io.bind.mockResolvedValue({ ok: false, error: { code: 'insufficient_balance' } })

  await expect(host.requestProfile(route, 'session.create', { follow_profile_config: true })).rejects.toMatchObject({
    code: 'insufficient_balance'
  })
  expect(io.agent.mock.calls.find(call => call[2] === 'session.close')?.slice(0, 4)).toEqual([
    route.connectionId,
    route.profile,
    'session.close',
    { session_id: 'bot-runtime' }
  ])
  expect(io.clear).toHaveBeenCalledWith({
    connection_id: route.connectionId,
    profile: route.profile,
    session_id: 'bot-runtime'
  })
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
  expect(io.clear).toHaveBeenCalledWith({
    connection_id: route.connectionId,
    profile: route.profile,
    session_id: 'bot-runtime'
  })
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

it('inherits the cloned workspace saved Aino model without using the occupied composer or an arbitrary catalog model', async () => {
  const source = { ...route, profile: 'default', targetProfile: 'default' }
  const target = { ...source, profile: 'cloned-bot', targetProfile: 'cloned-bot' }
  window.hermesDesktop.platformModels.list = async () => [{ ...platformModel(), is_default: false }]
  await platformModelCatalog().refresh()
  writePlatformDefault(account.account!.id, 'catalog-a', source, account.mode, owner.platform_origin)

  await host.requestProfile(source, 'profiles.create', { name: target.profile, clone_from: 'default' })

  expect(readPlatformDefault(account.account!.id, target, account.mode, owner.platform_origin)).toBe('catalog-a')
  expect(await host.requestProfile(target, 'setup.runtime_check')).toMatchObject({
    ok: true,
    provider: 'aino',
    model: 'catalog-a'
  })
  expect(await host.requestProfile(target, 'session.create', { follow_profile_config: true })).toMatchObject({
    info: { model_id: 'catalog-a', model_status: 'ready' }
  })
})

it('repairs a legacy empty Bot’s missing Aino inheritance without replacing another member’s saved model', async () => {
  window.hermesDesktop.platformModels.list = async () => [
    { ...platformModel('first-model'), is_default: false },
    { ...platformModel('workspace-model'), is_default: false },
    { ...platformModel('bot-model'), is_default: false }
  ]
  await platformModelCatalog().refresh()
  const root = { connectionId: 'local', profile: 'default' }
  const own = { connectionId: 'local', profile: 'bot-a' }
  const inherited = { connectionId: 'local', profile: 'bot-b' }
  writePlatformDefault(account.account!.id, 'workspace-model', root, account.mode, owner.platform_origin)
  writePlatformDefault(account.account!.id, 'bot-model', own, account.mode, owner.platform_origin)

  await host.requestProfile(route, 'groups.send', {
    room_id: 'old-room',
    event_id: 'old-room-event',
    payload: { text: 'hello' }
  })

  expect(io.bind.mock.calls.map(([params]) => [params.profile, params.model_id])).toEqual([
    ['bot-a', 'bot-model'],
    ['bot-b', 'workspace-model']
  ])
  expect(readPlatformDefault(account.account!.id, inherited, account.mode, owner.platform_origin)).toBe(
    'workspace-model'
  )
  writePlatformDefault(account.account!.id, 'first-model', root, account.mode, owner.platform_origin)
  expect(await host.requestProfile({ ...route, targetProfile: 'bot-b' }, 'setup.runtime_check')).toMatchObject({
    model: 'workspace-model'
  })
})

it.each(['other-connection', 'explicit-unavailable', 'provider-source'])(
  'does not repair an empty Bot from an unauthorized or inactive default: %s',
  async scenario => {
    window.hermesDesktop.platformModels.list = async () => [{ ...platformModel(), is_default: false }]
    await platformModelCatalog().refresh()
    const root = { connectionId: scenario === 'other-connection' ? 'studio' : 'local', profile: 'default' }
    writePlatformDefault(account.account!.id, 'catalog-a', root, account.mode, owner.platform_origin)

    if (scenario === 'explicit-unavailable') {
      writePlatformDefault(
        account.account!.id,
        'removed-model',
        { connectionId: 'local', profile: 'bot-a' },
        account.mode,
        owner.platform_origin
      )
    }
    if (scenario === 'provider-source') {
      io.globalModel.mockImplementation(async (scope: { profile: string }) =>
        scope.profile === 'default' ? { model: 'custom-model', provider: 'custom' } : { model: '', provider: '' }
      )
    }

    await expect(
      host.requestProfile(route, 'groups.send', {
        room_id: 'old-room',
        event_id: 'not-dispatched',
        payload: { text: 'hello' }
      })
    ).rejects.toMatchObject({ code: 'model_unavailable', data: { admitted: false } })
    expect(io.bind).not.toHaveBeenCalled()
    expect(io.agent.mock.calls.some(call => call[2] === 'groups.send')).toBe(false)
  }
)

it('snapshots the source effective Aino default when only the API catalog supplies it', async () => {
  const source = { ...route, profile: 'default', targetProfile: 'default' }
  const target = { ...source, profile: 'cloned-bot', targetProfile: 'cloned-bot' }
  expect(readPlatformDefault(account.account!.id, source, account.mode, owner.platform_origin)).toBeNull()

  await host.requestProfile(source, 'profiles.create', { name: target.profile, clone_from: 'default' })

  expect(readPlatformDefault(account.account!.id, target, account.mode, owner.platform_origin)).toBe('catalog-a')
  window.hermesDesktop.platformModels.list = async () => [
    { ...platformModel(), is_default: false },
    platformModel('catalog-b')
  ]
  await platformModelCatalog().refresh()
  expect(await host.requestProfile(target, 'setup.runtime_check')).toMatchObject({ model: 'catalog-a' })

  // Later workspace and Bot edits are independent snapshots, not linked defaults.
  writePlatformDefault(account.account!.id, 'catalog-b', source, account.mode, owner.platform_origin)
  expect(readPlatformDefault(account.account!.id, target, account.mode, owner.platform_origin)).toBe('catalog-a')
  writePlatformDefault(account.account!.id, 'bot-only', target, account.mode, owner.platform_origin)
  expect(readPlatformDefault(account.account!.id, source, account.mode, owner.platform_origin)).toBe('catalog-b')
})

it('does not invent an inherited default from the first available catalog model', async () => {
  window.hermesDesktop.platformModels.list = async () => [{ ...platformModel(), is_default: false }]
  await platformModelCatalog().refresh()
  await host.requestProfile(route, 'profiles.create', { name: route.profile, clone_from: 'default' })

  expect(readPlatformDefault(account.account!.id, route, account.mode, owner.platform_origin)).toBeNull()
})

it('does not replace the cloned third-party source with the Aino catalog default', async () => {
  io.globalModel.mockResolvedValue({ model: 'third-party', provider: 'custom' })
  await host.requestProfile(route, 'profiles.create', { name: route.profile, clone_from: 'default' })

  expect(readPlatformDefault(account.account!.id, route, account.mode, owner.platform_origin)).toBeNull()
})

it.each([{ clone_from: null }, { clone_from: 'default', model: 'explicit-model', provider: 'custom' }])(
  'clears stale defaults without inheriting for fresh or explicitly configured bot: %j',
  async params => {
    writePlatformDefault(
      account.account!.id,
      'catalog-a',
      { connectionId: 'local', profile: 'default' },
      account.mode,
      owner.platform_origin
    )
    writePlatformDefault(account.account!.id, 'deleted-bot-model', route, account.mode, owner.platform_origin)

    await host.requestProfile(route, 'profiles.create', { name: route.profile, ...params })

    expect(readPlatformDefault(account.account!.id, route, account.mode, owner.platform_origin)).toBeNull()
  }
)

it('does not borrow clone preferences from another connection or copy a preference shadowed by a third-party model', async () => {
  window.hermesDesktop.platformModels.list = async () => [{ ...platformModel(), is_default: false }]
  await platformModelCatalog().refresh()
  writePlatformDefault(
    account.account!.id,
    'catalog-a',
    { connectionId: 'other-source', profile: 'default' },
    account.mode,
    owner.platform_origin
  )
  await host.requestProfile(route, 'profiles.create', { name: route.profile, clone_from: 'default' })
  expect(readPlatformDefault(account.account!.id, route, account.mode, owner.platform_origin)).toBeNull()

  writePlatformDefault(
    account.account!.id,
    'catalog-a',
    { connectionId: 'local', profile: 'default' },
    account.mode,
    owner.platform_origin
  )
  io.globalModel.mockResolvedValue({ model: 'third-party', provider: 'custom' })
  await host.requestProfile(route, 'profiles.create', { name: route.profile, clone_from: 'default' })
  expect(readPlatformDefault(account.account!.id, route, account.mode, owner.platform_origin)).toBeNull()
})

it('does not alter default preferences when profile creation fails or the account changes before completion', async () => {
  const source = { ...route, profile: 'default', targetProfile: 'default' }
  writePlatformDefault(account.account!.id, 'catalog-a', source, account.mode, owner.platform_origin)
  writePlatformDefault(account.account!.id, 'original-target', route, account.mode, owner.platform_origin)
  io.agent.mockRejectedValueOnce(new Error('profile already exists'))
  await expect(
    host.requestProfile(source, 'profiles.create', { name: route.profile, clone_from: 'default' })
  ).rejects.toThrow('profile already exists')
  expect(readPlatformDefault(account.account!.id, route, account.mode, owner.platform_origin)).toBe('original-target')

  const created = deferred<{ ok: boolean; name: string }>()
  io.agent.mockReturnValueOnce(created.promise)
  const pending = host.requestProfile(source, 'profiles.create', { name: route.profile, clone_from: 'default' })
  await vi.waitFor(() => expect(io.agent).toHaveBeenCalledTimes(2))
  window.hermesDesktop.platformAccount.status = async () => platformSnapshot('user-b', 2)
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  created.resolve({ ok: true, name: route.profile })
  await pending
  expect(readPlatformDefault(account.account!.id, route, account.mode, owner.platform_origin)).toBe('original-target')
  expect(readPlatformDefault('user-b', route, account.mode, owner.platform_origin)).toBeNull()
})

it.each(['offline', 'reauth_required'] as const)(
  'creates a managed Bot Chat with a retained device identity while management is %s',
  async phase => {
    const snapshot = { ...account, phase, model_identity_ready: true, model_identity_version: 1 }
    window.hermesDesktop.platformAccount.status = async () => snapshot
    await platformAccountActions(window.hermesDesktop.platformAccount).refresh()

    expect(await host.requestProfile(route, 'setup.runtime_check', { profile: route.targetProfile })).toMatchObject({
      ok: true,
      provider: 'aino',
      model: 'catalog-a'
    })
    const created = await host.requestProfile(route, 'session.create', { follow_profile_config: true })

    expect(created).toMatchObject({ info: { model_source: 'aino', model_id: 'catalog-a', model_status: 'ready' } })
    expect(io.bind).toHaveBeenCalledWith(
      expect.objectContaining({ model_id: 'catalog-a', expected_account_revision: snapshot.revision })
    )
    expect(io.agent.mock.calls.some(call => call[2] === 'setup.runtime_check')).toBe(false)
  }
)

it('never borrows an Aino model for an offline account without a retained device identity', async () => {
  window.hermesDesktop.platformAccount.status = async () => ({
    ...account,
    phase: 'offline',
    model_identity_ready: false
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()

  expect(await host.requestProfile(route, 'setup.runtime_check', { profile: route.targetProfile })).toEqual({
    ok: false,
    error: 'No profile credential'
  })
  expect(io.bind).not.toHaveBeenCalled()
})

it('preserves the runtime failure for a configured third-party profile', async () => {
  io.retain.mockResolvedValue(io.release)
  io.globalModel.mockResolvedValue({ model: 'custom-model', provider: 'custom' })
  const result = await host.requestProfile(route, 'setup.runtime_check', { profile: route.targetProfile })

  expect(result).toEqual({ ok: false, error: 'No profile credential' })
  expect(io.bind).not.toHaveBeenCalled()
})

it.each(['setup.runtime_check', 'session.create'])(
  'waits for the bot gateway capability before %s instead of requesting a profile API key',
  async method => {
    vi.useFakeTimers()
    io.retain.mockResolvedValue(io.release)
    const params = { profile: route.targetProfile, follow_profile_config: true }
    let settled = false

    const pending = host.requestProfile(route, method, params).finally(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(0)

    recordGatewayReadyCapability({ connectionId: 'other', profile: route.profile }, {
      type: 'gateway.ready',
      payload: { managed_model_binding: 1 }
    } as never)
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    expect(io.agent).not.toHaveBeenCalled()

    recordGatewayReadyCapability(route, { type: 'gateway.ready', payload: { managed_model_binding: 1 } } as never)
    const result = await pending

    expect(result).toMatchObject(
      method === 'session.create'
        ? { info: { model_source: 'aino', model_id: 'catalog-a', model_status: 'ready' } }
        : { ok: true, provider: 'aino', model: 'catalog-a' }
    )
    expect(io.agent.mock.calls.some(call => call[2] === 'setup.runtime_check')).toBe(false)
    expect(io.release).toHaveBeenCalledOnce()
    // Let nanostores retire their short-lived subscriptions; the 20s handshake must already be gone.
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.getTimerCount()).toBe(0)
  }
)

it('bounds an absent capability handshake without falling back to missing profile credentials', async () => {
  vi.useFakeTimers()
  io.retain.mockResolvedValue(io.release)
  const pending = host.requestProfile(route, 'setup.runtime_check', { profile: route.targetProfile })
  await vi.advanceTimersByTimeAsync(20_000)

  expect(await pending).toMatchObject({ ok: false, provider: 'aino', error_code: 'unsupported_gateway' })
  expect(io.agent).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.release).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1000)
  expect(vi.getTimerCount()).toBe(0)
})

it('refuses a Bot Chat on a gateway that explicitly lacks managed models', async () => {
  io.retain.mockImplementation(async (connectionId, profile) => {
    recordGatewayReadyCapability({ connectionId, profile }, { type: 'gateway.ready', payload: {} } as never)

    return io.release
  })

  await expect(host.requestProfile(route, 'session.create', { follow_profile_config: true })).rejects.toMatchObject({
    code: 'unsupported_gateway'
  })
  expect(io.agent).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.release).toHaveBeenCalledOnce()
})

it('does not create or bind under an account changed during the capability handshake', async () => {
  vi.useFakeTimers()
  io.retain.mockResolvedValue(io.release)

  const pending = host.requestProfile(route, 'session.create', { follow_profile_config: true }).then(
    result => ({ result }),
    error => ({ error })
  )

  await vi.advanceTimersByTimeAsync(0)
  window.hermesDesktop.platformAccount.status = async () => platformSnapshot('user-b', 2)
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  recordGatewayReadyCapability(route, { type: 'gateway.ready', payload: { managed_model_binding: 1 } } as never)

  expect(await pending).toMatchObject({ error: { code: 'platform_account_changed' } })
  expect(io.agent).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
  expect(io.release).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1000)
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects an old account revision while waiting for the bot socket', async () => {
  const retained = deferred<() => void>()
  io.retain.mockImplementation(async (connectionId, profile) => {
    recordGatewayReadyCapability({ connectionId, profile }, {
      type: 'gateway.ready',
      payload: { managed_model_binding: 1 }
    } as never)

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

  await expect(host.requestProfile(route, 'session.create', { follow_profile_config: true })).rejects.toMatchObject({
    code: 'platform_account_changed'
  })
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
  expect(io.bind).toHaveBeenCalledWith(
    expect.objectContaining({ connection_id: 'alias-source', profile: 'desktop-alias' })
  )
  expect(io.active.mock.calls.find(call => call[0] === 'session.create')?.[1]).toMatchObject({
    profile: 'backend-target'
  })
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

  await expect(
    host.request('session.create', { profile: 'unresolved-bot', follow_profile_config: true })
  ).rejects.toMatchObject({ code: 'unsupported_gateway' })
  expect(io.agent).not.toHaveBeenCalled()
  expect(io.active).not.toHaveBeenCalled()
  expect(io.bind).not.toHaveBeenCalled()
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { RosterRow } from '@/plugins/hermes-bots/types'
import { deferred } from '@/test/deferred'

const wire = vi.hoisted(() => ({
  sockets: [] as Array<{ closed: boolean; bound: boolean; close: () => void }>,
  created: false,
  intros: 0,
  failLookup: false,
  createGate: null as Promise<void> | null,
  createdSignal: () => {},
  open: vi.fn(async () => {}),
  retainAvailable: true
}))

// The real registry owns refcounts/disposal. Only the network transport is
// replaced: a managed binding belongs to the viewer socket and dies with it,
// as exercised against the native owner in test_canonical_managed_model_binding.
vi.mock('@/hermes', () => ({
  setApiRequestConnection: vi.fn(),
  HermesGateway: class {
    connectionState = 'closed'
    closed = false
    bound = false
    constructor() {
      wire.sockets.push(this)
    }
    async connect() {
      this.connectionState = 'open'
    }
    close() {
      this.closed = true
      this.bound = false
      this.connectionState = 'closed'
    }
    onEvent() {
      return () => {}
    }
    onState() {
      return () => {}
    }
    async request(method: string) {
      if (method === 'session.list') {
        if (wire.failLookup) {
          throw new Error('registry unavailable')
        }

        return { sessions: [] }
      }

      if (method === 'session.create') {
        this.bound = true
        wire.created = true
        wire.createdSignal()
        await wire.createGate

        return { session_id: 'runtime', stored_session_id: 'stored' }
      }

      if (method === 'session.title') {
        return {}
      }

      if (method === 'prompt.submit') {
        if (!this.bound) {
          throw new Error('awaiting_managed_credentials')
        }

        wire.intros++

        return { status: 'completed' }
      }

      throw new Error(`Unexpected ${method}`)
    }
  }
}))
vi.mock('@/store/session', () => ({ setConnection: vi.fn(), setGatewayState: vi.fn() }))
vi.mock('@/store/notify-baseline', () => ({ markNativeNotifyBaseline: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async () => {
  const gateway = await import('@/store/gateway')

  return {
    BOT_CHAT_SESSION_HYDRATION_TIMEOUT_MS: 15_000,
    host: {
      openSession: wire.open,
      get retainProfile() {
        return wire.retainAvailable
          ? (route: { connectionId: string; profile: string }, options: { spawnPriority: 'foreground' }) =>
              gateway.retainGatewayForAgent(route.connectionId, route.profile, options)
          : undefined
      }
    }
  }
})
vi.mock('@/plugins/hermes-bots/data', () => ({
  $botMeta: { get: () => ({}) },
  botMetaKey: () => 'bot',
  botOwner: (bot: RosterRow) => ({ bot, key: 'local::bot', name: 'bot', route: bot.route }),
  persistBotMetaSnapshot: vi.fn()
}))
vi.mock('@/plugins/hermes-bots/routing', async () => {
  const gateway = await import('@/store/gateway')

  return {
    botConnectionRoute: (bot: RosterRow) => bot.route,
    backendTargetProfile: () => 'bot',
    botRosterMeta: () => ({}),
    botWorkspaceOwnerKey: () => 'bot:local::bot',
    requestForBot: (_bot: RosterRow, method: string, params: Record<string, unknown>) =>
      gateway.requestGatewayForAgent('local', 'bot', method, params)
  }
})
vi.mock('@/plugins/hermes-bots/shared', () => ({ pluginText: (_key: string, fallback: string) => fallback }))
vi.mock('@/plugins/hermes-bots/i18n', () => ({ botsText: () => ({}) }))

const gateway = await import('@/store/gateway')
const { createCanonicalChat } = await import('@/plugins/hermes-bots/canonical-chat')

const bot: RosterRow = {
  name: 'bot',
  sourceScoped: true,
  connectionId: 'local',
  route: { connectionId: 'local', profile: 'bot', targetProfile: 'bot', mode: 'local' }
}

beforeEach(() => {
  wire.sockets.length = 0
  wire.created = false
  wire.intros = 0
  wire.failLookup = false
  wire.createGate = null

  wire.createdSignal = () => {}
  wire.retainAvailable = true
  wire.open.mockReset().mockResolvedValue(undefined)
  gateway.configureGatewayRegistry({ onEvent: vi.fn() })
  gateway.setPrimaryGateway({ connectionState: 'open' } as never, 'default')
  window.hermesDesktop = {
    getConnectionFor: async ({ connectionId, profile }: { connectionId: string; profile: string }) => ({
      connectionId,
      profile,
      wsUrl: 'ws://127.0.0.1:1/api/ws',
      token: 'fixture'
    }),
    getGatewayWsUrlFor: async () => 'ws://127.0.0.1:1/api/ws'
  } as never
})

afterEach(() => {
  gateway.closeSecondaryGateways()
  gateway.setPrimaryGateway(null)
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it('keeps the managed binding through title, foreground mounting and the intro', async () => {
  const opening = deferred<void>()
  const mounted = deferred<void>()
  wire.open.mockImplementation(async () => {
    opening.resolve()
    await mounted.promise
  })
  const result = createCanonicalChat(bot, { kickoff: true })
  await opening.promise
  const openCount = wire.sockets.filter(socket => !socket.closed).length
  const boundDuringMount = wire.sockets.some(socket => socket.bound)
  mounted.resolve()
  await expect(result).resolves.toBe('stored')
  expect(openCount).toBe(1)
  expect(boundDuringMount).toBe(true)
  expect(wire.intros).toBe(1)
  expect(wire.sockets).toHaveLength(1)
  expect(wire.sockets.every(socket => socket.closed)).toBe(true)
})

it('releases a failed creation lease so retry can dial again', async () => {
  wire.failLookup = true
  await expect(createCanonicalChat(bot)).rejects.toThrow('registry unavailable')
  expect(wire.sockets).toHaveLength(1)
  expect(wire.sockets.every(socket => socket.closed)).toBe(true)
  wire.failLookup = false
  await expect(createCanonicalChat(bot, { kickoff: true })).resolves.toBe('stored')
  expect(wire.intros).toBe(1)
  expect(wire.sockets).toHaveLength(2)
  expect(wire.sockets.every(socket => socket.closed)).toBe(true)
})

it('shares one retained creation between concurrent callers', async () => {
  const created = deferred<void>()
  const finish = deferred<void>()
  wire.createGate = finish.promise
  wire.createdSignal = () => created.resolve()
  const first = createCanonicalChat(bot, { kickoff: true })
  await created.promise
  const second = createCanonicalChat(bot, { kickoff: true })
  finish.resolve()
  await expect(Promise.all([first, second])).resolves.toEqual(['stored', 'stored'])
  expect(wire.intros).toBe(1)
  expect(wire.open).toHaveBeenCalledTimes(1)
  expect(wire.sockets).toHaveLength(1)
  expect(wire.sockets.every(socket => socket.closed)).toBe(true)
})

it('retains the binding until a newer same-bot opener finishes mounting', async () => {
  const created = deferred<void>()
  const finish = deferred<void>()
  wire.createGate = finish.promise
  wire.createdSignal = () => created.resolve()
  let firstCurrent = true
  let boundDuringMount = false
  wire.open.mockImplementation(async () => {
    boundDuringMount = wire.sockets.some(socket => socket.bound && !socket.closed)
  })
  const first = createCanonicalChat(bot, { kickoff: true, openingStillCurrent: () => firstCurrent })
  await created.promise
  firstCurrent = false
  const second = createCanonicalChat(bot, { openingStillCurrent: () => true })
  finish.resolve()
  await expect(Promise.all([first, second])).resolves.toEqual(['stored', 'stored'])
  expect(boundDuringMount).toBe(true)
  expect(wire.intros).toBe(1)
  expect(wire.open).toHaveBeenCalledTimes(1)
  expect(wire.sockets).toHaveLength(1)
  expect(wire.sockets.every(socket => socket.closed)).toBe(true)
})

it('supports older SDKs whose profile connection already stays open', async () => {
  wire.retainAvailable = false
  await gateway.openGatewayForAgent('local', 'bot')
  await expect(createCanonicalChat(bot, { kickoff: true })).resolves.toBe('stored')
  expect(wire.intros).toBe(1)
})

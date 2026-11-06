import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const gatewayMocks = vi.hoisted(() => {
  const instances: Array<{
    close: ReturnType<typeof vi.fn>
    emitEvent: (event: { payload?: unknown; type: string }) => void
    emitCapturedEvent: (event: { payload?: unknown; type: string }) => void
    emitState: (state: string) => void
  }> = []

  return { instances }
})

vi.mock('@/hermes', () => ({
  setApiRequestConnection: vi.fn(),
  HermesGateway: class {
    connectionState = 'closed'
    private eventHandler: (event: { payload?: unknown; type: string }) => void = () => undefined
    private stateHandler: (state: string) => void = () => undefined
    close = vi.fn(() => {
      this.connectionState = 'closed'
      this.stateHandler('closed')
    })
    connect = vi.fn(async () => {
      this.connectionState = 'open'
      this.stateHandler('open')
    })
    onEvent = vi.fn((handler: typeof this.eventHandler) => {
      this.eventHandler = handler

      return () => undefined
    })
    onState = vi.fn((handler: typeof this.stateHandler) => {
      this.stateHandler = handler

      return () => undefined
    })
    constructor() {
      const emitCapturedEvent = (event: { payload?: unknown; type: string }) => this.eventHandler(event)

      gatewayMocks.instances.push({
        close: this.close,
        emitEvent: event => this.eventHandler(event),
        emitCapturedEvent,
        emitState: state => {
          this.connectionState = state
          this.stateHandler(state)
        }
      })
    }
  }
}))
vi.mock('@/store/session', () => ({ setConnection: vi.fn(), setGatewayState: vi.fn() }))
vi.mock('@/store/notify-baseline', () => ({ markNativeNotifyBaseline: vi.fn() }))
vi.mock('@/store/session-states', () => ({
  reconcileBusyStatesOnReconnect: vi.fn(),
  resetTileRuntimeBindings: vi.fn()
}))

const {
  closeSecondaryGateways,
  configureGatewayRegistry,
  disposeSecondariesForConnection,
  ensureGatewayForAgent,
  requestGatewayForAgent,
  reportPrimaryGatewayEvent,
  reportPrimaryGatewayState,
  setPrimaryGateway,
  setPrimaryGatewayConnectionId
} = await import('./gateway')

const { clearGatewayManagedCapabilities, managedImageRouteCapability, managedModelRouteCapability } =
  await import('./gateway-managed-capability')

const { sharedRegistryPrimaryRoute } = await import('./gateway-shared-route')

function descriptor(connectionId: string, profile: string) {
  return {
    authMode: 'token',
    baseUrl: `https://${connectionId}.invalid`,
    connectionId,
    mode: 'remote',
    profile,
    token: 'test-token',
    wsUrl: `wss://${connectionId}.invalid/api/ws?profile=${profile}`
  }
}

beforeEach(() => {
  clearGatewayManagedCapabilities()
  configureGatewayRegistry({ onEvent: vi.fn() } as never)
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      getConnectionFor: vi.fn(async ({ connectionId, profile }) => descriptor(connectionId, profile))
    }
  })
})

afterEach(() => {
  closeSecondaryGateways()
  setPrimaryGateway(null)
  gatewayMocks.instances.length = 0
  Reflect.deleteProperty(window, 'hermesDesktop')
})

it.each(['before', 'after'])('shares ready evidence with a proven primary rider resolved %s ready', async timing => {
  const request = vi.fn(async () => ({ ok: true }))
  const gateway = { connectionState: 'open', request } as never
  setPrimaryGateway(gateway, 'default')
  setPrimaryGatewayConnectionId('local', 'local')
  window.hermesDesktop!.getConnectionFor = vi.fn(
    async ({ connectionId, profile }) =>
      ({
        ...descriptor(connectionId!, profile!),
        sharedPrimary: true
      }) as never
  )
  const ready = { type: 'gateway.ready', payload: { managed_model_binding: 1, managed_image_binding: 1 } }

  if (timing === 'after') {
    reportPrimaryGatewayEvent(gateway, ready as never)
  }

  await requestGatewayForAgent('local', 'writer', 'session.list')

  if (timing === 'before') {
    reportPrimaryGatewayEvent(gateway, ready as never)
  }

  expect(request).toHaveBeenCalledWith('session.list', { profile: 'writer' })
  expect(managedModelRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('supported')
  expect(managedImageRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('supported')
  expect(managedModelRouteCapability({ connectionId: 'other-source', profile: 'writer' })).toBe('unknown')

  reportPrimaryGatewayState(gateway, 'connecting')
  expect(managedModelRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('unknown')
  reportPrimaryGatewayEvent(gateway, { type: 'gateway.ready', payload: {} })
  expect(managedModelRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('unsupported')

  const replacement = { connectionState: 'open' } as never
  setPrimaryGateway(replacement, 'default')
  setPrimaryGatewayConnectionId('local', 'local')
  reportPrimaryGatewayEvent(replacement, ready as never)
  expect(managedModelRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('unknown')
})

it('publishes capability when activating a shared bot without a preceding RPC', async () => {
  const gateway = { connectionState: 'open' } as never
  setPrimaryGateway(gateway, 'default')
  setPrimaryGatewayConnectionId('local', 'local')
  window.hermesDesktop!.getConnectionFor = vi.fn(async () => ({ sharedPrimary: true }) as never)
  reportPrimaryGatewayEvent(gateway, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })

  expect(await ensureGatewayForAgent('local', 'writer')).toBe(true)
  expect(managedModelRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('supported')
  expect(gatewayMocks.instances).toHaveLength(0)
})

it('does not transfer replacement ready evidence to a route resolved against the former primary', async () => {
  const old = { connectionState: 'open', request: vi.fn(async () => ({})) } as never
  setPrimaryGateway(old, 'default')
  setPrimaryGatewayConnectionId('local', 'local')
  let resolveRoute!: (value: never) => void
  window.hermesDesktop!.getConnectionFor = vi.fn(
    () =>
      new Promise<never>(resolve => {
        resolveRoute = resolve
      })
  )
  const resolving = requestGatewayForAgent('local', 'writer', 'session.list')
  const replacement = { connectionState: 'open', request: vi.fn(async () => ({})) } as never
  setPrimaryGateway(replacement, 'default')
  setPrimaryGatewayConnectionId('local', 'local')
  reportPrimaryGatewayEvent(replacement, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  resolveRoute({ sharedPrimary: true } as never)
  await expect(resolving).rejects.toThrow(/changed/i)

  expect(managedModelRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('unknown')
})

it.each([true, false])(
  'ignores a stale %s route result after the replacement has established the same bot route',
  async shared => {
    const old = { connectionState: 'open', request: vi.fn(async () => ({})) } as never
    setPrimaryGateway(old, 'default')
    setPrimaryGatewayConnectionId('local', 'local')
    let finishOldProbe!: (value: never) => void

    const probe = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<never>(resolve => {
            finishOldProbe = resolve
          })
      )
      .mockResolvedValue({ sharedPrimary: true })

    window.hermesDesktop!.getConnectionFor = probe

    const oldRequest = sharedRegistryPrimaryRoute(
      { connectionId: 'local', gateway: old, profile: 'default' },
      'local',
      'local',
      'writer'
    )

    const replacement = { connectionState: 'open', request: vi.fn(async () => ({})) } as never
    setPrimaryGateway(replacement, 'default')
    setPrimaryGatewayConnectionId('local', 'local')
    const ready = { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    reportPrimaryGatewayEvent(replacement, ready as never)
    await requestGatewayForAgent('local', 'writer', 'session.list')
    expect(managedModelRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('supported')

    finishOldProbe({ sharedPrimary: shared } as never)
    await expect(oldRequest).rejects.toThrow(/changed/i)
    expect(managedModelRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('supported')
    reportPrimaryGatewayEvent(replacement, ready as never)
    expect(managedModelRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('supported')
  }
)

it.each(['remote', null] as const)(
  'keeps unproven %s fallback routing without inferring managed-model support',
  async mode => {
    const request = vi.fn(async () => ({}))
    const gateway = { connectionState: 'open', request } as never
    setPrimaryGateway(gateway, 'default')
    setPrimaryGatewayConnectionId('source', mode)
    reportPrimaryGatewayEvent(gateway, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
    window.hermesDesktop!.getConnectionFor = vi.fn(async () => {
      throw new Error('route lookup unavailable')
    })

    await requestGatewayForAgent('source', 'unproven', 'session.list')
    expect(request).toHaveBeenCalledWith('session.list', { profile: 'unproven' })
    expect(managedModelRouteCapability({ connectionId: 'source', profile: 'unproven' })).toBe('unknown')
    reportPrimaryGatewayEvent(gateway, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
    expect(managedModelRouteCapability({ connectionId: 'source', profile: 'unproven' })).toBe('unknown')
  }
)

it('retains current socket ready evidence when adopting its authoritative profile after connect', async () => {
  const gateway = { connectionState: 'open' } as never
  setPrimaryGateway(gateway, 'default')
  setPrimaryGatewayConnectionId('local', 'local')
  reportPrimaryGatewayEvent(gateway, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  window.hermesDesktop!.getConnectionFor = vi.fn(async () => ({ sharedPrimary: true }) as never)
  await ensureGatewayForAgent('local', 'assistant')
  setPrimaryGateway(gateway, 'writer')

  expect(managedModelRouteCapability({ connectionId: 'local', profile: 'writer' })).toBe('supported')
  expect(managedModelRouteCapability({ connectionId: 'local', profile: 'assistant' })).toBe('supported')
})

it('refuses a stale shared route instead of delivering the former source session.create to the replacement source', async () => {
  const old = { connectionState: 'open', request: vi.fn(async () => ({})) } as never
  setPrimaryGateway(old, 'default')
  setPrimaryGatewayConnectionId('source-a', 'remote')
  let finishOldProbe!: (value: never) => void
  window.hermesDesktop!.getConnectionFor = vi.fn(
    () =>
      new Promise<never>(resolve => {
        finishOldProbe = resolve
      })
  )
  const oldRequest = requestGatewayForAgent('source-a', 'writer', 'session.create', { title: 'Bot Chat' })
  const replacementRequest = vi.fn(async () => ({}))
  const replacement = { connectionState: 'open', request: replacementRequest } as never
  setPrimaryGateway(replacement, 'default')
  setPrimaryGatewayConnectionId('source-b', 'remote')
  finishOldProbe({ sharedRemote: true } as never)

  await expect(oldRequest).rejects.toThrow(/changed/i)
  expect(replacementRequest).not.toHaveBeenCalled()
})

it('keeps ready evidence on the exact connection/profile route and treats an older peer as unsupported', async () => {
  await ensureGatewayForAgent('source-a', 'default')
  await ensureGatewayForAgent('source-b', 'default')

  gatewayMocks.instances[0].emitEvent({
    type: 'gateway.ready',
    payload: { capabilities: { unrelated: 1 }, managed_model_binding: 1 }
  })
  gatewayMocks.instances[1].emitEvent({ type: 'gateway.ready', payload: { capabilities: {} } })

  expect(managedModelRouteCapability({ connectionId: 'source-a', profile: 'default' })).toBe('supported')
  expect(managedModelRouteCapability({ connectionId: 'source-b', profile: 'default' })).toBe('unsupported')
})

it('records and resets the primary socket against its published owner instead of the active view', () => {
  const gateway = { connectionState: 'open' } as never
  setPrimaryGateway(gateway, 'shared')
  setPrimaryGatewayConnectionId('primary-source')
  reportPrimaryGatewayEvent(gateway, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })

  expect(managedModelRouteCapability({ connectionId: 'primary-source', profile: 'shared' })).toBe('supported')
  reportPrimaryGatewayState(gateway, 'error')
  expect(managedModelRouteCapability({ connectionId: 'primary-source', profile: 'shared' })).toBe('unknown')
})

it('rejects late ready writes from a replaced primary gateway instance', () => {
  const oldGateway = { connectionState: 'open' } as never
  const replacement = { connectionState: 'open' } as never
  setPrimaryGateway(oldGateway, 'shared')
  setPrimaryGatewayConnectionId('primary-source')
  setPrimaryGateway(replacement, 'shared')
  setPrimaryGatewayConnectionId('primary-source')

  reportPrimaryGatewayEvent(oldGateway, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  expect(managedModelRouteCapability({ connectionId: 'primary-source', profile: 'shared' })).toBe('unknown')

  reportPrimaryGatewayEvent(replacement, { type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  expect(managedModelRouteCapability({ connectionId: 'primary-source', profile: 'shared' })).toBe('supported')
})

it('invalidates ready evidence on reconnect and when the connection target is replaced', async () => {
  await ensureGatewayForAgent('source-a', 'default')
  gatewayMocks.instances[0].emitEvent({ type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  expect(managedModelRouteCapability({ connectionId: 'source-a', profile: 'default' })).toBe('supported')

  gatewayMocks.instances[0].emitState('connecting')
  expect(managedModelRouteCapability({ connectionId: 'source-a', profile: 'default' })).toBe('unknown')

  gatewayMocks.instances[0].emitEvent({ type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  disposeSecondariesForConnection('source-a', { redial: true })

  expect(managedModelRouteCapability({ connectionId: 'source-a', profile: 'default' })).toBe('unknown')
})

it('rejects a late ready callback from a replaced secondary entry', async () => {
  await ensureGatewayForAgent('source-a', 'default')
  const old = gatewayMocks.instances[0]
  disposeSecondariesForConnection('source-a', { redial: true })
  await vi.waitFor(() => expect(gatewayMocks.instances).toHaveLength(2))

  old.emitCapturedEvent({ type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  expect(managedModelRouteCapability({ connectionId: 'source-a', profile: 'default' })).toBe('unknown')

  gatewayMocks.instances[1].emitEvent({ type: 'gateway.ready', payload: { managed_model_binding: 1 } })
  expect(managedModelRouteCapability({ connectionId: 'source-a', profile: 'default' })).toBe('supported')
})

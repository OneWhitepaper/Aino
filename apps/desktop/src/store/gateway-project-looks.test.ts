import { atom } from 'nanostores'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/store/gateway', () => ({
  $gateway: atom(null),
  gatewayRouteState: vi.fn(() => ({ gateway: null, key: '', open: false })),
  requestGatewayForAgent: vi.fn()
}))

const gw = await import('@/store/gateway')
const request = vi.mocked(gw.requestGatewayForAgent)
const routeState = vi.mocked(gw.gatewayRouteState)
const looks = await import('./gateway-project-looks')

const STUDIO = { connectionId: 'studio', profile: 'research' }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => (resolve = res))

  return { promise, resolve }
}

const project = (id: string, path: string, color: null | string) => ({
  archived: false,
  color,
  folders: [{ path }],
  icon: null,
  id,
  name: path.split('/').pop(),
  primary_path: path
})

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** A socket already open to an owner, as gatewayRouteState hands it to passive reads. */
function openSocket(list: () => Promise<unknown>) {
  const handlers = new Set<(state: string) => void>()

  const socket = {
    connectionState: 'open',
    onState(handler: (state: string) => void) {
      handlers.add(handler)
      handler(socket.connectionState)

      return () => handlers.delete(handler)
    },
    request: vi.fn(list),
    become(state: string) {
      socket.connectionState = state
      handlers.forEach(handler => handler(state))
    }
  }

  routeState.mockReturnValue({
    gateway: socket as never,
    socket: socket as never,
    key: 'studio',
    open: true,
    primary: false,
    state: 'open'
  })

  return socket
}

const listing = (...projects: unknown[]) => ({ active_id: null, projects })

beforeEach(() => {
  vi.clearAllMocks()
  looks.$gatewayProjectLooks.set({})
})

describe('gateway project looks', () => {
  it('reads saved colour and icon from the owner without creating or updating a project', async () => {
    const socket = openSocket(async () => listing({ ...project('p_app', '/code/app', '#aaa'), icon: 'rocket' }))

    looks.loadGatewayProjectLooks([STUDIO])
    await settle()

    expect(looks.gatewayProjectLook(STUDIO, '/code/app/')).toEqual({ color: '#aaa', icon: 'rocket', id: 'p_app' })
    expect(socket.request.mock.calls).toEqual([['projects.list', { profile: 'research' }]])
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps identical folder paths isolated by gateway and profile', async () => {
    for (const [route, color] of [
      [STUDIO, '#aaa'],
      [{ connectionId: 'studio', profile: 'default' }, '#bbb'],
      [{ connectionId: 'local', profile: 'research' }, '#ccc']
    ] as const) {
      openSocket(async () => listing(project('p_app', '/code/app', color)))
      looks.loadGatewayProjectLooks([route])
      await settle()
    }

    expect(looks.gatewayProjectLook(STUDIO, '/code/app')?.color).toBe('#aaa')
    expect(looks.gatewayProjectLook({ connectionId: 'studio', profile: 'default' }, '/code/app')?.color).toBe('#bbb')
    expect(looks.gatewayProjectLook({ connectionId: 'local', profile: 'research' }, '/code/app')?.color).toBe('#ccc')
    expect(request).not.toHaveBeenCalled()
  })

  it('reads an owner again on a later render after a failed read, a bounded number of times', async () => {
    const socket = openSocket(async () => {
      throw new Error('offline')
    })

    for (let render = 0; render < 6; render += 1) {
      looks.loadGatewayProjectLooks([STUDIO])
      await settle()
    }

    expect(socket.request).toHaveBeenCalledTimes(3)
    expect(request).not.toHaveBeenCalled()

    socket.request.mockResolvedValue(listing(project('p_app', '/code/app', '#f43f5e')))
    socket.become('closed')
    socket.become('open')
    await settle()

    expect(looks.gatewayProjectLook(STUDIO, '/code/app')?.color).toBe('#f43f5e')
  })

  it("re-reads an owner's looks when its socket reconnects", async () => {
    const socket = openSocket(async () => listing(project('p_app', '/code/app', '#aaa')))

    looks.loadGatewayProjectLooks([STUDIO])
    await settle()
    expect(looks.gatewayProjectLook(STUDIO, '/code/app')?.color).toBe('#aaa')

    // The owner's own window recolours while this one is disconnected.
    socket.request.mockResolvedValue(listing(project('p_app', '/code/app', '#bbb')))
    socket.become('closed')
    socket.become('open')
    await settle()

    expect(looks.gatewayProjectLook(STUDIO, '/code/app')?.color).toBe('#bbb')
    expect(socket.request).toHaveBeenCalledTimes(2)
  })

  it('reads again when the socket reconnects while an earlier read is still in flight', async () => {
    const before = deferred<unknown>()
    const socket = openSocket(() => before.promise)

    looks.loadGatewayProjectLooks([STUDIO])
    socket.request.mockResolvedValue(listing(project('p_app', '/code/app', '#bbb')))
    socket.become('closed')
    socket.become('open')
    before.resolve(listing(project('p_app', '/code/app', '#aaa')))
    await settle()

    expect(socket.request).toHaveBeenCalledTimes(2)
    expect(looks.gatewayProjectLook(STUDIO, '/code/app')?.color).toBe('#bbb')
  })
})

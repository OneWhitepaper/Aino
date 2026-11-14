import { afterEach, expect, it, vi } from 'vitest'

import { getHermesConfigRecord } from '@/api/config'
import { clearPlatformSession } from '@/api/platform-session-binding'
import { deleteSession } from '@/api/sessions'
import { platformModelCatalog } from '@/store/platform-models'
import { platformSnapshot } from '@/test/platform-model'

import { GatewayClient } from '../../../shared/src/node/gateway-client'

import { requestPluginImageGeneration } from './plugin-image-generation'

vi.mock('@/api/config', () => ({ getHermesConfigRecord: vi.fn() }))
vi.mock('@/api/platform-image-session-binding', () => ({ preparePlatformImageSession: vi.fn(async () => {}) }))
vi.mock('@/api/platform-session-binding', () => ({ clearPlatformSession: vi.fn(async () => {}) }))
vi.mock('@/api/sessions', () => ({ deleteSession: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/store/gateway', () => ({ retainGatewayForAgent: vi.fn(async () => vi.fn()) }))

interface Frame { id: number; method: string; params: Record<string, unknown> }

class OwnerSocket {
  static instances: OwnerSocket[] = []
  readyState = 0
  sent: Frame[] = []
  private listeners = new Map<string, ((event: unknown) => void)[]>()

  constructor() { OwnerSocket.instances.push(this) }

  addEventListener(type: string, callback: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
  }

  emit(type: string, event: unknown) {
    for (const callback of this.listeners.get(type) ?? []) { callback(event) }
  }

  open() { this.readyState = 1; this.emit('open', {}) }
  close() { this.readyState = 3; this.emit('close', { code: 1000 }) }

  send(text: string) {
    const frame = JSON.parse(text) as Frame
    this.sent.push(frame)

    const result = frame.method === 'runtime.describe'
      ? { session_create: { sources: ['gui'], parameters: ['source', 'request_id', 'profile', 'hidden', 'follow_profile_config'] } }
      : frame.method === 'session.create'
        ? { session_id: 'avatar-helper', stored_session_id: 'avatar-helper', messages: [], authority_epoch: 1 }
        : { available: true, success: true, image_data: 'data:image/png;base64,AA==' }

    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) }))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  OwnerSocket.instances = []
})

it('generates an avatar through the real GUI canonical create adapter using only advertised options', async () => {
  vi.stubGlobal('WebSocket', OwnerSocket)
  vi.mocked(getHermesConfigRecord).mockResolvedValue({ image_gen: { provider: 'aino', model: 'avatar' } })
  vi.spyOn(platformModelCatalog().account, 'get').mockReturnValue(platformSnapshot())

  const client = new GatewayClient({
    source: 'gui',
    connect: async () => ({ url: 'ws://127.0.0.1:9/api/ws', protocols: ['hermes-gateway-v1'], profile_id: '/fixture', instance_id: 'owner' })
  })

  try {
    const generated = requestPluginImageGeneration(
      { connectionId: 'local', profile: 'default', targetProfile: 'default' },
      (method, params, timeout) => client.request(method, params, timeout),
      { prompt: 'small robot' },
      90_000
    )

    const result = expect(generated).resolves.toMatchObject({ success: true, image_data: 'data:image/png;base64,AA==' })
    await vi.waitFor(() => expect(OwnerSocket.instances).toHaveLength(1))
    const socket = OwnerSocket.instances[0]!
    socket.open()
    await result
    const create = socket.sent.find(frame => frame.method === 'session.create')!
    expect(create.params).toMatchObject({ source: 'gui', hidden: true, follow_profile_config: true, profile: 'default', request_id: expect.any(String) })
    expect(socket.sent.find(frame => frame.method === 'image.generate')?.params).toMatchObject({ session_id: 'avatar-helper', profile: 'default', prompt: 'small robot' })
    expect(clearPlatformSession).toHaveBeenCalledWith(expect.anything(), 'avatar-helper', 'image')
    expect(deleteSession).toHaveBeenCalledWith('avatar-helper', { connectionId: 'local', profile: 'default' })
  } finally {
    client.kill()
  }
})

// @vitest-environment node
import { expect, test } from 'vitest'

import {
  type FixtureFrame,
  type FixtureSocket,
  listen,
  publicUrl,
  readyFrame,
  reply,
  shut
} from '../test/ws-gateway-fixture'

import { HermesGateway } from './client'

const ticketMethod = 'session.managed_model_ticket'

test('managed tickets attach on their owning socket and profile after reads and reconnects', async () => {
  const server = await listen()
  const frames: FixtureFrame[] = []
  server.on('connection', (socket: FixtureSocket) => {
    const subscriptions = new Set<string>()
    socket.on('message', bytes => {
      const frame: FixtureFrame = JSON.parse(bytes.toString())

      if (frame.method === 'client.capabilities') {
        reply(socket, frame)

        return
      }

      frames.push(frame)
      const profile = String(frame.params.profile)

      if (frame.method === 'session.resume') {
        subscriptions.add(profile)
        reply(socket, frame, {
          session_id: 'draft',
          stored_session_id: 'draft',
          revision: 2,
          execution_generation: 0,
          subscription_id: profile,
          messages: [],
          pending: [],
          prompts: [],
          info: { profile_name: profile, desktop_protocol: 'hermes-gateway-v1' }
        })
      } else if (frame.method === ticketMethod && !subscriptions.has(profile)) {
        socket.send(
          JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: 4001, message: 'permission_denied' } })
        )
      } else {
        reply(socket, frame, { session_ticket: 'fixture-ticket', managed_model_binding: 1 })
      }
    })
    socket.send(readyFrame())
  })
  const client = new HermesGateway()
  const url = publicUrl(server)

  const params = (profile: string) => ({
    session_id: 'draft',
    profile,
    model_id: 'fixture-model',
    owner: { user_id: 'fixture-user', platform_origin: 'https://fixture.invalid' }
  })

  try {
    await client.connect(url)
    await client.request('model.options', { session_id: 'draft', profile: 'alpha', include_session_info: true })
    frames.length = 0
    await expect(client.request(ticketMethod, params('alpha'))).resolves.toMatchObject({
      session_ticket: 'fixture-ticket'
    })
    expect(frames.map(f => f.method)).toEqual(['session.resume', ticketMethod])
    expect(frames[0].params).toEqual({
      session_id: 'draft',
      profile: 'alpha',
      defer_history: true,
      omit_messages: true
    })
    expect(frames[1].params).toEqual(params('alpha'))
    frames.length = 0
    await client.request(ticketMethod, params('alpha'))
    await client.request(ticketMethod, params('beta'))
    expect(frames.map(f => [f.method, f.params.profile])).toEqual([
      [ticketMethod, 'alpha'],
      ['session.resume', 'beta'],
      [ticketMethod, 'beta']
    ])
    client.close()
    await client.connect(url)
    frames.length = 0
    await client.request(ticketMethod, params('alpha'))
    expect(frames.map(f => f.method)).toEqual(['session.resume', ticketMethod])
  } finally {
    await shut(client, server)
  }
})

test.each(['canonical', 'legacy'])('managed ticket respects %s attachment authority', async wire => {
  const server = await listen()
  const frames: FixtureFrame[] = []
  server.on('connection', (socket: FixtureSocket) => {
    socket.on('message', bytes => {
      const frame: FixtureFrame = JSON.parse(bytes.toString())

      if (frame.method !== 'client.capabilities') {
        frames.push(frame)
      }

      if (frame.method === 'session.resume') {
        socket.send(
          JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: 4001, message: 'permission_denied' } })
        )
      } else {
        reply(socket, frame, { session_ticket: 'fixture-ticket' })
      }
    })
    socket.send(readyFrame({ session_authority: wire === 'canonical' }))
  })
  const client = new HermesGateway()

  try {
    await client.connect(publicUrl(server))
    const result = client.request(ticketMethod, { session_id: 'draft', profile: 'alpha' })

    if (wire === 'canonical') {
      await expect(result).rejects.toThrow('permission_denied')
      expect(frames.map(f => f.method)).toEqual(['session.resume'])
    } else {
      await expect(result).resolves.toEqual({ session_ticket: 'fixture-ticket' })
      expect(frames.map(f => f.method)).toEqual([ticketMethod])
    }
  } finally {
    await shut(client, server)
  }
})

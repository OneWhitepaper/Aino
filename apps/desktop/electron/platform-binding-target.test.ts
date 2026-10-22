import http from 'node:http'

import { expect, it } from 'vitest'
import { WebSocketServer } from 'ws'

import { type ManagedGatewayDescriptor, resolvePlatformBindingTarget } from './platform-binding-target'

it('rejects plaintext remote targets and stale routing while allowing existing local/SSH paths', async () => {
  const descriptor: ManagedGatewayDescriptor = {
    mode: 'remote',
    baseUrl: 'http://example.test',
    wsUrl: 'ws://example.test/api/ws'
  }

  const resolve = () =>
    resolvePlatformBindingTarget({
      profile: 'work',
      readConfiguration: () => 'config',
      readIdentity: () => 'fixture-user',
      resolve: async () => descriptor,
      mintTicket: async () => 'unused'
    })

  await expect(resolve()).rejects.toThrow('insecure_gateway')
  descriptor.baseUrl = 'http://127.0.0.1:1234'
  descriptor.wsUrl = 'ws://127.0.0.1:1234/api/ws'
  descriptor.remoteKind = 'ssh'
  descriptor.remoteHost = 'user@fixture-host'
  expect(await resolve()).toMatchObject({ remote: true, host: 'user@fixture-host', profile: 'default' })
  descriptor.mode = 'local'
  expect(await resolve()).toMatchObject({ remote: false })
  descriptor.mode = 'remote'
  descriptor.remoteKind = 'url'
  descriptor.baseUrl = 'https://example.test'
  descriptor.wsUrl = 'wss://example.test/api/ws'
  expect(await resolve()).toMatchObject({ remote: true, profile: 'work' })
})

it('mints a fresh OAuth ticket for every socket and carries resolver-owned upgrade headers', async () => {
  const server = http.createServer()
  const wss = new WebSocketServer({ server })
  const requests: Array<{ url?: string; header?: string | string[] }> = []
  wss.on('connection', (_socket, request) => requests.push({ url: request.url, header: request.headers['x-fixture'] }))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let ticket = 0
  let config = 'first'
  let identity = 'first-user'

  const target = await resolvePlatformBindingTarget({
    profile: 'work',
    readConfiguration: () => config,
    readIdentity: () => identity,
    resolve: async () => ({
      mode: 'remote',
      remoteKind: 'ssh',
      baseUrl: base,
      wsUrl: base.replace('http:', 'ws:') + '/api/ws?ticket=already-used',
      authMode: 'oauth',
      headers: { 'x-fixture': 'owned-header' }
    }),
    mintTicket: async () => `fresh-${++ticket}`
  })

  try {
    const first = await target.open()
    first.close()
    const second = await target.open()
    second.close()
    expect(requests).toEqual([
      { url: '/api/ws?ticket=fresh-1', header: 'owned-header' },
      { url: '/api/ws?ticket=fresh-2', header: 'owned-header' }
    ])
    config = 'changed'
    expect(target.isCurrent()).toBe(false)
    await expect(target.open()).rejects.toThrow('binding_cancelled')
    config = 'first'
    identity = 'other-user'
    expect(target.isCurrent()).toBe(false)
    await expect(target.open()).rejects.toThrow('binding_cancelled')
  } finally {
    for (const socket of wss.clients) {
      socket.terminate()
    }

    await new Promise<void>(r => wss.close(() => r()))
    await new Promise<void>(r => server.close(() => r()))
  }
})

it('opens native controller sockets with fresh private tickets for the selected workspace', async () => {
  const server = http.createServer()

  const wss = new WebSocketServer({ server, handleProtocols: protocols =>
    protocols.has('hermes-gateway-v1') ? 'hermes-gateway-v1' : false })

  const requests: Array<{ url?: string; protocols?: string }> = []
  wss.on('connection', (_socket, request) => requests.push({
    url: request.url, protocols: request.headers['sec-websocket-protocol']
  }))
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  let minted = 0
  const routed: string[] = []

  const target = await resolvePlatformBindingTarget({
    profile: 'fixture-workspace',
    readConfiguration: () => 'local',
    readIdentity: () => 'same-user',
    resolve: async () => ({
      mode: 'local', authMode: 'native', baseUrl: base,
      wsUrl: base.replace('http:', 'ws:') + '/api/ws?native_dial=unminted',
      gatewayEndpoint: { profile_id: '/fixture/home' } as never
    }),
    mintTicket: async () => 'unused',
    nativeDial: async profile => {
      routed.push(profile)

      return `${base.replace('http:', 'ws:')}/api/ws?native_dial=controller&ticket=fresh-${++minted}`
    }
  })

  try {
    expect(target.profile).toBe('fixture-workspace')
    const first = await target.open()
    first.close()
    const second = await target.open()
    second.close()
    expect(routed).toEqual(['fixture-workspace', 'fixture-workspace'])
    expect(requests).toEqual([
      { url: '/api/ws?native_dial=controller', protocols: 'hermes-gateway-v1,hermes-gateway-ticket.fresh-1' },
      { url: '/api/ws?native_dial=controller', protocols: 'hermes-gateway-v1,hermes-gateway-ticket.fresh-2' }
    ])
  } finally {
    for (const socket of wss.clients) {socket.terminate()}
    await new Promise<void>(r => wss.close(() => r()))
    await new Promise<void>(r => server.close(() => r()))
  }
})

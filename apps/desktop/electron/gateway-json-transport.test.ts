import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { expect, test } from 'vitest'

import { destroyKeepaliveAgents } from './api-transport'
import { createGatewayJsonTransport } from './gateway-json-transport'

async function withServer(handler: http.RequestListener, run: (origin: string) => Promise<void>) {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
  } finally {
    destroyKeepaliveAgents()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
}

test('private and public JSON requests use current scoped headers and keep credentials separate', async () => {
  let account = 'alpha'

  const transport = createGatewayJsonTransport({
    home: () => '/unused',
    headersForRemoteRequest: () => ({ 'X-Account': account })
  })

  await withServer(
    (request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          account: request.headers['x-account'],
          token: request.headers['x-hermes-session-token'] ?? null
        })
      )
    },
    async origin => {
      expect(await transport.fetchJson(origin, 'private-alpha')).toEqual({ account: 'alpha', token: 'private-alpha' })
      account = 'beta'
      expect(await transport.fetchPublicJson(origin)).toEqual({ account: 'beta', token: null })
    }
  )
})

test('an ambiguous POST failure is surfaced once while an interrupted GET can retry', async () => {
  const attempts: Record<string, number> = {}
  const transport = createGatewayJsonTransport({ home: () => '/unused', headersForRemoteRequest: () => ({}) })

  await withServer(
    (request, response) => {
      const method = request.method!
      attempts[method] = (attempts[method] ?? 0) + 1
      request.resume()
      request.on('end', () => {
        if (method === 'POST' || attempts[method] === 1) {
          request.socket.destroy()

          return
        }

        response.end('{"ok":true}')
      })
    },
    async origin => {
      await expect(transport.fetchJson(origin, 'token', { method: 'POST', body: { prompt: 'once' } })).rejects.toThrow()
      expect(attempts.POST).toBe(1)
      expect(await transport.fetchPublicJson(origin)).toEqual({ ok: true })
      expect(attempts.GET).toBe(2)
    }
  )
})

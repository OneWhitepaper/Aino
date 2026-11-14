import { expect, test, vi } from 'vitest'

import { forgetStalePooledGatewayDescriptor } from './backend-descriptor-cache'
import { resolveProfileBackendRoute } from './connection-config'
import { redialLocalGateway } from './local-gateway'

// B2-15: an unscopable mutating REST call keeps its pooled backend only while the routing decision
// sees the request; the stale-ticket redial (ensure + forget) must resolve that same route, or the
// retry lands on the shared primary home (wrong-profile write) and forget clears the primary.
test('the REST redial re-ensures and forgets the route the failed request used', async () => {
  const opts = { primaryProfile: 'default', globalRemote: false, profileRemoteOverride: false, isolatedBackend: false }
  const write = { ...opts, requestMethod: 'POST', requestPath: '/api/not-a-real-route/destroy' }
  expect(resolveProfileBackendRoute('work', write).backend).toBe('pool')
  expect(resolveProfileBackendRoute('work', opts).backend).toBe('primary')

  const stale = { gatewayEndpoint: {}, home: 'work', live: false }
  const fresh = { gatewayEndpoint: {}, home: 'work', live: true }
  const primary = { gatewayEndpoint: {}, home: 'default', live: true }
  const primaryPromise = Promise.resolve(primary)

  const pool = new Map([
    ['work', { connectionPromise: Promise.resolve(stale) }],
    ['default', { connectionPromise: primaryPromise }]
  ])

  const routes: string[] = []

  const ensure = vi.fn(async () => {
    const route = resolveProfileBackendRoute('work', write)
    routes.push(route.backend)

    if (route.backend === 'primary') {
      return primaryPromise
    }

    if (!pool.has('work')) {
      pool.set('work', { connectionPromise: Promise.resolve(fresh) })
    }

    return pool.get('work')!.connectionPromise
  })

  const forget = vi.fn(async (failed: typeof stale) => {
    await forgetStalePooledGatewayDescriptor(pool, 'work', failed)
  })

  const sent: string[] = []

  await expect(
    redialLocalGateway({
      ensure,
      forget,
      use: async connection => {
        if (!connection.live) {
          throw new Error('Gateway ticket control socket missing')
        }

        sent.push(connection.home)

        return connection
      }
    })
  ).resolves.toBe(fresh)
  expect(forget).toHaveBeenCalledExactlyOnceWith(stale)
  expect(routes).toEqual(['pool', 'pool'])
  expect(sent).toEqual(['work'])
  expect(pool.get('default')!.connectionPromise).toBe(primaryPromise)
  expect(await pool.get('work')!.connectionPromise).toBe(fresh)
})

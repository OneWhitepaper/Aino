import { expect, test } from 'vitest'

import { createBackendConnectionState } from './backend-connection-state'
import { forgetStalePooledGatewayDescriptor, forgetStalePrimaryGatewayDescriptor } from './backend-descriptor-cache'
import { redialLocalGateway } from './local-gateway'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => {
    resolve = next
  })

  return { promise, resolve }
}

test('late failures from the old primary join one replacement without evicting its pending or ready descriptor', async () => {
  const state = createBackendConnectionState<never, { gatewayEndpoint: object }>()
  const stale = { gatewayEndpoint: {} }
  const ready = { gatewayEndpoint: {} }
  const replacement = deferred<typeof ready>()
  const lateFailure = deferred<void>()
  const pendingFailure = deferred<void>()
  let starts = 0

  state.setPromise(state.startAttempt(), Promise.resolve(stale))

  const ensure = () => {
    if (!state.getPromise()) {
      starts += 1
      state.setPromise(state.startAttempt(), replacement.promise)
    }

    return state.getPromise()!
  }

  const dial = (failure?: Promise<void>) =>
    redialLocalGateway({
      ensure,
      forget: failed => forgetStalePrimaryGatewayDescriptor(state, failed).then(() => undefined),
      use: async connection => {
        if (connection.gatewayEndpoint === stale.gatewayEndpoint) {
          await failure
          throw new Error('Gateway ticket control socket missing')
        }

        return connection
      }
    })

  const late = dial(lateFailure.promise)
  const pending = dial(pendingFailure.promise)
  const first = dial()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(starts).toBe(1)
  pendingFailure.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  replacement.resolve(ready)
  await expect(first).resolves.toBe(ready)
  await expect(pending).resolves.toBe(ready)
  lateFailure.resolve()
  await expect(late).resolves.toBe(ready)
  expect(await state.getPromise()).toBe(ready)
  expect(starts).toBe(1)
})

test('a stale pooled request cannot erase another profile or a replacement on the same route', async () => {
  const stale = { gatewayEndpoint: {} }
  const ready = { gatewayEndpoint: {} }

  const pool = new Map([
    ['bot', { connectionPromise: Promise.resolve(stale) }],
    ['other', { connectionPromise: Promise.resolve(ready) }]
  ])

  const original = pool.get('bot')!
  expect(await forgetStalePooledGatewayDescriptor(pool, 'other', stale)).toBe(false)
  const retiring = forgetStalePooledGatewayDescriptor(pool, 'bot', stale)
  pool.set('bot', { connectionPromise: Promise.resolve(ready) })
  expect(await retiring).toBe(false)
  expect(await pool.get('bot')!.connectionPromise).toBe(ready)
  pool.set('bot', original)
  const routed = { ...stale, profile: 'bot' }
  expect(await forgetStalePooledGatewayDescriptor(pool, 'bot', routed)).toBe(true)
  expect(pool.has('bot')).toBe(false)
  expect(pool.has('other')).toBe(true)
})

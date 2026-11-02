import { expect, it, vi } from 'vitest'

import { createBackendConnectionState } from './backend-connection-state'
import { BackendDialClaims } from './backend-dial-claim'
import { createAttachedLocalGatewayRestarter, createProfileBackendRecycler } from './backend-recycle'
import { createLocalBackendLifecycle } from './local-backend-lifecycle'
import type { GatewayEndpoint } from './local-gateway'

function deferred<T>() {
  let resolve!: (value: T) => void

  const promise = new Promise<T>(done => {
    resolve = done
  })

  return { promise, resolve }
}

it('a ready remote profile can recycle while the unrelated local primary is still starting', async () => {
  vi.useFakeTimers()

  try {
    const primary = new Promise<{}>(() => {})

    const remote = {
      gatewayEndpoint: undefined,
      baseUrl: 'https://remote.example',
      mode: 'remote',
      authMode: 'token',
      source: 'remote',
      token: '',
      wsUrl: 'wss://remote.example/api/ws'
    }

    const restart = createAttachedLocalGatewayRestarter({
      pool: new Map([['remote-worker', { connectionPromise: Promise.resolve(remote) }]]),
      primaryConnection: () => primary,
      primaryProfile: () => 'default',
      restartOwner: async () => {
        throw new Error('A remote profile must not restart a local owner')
      }
    })

    const outcome = Promise.race([
      restart('remote-worker'),
      new Promise<string>(resolve => setTimeout(() => resolve('blocked by unrelated primary'), 1))
    ])

    await vi.runAllTimersAsync()
    expect(await outcome).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

it.each(['default', 'worker', 'isolated-worker'])(
  'a %s control-socket redial during owner restart reaches the replacement on its first claim',
  async profile => {
    const lifecycle = createLocalBackendLifecycle({
      cancelSetup: () => {},
      stopChild: () => {},
      waitForExit: async () => {}
    })

    const oldEndpoint: GatewayEndpoint = {
      api_origin: 'http://127.0.0.1:53150',
      authority_epoch: 1,
      capabilities: [],
      instance_id: 'old-owner',
      profile_id: '/test/home',
      runtime_protocol: 1,
      supervisor: 'service'
    }

    const oldConnection = { gatewayEndpoint: oldEndpoint }
    const unrelatedEndpoint = { ...oldEndpoint, instance_id: 'other-owner' }
    const replacementConnection = { gatewayEndpoint: { ...oldEndpoint, instance_id: 'replacement-owner' } }
    const state = createBackendConnectionState<never, typeof oldConnection>()
    const claims = new BackendDialClaims()
    const restartEntered = deferred<void>()
    const restartReleased = deferred<void>()
    const ensureReleased = deferred<typeof oldConnection>()

    const pool = new Map([
      [profile, { connectionPromise: Promise.resolve(oldConnection), gatewayEndpoint: oldEndpoint }],
      [
        'unrelated',
        {
          connectionPromise: Promise.resolve({ gatewayEndpoint: unrelatedEndpoint }),
          gatewayEndpoint: unrelatedEndpoint
        }
      ]
    ])

    const seed = state.startAttempt()
    state.setPromise(seed, Promise.resolve(oldConnection))
    await state.getPromise()

    const ensure = () =>
      lifecycle.start(async () => {
        const existing = state.getPromise()

        if (existing) {
          return existing
        }

        const attempt = state.startAttempt()

        const pending = ensureReleased.promise.then(connection => {
          state.assertCurrentAttempt(attempt)

          return connection
        })

        state.setPromise(attempt, pending)

        return pending
      }, 'local-gateway')

    let applied!: Promise<typeof oldConnection>

    const recycleProfile = createProfileBackendRecycler({
      duringLocalRecycle: run => lifecycle.recycle('local-gateway', run),
      notifyApplied: () => {
        applied = claims.run(profile, ensure)
        void applied.catch(() => {})
      },
      primaryProfile: () => 'default',
      primaryRemote: () => false,
      profileRouteOptions: () => ({
        primaryProfile: 'default',
        isolatedBackend: profile === 'isolated-worker'
      }),
      restartLocalGateway: createAttachedLocalGatewayRestarter({
        pool,
        primaryConnection: () => state.getPromise(),
        primaryProfile: () => 'default',
        restartOwner: async owner => {
          expect(owner).toBe('default')
          restartEntered.resolve()
          await restartReleased.promise
        }
      }),
      teardownPool: async () => {},
      teardownPrimary: async () => {
        state.invalidate()
      },
      teardownSsh: async () => {}
    })

    const recycle = recycleProfile(profile)

    await restartEntered.promise

    // A REST control request loses the old socket while the CLI is restarting.
    const stale = state.startAttempt()
    stale.promise = state.getPromise()
    state.clearPromiseForAttempt(stale)
    const api = ensure()
    void api.catch(() => {})
    const reconnect = claims.run(profile, ensure)
    void reconnect.catch(() => {})
    await Promise.resolve()
    await Promise.resolve()
    restartReleased.resolve()
    await recycle
    ensureReleased.resolve(replacementConnection)

    await expect(applied).resolves.toBe(replacementConnection)
    await expect(api).resolves.toBe(replacementConnection)
    await expect(reconnect).resolves.toBe(replacementConnection)
    expect(pool.has(profile)).toBe(false)
    expect(pool.has('unrelated')).toBe(true)
  }
)

it('drains admitted local starts and overlapping recycles without parking remote starts or latching a failed recycle', async () => {
  const lifecycle = createLocalBackendLifecycle({
    cancelSetup: () => {},
    stopChild: () => {},
    waitForExit: async () => {}
  })

  const state = createBackendConnectionState<never, string>()
  const oldReleased = deferred<void>()
  const restartEntered = deferred<void>()
  const restartReleased = deferred<void>()

  const old = lifecycle.start(async () => {
    await oldReleased.promise
  }, 'local-gateway')

  const first = lifecycle.recycle('local-gateway', async () => {
    restartEntered.resolve()
    await restartReleased.promise
    state.invalidate()
  })

  const second = lifecycle.recycle('local-gateway', async () => {
    state.invalidate()
    throw new Error('owner restart failed')
  })

  void second.catch(() => {})

  const replacement = lifecycle.start(async () => {
    const attempt = state.startAttempt()
    await Promise.resolve()
    state.assertCurrentAttempt(attempt)

    return 'replacement'
  }, 'local-gateway')

  await expect(lifecycle.start(async () => 'remote', 'conn:office::default')).resolves.toBe('remote')
  expect(lifecycle.hasPending()).toBe(true)
  oldReleased.resolve()
  await old
  await restartEntered.promise
  restartReleased.resolve()
  await first
  await expect(second).rejects.toThrow('owner restart failed')
  await expect(replacement).resolves.toBe('replacement')
  await expect(lifecycle.start(async () => 'next', 'local-gateway')).resolves.toBe('next')

  const quitReleased = deferred<void>()
  const quittingRestart = lifecycle.recycle('local-gateway', () => quitReleased.promise)
  const shutdown = lifecycle.shutdown()
  expect(lifecycle.hasPending()).toBe(true)
  quitReleased.resolve()
  await expect(quittingRestart).rejects.toThrow()
  await shutdown
  await expect(lifecycle.start(async () => 'after quit', 'local-gateway')).rejects.toThrow()
})

import { expect, test, vi } from 'vitest'

import { createPlatformAuth } from '../shared/platform-auth'
import { PlatformClientError } from '../shared/platform-client'

test('saved account identity unlocks offline history without a model device key', async () => {
  const identity = { id: '17', display_name: 'A', phone_masked: '', email: '' }

  const auth = createPlatformAuth({
    now: () => 1,
    client: {
      origin: 'https://api.example.com',
      profile: vi.fn().mockRejectedValue(new PlatformClientError('network_unavailable'))
    } as any,
    tokenStore: {
      load: async () => ({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: 100_000,
        deviceAccount: identity
      }),
      save: vi.fn(),
      clear: vi.fn()
    }
  })

  expect(await auth.initialize()).toMatchObject({ phase: 'offline', account: identity, model_identity_ready: false })
})
test('sync cannot use an earlier account generation or release a late response', async () => {
  let release!: (value: any) => void

  const client = {
    origin: 'https://api.example.com',
    profile: async () => ({ id: '17', display_name: 'A', phone_masked: '', email: '' }),
    syncExchange: vi.fn(
      () =>
        new Promise(resolve => {
          release = resolve
        })
    ),
    logout: async () => {}
  }

  const auth = createPlatformAuth({
    now: () => 1,
    client: client as any,
    tokenStore: {
      load: async () => ({ accessToken: 'private', refreshToken: 'refresh', expiresAt: 100_000 }),
      save: vi.fn(),
      clear: vi.fn()
    }
  })

  await auth.initialize()
  const owner = { expected_user_id: '17', expected_generation: auth.generation() }
  const pending = auth.syncExchange({} as any, owner, new AbortController().signal)
  await auth.logout()
  release({ cursor: '1' })
  await expect(pending).rejects.toThrow('auth_attempt_superseded')
  await expect(auth.syncExchange({} as any, owner, new AbortController().signal)).rejects.toThrow()
  expect(client.syncExchange).toHaveBeenCalledTimes(1)
})

test('a successful saved-token bootstrap retains verified identity for the next offline launch', async () => {
  let saved: any = { accessToken: 'access', refreshToken: 'refresh', expiresAt: 100_000 }
  const identity = { id: '17', display_name: 'A', phone_masked: '', email: '' }

  const store = {
    load: async () => saved,
    save: async (_origin: string, next: any) => {
      saved = next

      return 'encrypted' as const
    },
    clear: vi.fn()
  }

  const online = createPlatformAuth({
    now: () => 1,
    client: { origin: 'https://api.example.com', profile: async () => identity } as any,
    tokenStore: store
  })
  await online.initialize()
  expect(saved.deviceAccount).toEqual(identity)
  const offline = createPlatformAuth({
    now: () => 1,
    client: {
      origin: 'https://api.example.com',
      profile: async () => {
        throw new Error('offline')
      }
    } as any,
    tokenStore: store
  })
  expect(await offline.initialize()).toMatchObject({ phase: 'offline', account: identity })
})

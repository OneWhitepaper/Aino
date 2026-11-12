import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { normalizeRemoteBaseUrl } from './connection-config'
import { normalizeRegistry } from './connection-registry'
import { createGatewayConnectionsStore } from './gateway-connections-store'
import { createNativeAccessTokenCoordinator } from './native-access-token'
import { type NativeTokenSet, tokenNeedsRefresh } from './native-oauth'
import { loadNativeTokenSet, persistNativeTokenSet } from './native-token-store'

const roots: string[] = []
const host = 'https://gateway.test'
const sibling = 'https://other.test'

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

const tokens = (name: string, expiresAt = 1_000): NativeTokenSet => ({
  accessToken: name,
  refreshToken: `${name}-refresh`,
  expiresAt,
  provider: 'test',
  userId: name
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })

  return { promise, resolve, reject }
}

function sharedStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-native-refresh-'))
  roots.push(root)

  const registry = normalizeRegistry({
    connections: [
      { id: 'local', kind: 'local', label: 'This device' },
      { id: 'gateway', kind: 'remote', label: 'Gateway', url: host, authMode: 'native' },
      { id: 'other', kind: 'remote', label: 'Other', url: sibling, authMode: 'native' }
    ]
  })

  const open = () =>
    createGatewayConnectionsStore({
      root,
      userData: path.join(root, 'desktop'),
      legacyRegistry: () => registry,
      decrypt: secret => String((secret as { value?: string })?.value ?? '')
    })

  const store = open()
  store.read()

  return { store, writer: open() }
}

test.each([
  { change: 'replace', rejection: false },
  { change: 'replace', rejection: true },
  { change: 'remove', rejection: false },
  { change: 'remove', rejection: true }
])('external $change fences a pending refresh (rejection=$rejection) before a watcher tick', async fixture => {
  const { store, writer } = sharedStore()
  const io = store.nativeTokenIo()
  const externalIo = writer.nativeTokenIo()
  persistNativeTokenSet(host, tokens('old'), io)
  persistNativeTokenSet(sibling, tokens('other'), io)
  const cache = new Map<string, NativeTokenSet>()
  const pending = deferred<NativeTokenSet>()
  const other = deferred<NativeTokenSet>()

  const coordinator = createNativeAccessTokenCoordinator({
    normalizeBaseUrl: normalizeRemoteBaseUrl,
    nowSeconds: () => 1_000,
    tokenNeedsRefresh,
    loadTokens: (key, fresh = false) => {
      if (fresh) {
        cache.delete(key)
      }

      const value = cache.get(key) ?? loadNativeTokenSet(key, io)

      if (value) {
        cache.set(key, value)
      }

      return value
    },
    storeTokens: (key, value) => {
      persistNativeTokenSet(key, value, io)
      cache.set(key, value)
    },
    clearTokens: key => {
      cache.delete(key)
      persistNativeTokenSet(key, null, io)
    },
    isRefreshAuthRejection: error => (error as { statusCode?: number })?.statusCode === 401,
    refreshTokens: key => (key === host ? pending.promise : other.promise)
  })

  const stale = coordinator.ensure(host)
  const staleResult = expect(stale).rejects.toThrow('Authentication changed')
  const independent = coordinator.ensure(sibling)
  const replacement = fixture.change === 'replace' ? tokens('new-owner', 2_000) : null
  persistNativeTokenSet(host, replacement, externalIo)
  // No watcher notification: even a refresh that beats stat polling must read the authority.
  expect(cache.get(host)?.accessToken).toBe('old')

  if (fixture.rejection) {
    pending.reject({ statusCode: 401 })
  } else {
    pending.resolve(tokens('stale-rotation', 2_000))
  }

  await staleResult
  other.resolve(tokens('other-rotation', 2_000))
  expect(await independent).toBe('other-rotation')
  expect(loadNativeTokenSet(host, store.nativeTokenIo())).toEqual(replacement)
  expect(await coordinator.ensure(host)).toBe(replacement?.accessToken ?? null)
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { normalizeRegistry } from './connection-registry'
import { createGatewayConnectionsStore } from './gateway-connections-store'
import { loadNativeTokenSet, persistNativeTokenSet } from './native-token-store'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

it('keeps explicit keychain encryption across shared-store import, restart and opt-out', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-encrypted-'))
  roots.push(root)
  let protectedStorage = true

  const encodeSecret = (value: string) =>
    protectedStorage
      ? { encoding: 'safeStorage', value: Buffer.from(value).toString('base64') }
      : { encoding: 'plain', value }

  const decrypt = (secret: any) =>
    secret.encoding === 'safeStorage' ? Buffer.from(secret.value, 'base64').toString('utf8') : secret.value

  const registry = normalizeRegistry({
    connections: [
      {
        id: 'gw',
        kind: 'remote',
        label: 'Work',
        url: 'https://example.com',
        authMode: 'oauth',
        token: encodeSecret('secret-token'),
        headers: { 'X-Access': encodeSecret('header-secret') }
      }
    ]
  })

  const create = () =>
    createGatewayConnectionsStore({
      root,
      userData: path.join(root, 'ui'),
      legacyRegistry: () => registry,
      decrypt,
      encodeSecret,
      secretStorage: () => (protectedStorage ? 'safeStorage' : 'plain')
    })

  let store = create()
  store.read()

  const tokens = {
    accessToken: 'access-secret',
    refreshToken: 'refresh-secret',
    expiresAt: 9999,
    provider: 'test',
    userId: 'user'
  }

  persistNativeTokenSet('https://example.com', tokens, store.nativeTokenIo())

  for (const file of [store.file, store.tokensFile]) {
    const raw = fs.readFileSync(file, 'utf8')
    expect(JSON.parse(raw).secretStorage).toBe('safeStorage')

    for (const secret of ['secret-token', 'header-secret', 'access-secret', 'refresh-secret']) {
      expect(raw).not.toContain(secret)
    }
  }

  store = create()
  expect(loadNativeTokenSet('https://example.com', store.nativeTokenIo())).toEqual(tokens)
  const current = store.read()
  expect(decrypt(current.connections.find(c => c.id === 'gw')!.token)).toBe('secret-token')
  protectedStorage = false
  store.write(current)
  const io = store.nativeTokenIo()
  const map = JSON.parse(io.readStoreText())
  io.writeStoreText(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(map).map(([url, secret]) => [url, { encoding: 'plain', value: decrypt(secret) }])
      )
    )
  )
  expect(JSON.parse(fs.readFileSync(store.file, 'utf8')).secretStorage).toBe('plain')
  expect(JSON.parse(fs.readFileSync(store.tokensFile, 'utf8')).secretStorage).toBe('plain')
  expect(loadNativeTokenSet('https://example.com', store.nativeTokenIo())).toEqual(tokens)

  store.write({
    ...store.read(),
    connections: store.read().connections.map(c => (c.id === 'gw' ? { ...c, url: 'https://other.example.com' } : c))
  })
  expect(loadNativeTokenSet('https://example.com', store.nativeTokenIo())).toBeNull()
  expect(loadNativeTokenSet('https://other.example.com', store.nativeTokenIo())).toBeNull()
})

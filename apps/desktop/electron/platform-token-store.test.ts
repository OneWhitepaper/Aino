import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createPlatformTokenStore, type PlatformTokenStoreCrypto } from './platform-token-store'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function fixture(crypto?: Partial<PlatformTokenStoreCrypto>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aino-platform-token-'))
  roots.push(root)
  const filePath = path.join(root, 'platform-tokens.json')

  const fullCrypto: PlatformTokenStoreCrypto = {
    isAvailable: () => true,
    backend: () => 'keychain',
    encrypt: value => Buffer.from(`sealed:${value}`),
    decrypt: value => value.toString().replace(/^sealed:/, ''),
    ...crypto
  }

  return { filePath, store: createPlatformTokenStore({ filePath, crypto: fullCrypto }) }
}

describe('platform token storage', () => {
  it('round-trips device secrets with their account and rejects malformed encrypted identities', async () => {
    const { store, filePath } = fixture()

    const key = {
      user_id: '17',
      key_id: 'device-key',
      device_id: 'device',
      api_key: 'device-secret',
      version: 1,
      status: 'active' as const,
      expires_at: null
    }

    await store.save('https://fixture.test', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123000,
      deviceKeys: [key]
    })
    expect((await store.load('https://fixture.test'))?.deviceKeys).toEqual([key])
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain('device-secret')
    await store.save('https://fixture.test', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123000,
      deviceKeys: [{ ...key, version: 0 }]
    })
    await expect(store.load('https://fixture.test')).rejects.toMatchObject({ code: 'secure_store_read_failed' })
  })
  it('round-trips an encrypted token pair through an owner-only atomic file', async () => {
    const { filePath, store } = fixture()
    await store.save('https://api.agentera.com.cn', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123_000
    })

    expect(await store.load('https://api.agentera.com.cn')).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123_000
    })
    expect(fs.readFileSync(filePath, 'utf8')).not.toContain('refresh')

    if (process.platform !== 'win32') {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600)
    }
  })

  it('refuses basic_text and keeps the session in memory only', async () => {
    const { filePath, store } = fixture({ backend: () => 'basic_text' })
    await expect(
      store.save('https://api.agentera.com.cn', {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: 123_000
      })
    ).resolves.toBe('session_only')
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('preserves unreadable ciphertext instead of overwriting it', async () => {
    const { filePath, store } = fixture({
      decrypt: () => {
        throw new Error('keychain locked')
      }
    })

    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        accounts: {
          'https://api.agentera.com.cn': { encoding: 'safeStorage', value: Buffer.from('opaque').toString('base64') }
        }
      }),
      { mode: 0o600 }
    )
    const before = fs.readFileSync(filePath, 'utf8')

    await expect(store.load('https://api.agentera.com.cn')).rejects.toMatchObject({ code: 'secure_store_read_failed' })
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
    await expect(
      store.save('https://api.agentera.com.cn', {
        accessToken: 'new',
        refreshToken: 'new-refresh',
        expiresAt: 456_000
      })
    ).rejects.toMatchObject({ code: 'secure_store_read_failed' })
    expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
  })

  it('surfaces delete failure so logout cannot claim remembered tokens were cleared', async () => {
    const { filePath, store } = fixture()
    await store.save('https://api.agentera.com.cn', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123_000
    })
    fs.chmodSync(path.dirname(filePath), 0o500)

    try {
      await expect(store.clear('https://api.agentera.com.cn')).rejects.toMatchObject({
        code: 'secure_store_write_failed'
      })
    } finally {
      fs.chmodSync(path.dirname(filePath), 0o700)
    }
  })

  it('retains the encrypted entry after an injected atomic delete failure', async () => {
    const { filePath, store } = fixture()
    await store.save('https://api.agentera.com.cn', {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123_000
    })
    const before = fs.readFileSync(filePath, 'utf8')
    fs.chmodSync(path.dirname(filePath), 0o500)

    try {
      await expect(store.clear('https://api.agentera.com.cn')).rejects.toMatchObject({
        code: 'secure_store_write_failed'
      })
      expect(fs.readFileSync(filePath, 'utf8')).toBe(before)
    } finally {
      fs.chmodSync(path.dirname(filePath), 0o700)
    }
  })
})

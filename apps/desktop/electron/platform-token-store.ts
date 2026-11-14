import fs from 'node:fs'
import path from 'node:path'

import { parsePlatformModel } from '../shared/platform-model-contract'
import type { PlatformTokenSet, PlatformTokenStore } from '../shared/platform-token-contract'

import { writeSecretFileAtomic } from './hardening'

export interface PlatformTokenStoreCrypto {
  isAvailable(): boolean
  backend(): string
  encrypt(plaintext: string): Buffer
  decrypt(ciphertext: Buffer): string
}
export class PlatformTokenStoreError extends Error {
  constructor(public readonly code: 'secure_store_read_failed' | 'secure_store_write_failed') {
    super(code)
  }
}
interface StoredFile {
  version: 1
  accounts: Record<string, { encoding: 'safeStorage'; value: string }>
}

function validSuspensions(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        device =>
          device &&
          typeof device.user_id === 'string' &&
          device.user_id.length > 0 &&
          typeof device.device_id === 'string' &&
          device.device_id.length > 0
      ))
  )
}

function validTokens(value: unknown): value is PlatformTokenSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const token = value as Record<string, unknown>

  if (!validSuspensions(token.suspendedDevices)) {
    return false
  }

  if (token.deviceAccount !== undefined) {
    const account = token.deviceAccount as Record<string, unknown>

    if (
      !account ||
      !['id', 'display_name', 'phone_masked', 'email'].every(field => typeof account[field] === 'string')
    ) {
      return false
    }
  }

  if (token.deviceModels !== undefined) {
    if (!Array.isArray(token.deviceModels)) {
      return false
    }

    try {
      token.deviceModels.forEach(parsePlatformModel)
    } catch {
      return false
    }
  }

  if (
    token.deviceKeys !== undefined &&
    (!Array.isArray(token.deviceKeys) ||
      token.deviceKeys.some(
        key =>
          !key ||
          typeof key !== 'object' ||
          !['user_id', 'key_id', 'device_id', 'api_key'].every(
            field => typeof key[field] === 'string' && key[field].length > 0
          ) ||
          key.status !== 'active' ||
          key.expires_at !== null ||
          !Number.isSafeInteger(key.version) ||
          key.version < 1 ||
          (token.deviceAccount !== undefined && key.user_id !== (token.deviceAccount as Record<string, unknown>).id)
      ))
  ) {
    return false
  }

  return (
    typeof token.accessToken === 'string' &&
    token.accessToken.length > 0 &&
    typeof token.refreshToken === 'string' &&
    token.refreshToken.length > 0 &&
    typeof token.expiresAt === 'number' &&
    Number.isFinite(token.expiresAt) &&
    token.expiresAt > 0
  )
}

export function createPlatformTokenStore({
  filePath,
  crypto
}: {
  filePath: string
  crypto: PlatformTokenStoreCrypto
}): PlatformTokenStore {
  let unreadable = false

  function read(): StoredFile {
    if (!fs.existsSync(filePath)) {
      return { version: 1, accounts: {} }
    }

    try {
      const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredFile

      if (
        value?.version !== 1 ||
        !value.accounts ||
        typeof value.accounts !== 'object' ||
        Array.isArray(value.accounts)
      ) {
        throw new Error('invalid store')
      }

      return value
    } catch {
      unreadable = true
      throw new PlatformTokenStoreError('secure_store_read_failed')
    }
  }

  function write(value: StoredFile) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })

      if (Object.keys(value.accounts).length === 0) {
        fs.rmSync(filePath)
      } else {
        writeSecretFileAtomic(filePath, JSON.stringify(value), { encoding: 'utf8' })
      }
    } catch {
      throw new PlatformTokenStoreError('secure_store_write_failed')
    }
  }

  return {
    async load(origin) {
      const entry = read().accounts[origin]

      if (!entry) {
        return null
      }

      if (entry.encoding !== 'safeStorage' || typeof entry.value !== 'string' || !entry.value) {
        unreadable = true
        throw new PlatformTokenStoreError('secure_store_read_failed')
      }

      try {
        const parsed = JSON.parse(crypto.decrypt(Buffer.from(entry.value, 'base64')))

        if (!validTokens(parsed)) {
          throw new Error('invalid tokens')
        }

        return parsed
      } catch {
        unreadable = true
        throw new PlatformTokenStoreError('secure_store_read_failed')
      }
    },
    async save(origin, tokens) {
      if (unreadable) {
        throw new PlatformTokenStoreError('secure_store_read_failed')
      }

      const value = read()

      if (!crypto.isAvailable() || crypto.backend() === 'basic_text') {
        if (value.accounts[origin]) {
          delete value.accounts[origin]
          write(value)
        }

        return 'session_only'
      }

      try {
        value.accounts[origin] = {
          encoding: 'safeStorage',
          value: crypto.encrypt(JSON.stringify(tokens)).toString('base64')
        }
      } catch {
        throw new PlatformTokenStoreError('secure_store_write_failed')
      }

      write(value)

      return 'encrypted'
    },
    async clear(origin) {
      let value: StoredFile

      try {
        value = read()
      } catch (error) {
        if (!(error instanceof PlatformTokenStoreError) || error.code !== 'secure_store_read_failed') {
          throw error
        }

        try {
          fs.rmSync(filePath)
          unreadable = false

          return
        } catch {
          throw new PlatformTokenStoreError('secure_store_write_failed')
        }
      }

      if (!value.accounts[origin]) {
        return
      }

      delete value.accounts[origin]
      write(value)
      unreadable = false
    }
  }
}

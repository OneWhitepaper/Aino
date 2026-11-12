import { expect, it } from 'vitest'

import {
  classifyStoredSecret,
  type SecretStoragePolicy,
  transitionSecretStorageEncryption
} from './secret-storage-policy'

it('keeps partially encrypted credentials readable and retries an interrupted opt-in', () => {
  let policy: SecretStoragePolicy = { on: false, migrated: true }

  const secrets = [
    { encoding: 'plain', value: 'first' },
    { encoding: 'plain', value: 'second' }
  ]

  let interrupt = true

  const deps = {
    policy: () => policy,
    setPolicy: (next: SecretStoragePolicy) => {
      policy = next
    },
    canEncrypt: () => true,
    rewrite: () => {
      secrets[0].encoding = 'safeStorage'

      if (interrupt) {
        throw new Error('second store is busy')
      }

      secrets[1].encoding = 'safeStorage'
    }
  }

  expect(() => transitionSecretStorageEncryption(true, deps)).toThrow('second store is busy')
  expect(classifyStoredSecret(secrets[0], policy)).toBe('keep')
  expect(policy.on).toBe(true)
  interrupt = false
  expect(transitionSecretStorageEncryption(true, deps)).toEqual({ on: true })
  expect(secrets.every(secret => secret.encoding === 'safeStorage')).toBe(true)
})

it('keeps encryption on when opt-out cannot recover every credential', () => {
  let policy: SecretStoragePolicy = { on: true, migrated: true }

  const deps = {
    policy: () => policy,
    setPolicy: (next: SecretStoragePolicy) => {
      policy = next
    },
    canEncrypt: () => true,
    rewrite: () => {
      throw new Error('credential cannot be decrypted')
    }
  }

  expect(() => transitionSecretStorageEncryption(false, deps)).toThrow('credential cannot be decrypted')
  expect(policy.on).toBe(true)
})

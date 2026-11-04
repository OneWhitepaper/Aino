import { atom } from 'nanostores'
import { expect, it } from 'vitest'

import { deferred } from '../test/deferred'
import { platformModel, platformSnapshot } from '../test/platform-model'

import {
  platformErrorSurface,
  platformModelForDisplayFrom,
  platformRecoveryAction,
  platformRecoveryActionForCode,
  verifiedPlatformModelFrom
} from './platform-model-capability'
import { createPlatformModelCatalog, PlatformSelectionError } from './platform-models'

it('requires a ready catalog model and its stored account owner', async () => {
  const account = atom(platformSnapshot())
  const catalog = createPlatformModelCatalog(account, async () => [platformModel()])
  await catalog.load()

  expect(verifiedPlatformModelFrom(catalog, 'catalog-a', 'user-a')?.id).toBe('catalog-a')
  expect(verifiedPlatformModelFrom(catalog, 'catalog-a', 'other-user')).toBeNull()
  expect(verifiedPlatformModelFrom(catalog, 'missing', 'user-a')).toBeNull()

  account.set(platformSnapshot('user-b', 2))
  expect(verifiedPlatformModelFrom(catalog, 'catalog-a', 'user-a')).toBeNull()
})

it('retains only same-revision presentation metadata during refresh while request authorization waits', async () => {
  const account = atom(platformSnapshot())
  const refresh = deferred<ReturnType<typeof platformModel>[]>()
  let reads = 0

  const catalog = createPlatformModelCatalog(
    account,
    () => (++reads === 1 ? Promise.resolve([platformModel()]) : refresh.promise),
    async () => ({ user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' })
  )

  await catalog.load()
  const loading = catalog.load({ force: true })

  expect(platformModelForDisplayFrom(catalog, 'catalog-a', 'user-a', 'http://127.0.0.1:7001')?.id).toBe('catalog-a')
  expect(verifiedPlatformModelFrom(catalog, 'catalog-a', 'user-a', 'http://127.0.0.1:7001')).toBeNull()
  expect(platformModelForDisplayFrom(catalog, 'catalog-a', 'other-user', 'http://127.0.0.1:7001')).toBeNull()
  expect(platformModelForDisplayFrom(catalog, 'catalog-a', 'user-a', 'http://127.0.0.1:7002')).toBeNull()

  account.set(platformSnapshot('user-a', 2))
  expect(platformModelForDisplayFrom(catalog, 'catalog-a', 'user-a', 'http://127.0.0.1:7001')).toBeNull()
  refresh.resolve([platformModel()])
  await loading
  expect(platformModelForDisplayFrom(catalog, 'catalog-a', 'user-a', 'http://127.0.0.1:7001')).toBeNull()
})

it.each([
  ['insufficient_balance', 'billing'],
  ['quota_exhausted', 'billing'],
  ['managed_credential_expired', 'auth'],
  ['unsupported_gateway', 'gateway']
] as const)('classifies stable managed %s failures as deterministic %s recovery', (code, layer) => {
  expect(platformErrorSurface(new PlatformSelectionError(code))).toEqual({ code, layer, retryable: false })
})

it('leaves non-managed failures on the existing generic recovery path', () => {
  expect(platformErrorSurface(new Error('unrelated BYOK error'))).toBeNull()
})

it.each([
  ['quota_exhausted', 'account'],
  ['managed_credential_expired', 'account'],
  ['gateway_binding_failed', 'rebind'],
  ['platform_account_changed', 'new-chat'],
  ['model_unavailable', 'picker']
] as const)('assigns the stable %s failure its actionable recovery without replay', (code, action) => {
  expect(platformRecoveryAction(new PlatformSelectionError(code))).toBe(action)
})

it('leaves unrelated deterministic provider failures on their existing recovery surface', () => {
  expect(platformRecoveryActionForCode('provider_configuration_invalid')).toBeNull()
})

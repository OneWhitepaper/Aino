import { atom } from 'nanostores'
import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { getRuntimeI18nLocale, setRuntimeI18nLocale } from '@/i18n/runtime'

import type { PlatformAccountBridge } from '../../shared/platform-contract'
import { deferred } from '../test/deferred'
import { platformModel, platformSnapshot } from '../test/platform-model'

import {
  createPlatformSignInRecovery,
  platformErrorSurface,
  platformModelForDisplayFrom,
  platformRecoveryAction,
  platformRecoveryActionForCode,
  verifiedPlatformModelFrom
} from './platform-model-capability'
import { createPlatformModelCatalog, PlatformSelectionError } from './platform-models'

afterEach(() => vi.unstubAllGlobals())

async function recoveryAccount() {
  const account = platformSnapshot()
  const logout = vi.fn(async () => ({ ...account, revision: 2, phase: 'signed_out' as const, account: null }))

  const bridge = {
    status: async () => account,
    capabilities: async () => ({}),
    onChanged: () => () => {},
    logout
  } as unknown as PlatformAccountBridge

  vi.stubGlobal('hermesDesktop', { platformAccount: bridge })
  const actions = platformAccountActions(bridge)
  await actions.refresh()

  return { actions, logout }
}

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
  ['RECENT_AUTH_REQUIRED', 'auth'],
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
  ['RECENT_AUTH_REQUIRED', 'sign-in'],
  ['gateway_binding_failed', 'rebind'],
  ['platform_account_changed', 'new-chat'],
  ['model_unavailable', 'picker']
] as const)('assigns the stable %s failure its actionable recovery without replay', (code, action) => {
  expect(platformRecoveryAction(new PlatformSelectionError(code))).toBe(action)
})

it('leaves unrelated deterministic provider failures on their existing recovery surface', () => {
  expect(platformRecoveryActionForCode('provider_configuration_invalid')).toBeNull()
})

it('explains a recent-auth rejection in Chinese without exposing the server response', () => {
  const locale = getRuntimeI18nLocale()

  try {
    setRuntimeI18nLocale('zh')
    expect(new PlatformSelectionError('RECENT_AUTH_REQUIRED').message).toBe('请重新登录以继续。')
  } finally {
    setRuntimeI18nLocale(locale)
  }
})

it('requires explicit recovery before signing out through the existing account flow', async () => {
  const { actions, logout } = await recoveryAccount()
  const signIn = createPlatformSignInRecovery()

  expect(logout).not.toHaveBeenCalled()
  expect(actions.state.get().authenticated).toBe(true)
  await signIn()
  expect(logout).toHaveBeenCalledTimes(1)
  expect(logout).toHaveBeenCalledWith({ userId: 'user-a', mode: 'development', revision: 1 })
  expect(actions.state.get()).toMatchObject({ phase: 'signed_out', authenticated: false, account: null })
})

it.each(['account', 'revision', 'mode', 'bridge'] as const)(
  'refuses a stale sign-in recovery after the %s changes',
  async change => {
    const { actions, logout } = await recoveryAccount()
    const signIn = createPlatformSignInRecovery()

    if (change === 'bridge') {
      vi.stubGlobal('hermesDesktop', { platformAccount: {} })
    } else {
      actions.snapshot.set({
        ...platformSnapshot(change === 'account' ? 'user-b' : 'user-a', change === 'revision' ? 2 : 1),
        ...(change === 'mode' ? { mode: 'production' as const } : {})
      })
    }

    await expect(signIn()).rejects.toMatchObject({ code: 'platform_account_changed' })
    expect(logout).not.toHaveBeenCalled()
  }
)

it('keeps the account signed in and surfaces logout failure without retrying or replaying', async () => {
  const { actions, logout } = await recoveryAccount()
  logout.mockRejectedValue(Object.assign(new Error('private upstream detail'), { code: 'network_unavailable' }))
  const locale = getRuntimeI18nLocale()

  try {
    setRuntimeI18nLocale('zh')
    await expect(createPlatformSignInRecovery()()).rejects.toThrow('无法连接账户服务，请检查网络后重试。')
    expect(logout).toHaveBeenCalledTimes(1)
    expect(actions.state.get()).toMatchObject({ authenticated: true, error: { code: 'network_unavailable' } })
  } finally {
    setRuntimeI18nLocale(locale)
  }
})

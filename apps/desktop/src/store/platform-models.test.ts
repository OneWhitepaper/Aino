import { atom } from 'nanostores'
import { afterEach, expect, it, vi } from 'vitest'

import { rescopeConnectionScopedStores } from '@/lib/connection-scoped'

import type { PlatformAccountSnapshot, PlatformModel } from '../../shared/platform-contract'
import { platformModel, platformSnapshot } from '../test/platform-model'

import {
  createPlatformModelCatalog,
  readPlatformDefault,
  requirePlatformSelection,
  writePlatformDefault
} from './platform-models'

afterEach(() => vi.restoreAllMocks())

it('reuses a ready catalog briefly but refreshes on demand, expiry and account revision changes', async () => {
  let now = 100_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const account = atom<PlatformAccountSnapshot | null>(platformSnapshot())
  const list = vi.fn(async () => [platformModel()])
  const lookupOwner = async () => ({ user_id: account.get()!.account!.id, platform_origin: 'http://127.0.0.1:7001' })
  const catalog = createPlatformModelCatalog(account, list, lookupOwner)

  await catalog.load()

  for (let index = 0; index < 100; index++) {
    await catalog.load()
  }

  expect(list).toHaveBeenCalledTimes(1)

  await catalog.load({ force: true })
  expect(list).toHaveBeenCalledTimes(2)
  now += 29_999
  await catalog.load()
  expect(list).toHaveBeenCalledTimes(2)
  now += 1
  await catalog.load()
  expect(list).toHaveBeenCalledTimes(3)

  account.set(platformSnapshot('user-a', 2))
  await catalog.load()
  expect(list).toHaveBeenCalledTimes(4)
  account.set(platformSnapshot('user-b', 3))
  expect(catalog.state.get().models).toEqual([])
  await catalog.load()
  expect(list).toHaveBeenCalledTimes(5)
})

it('does not reuse the successful freshness deadline after a failed explicit refresh', async () => {
  const account = atom<PlatformAccountSnapshot | null>(platformSnapshot())

  const list = vi
    .fn()
    .mockResolvedValueOnce([platformModel()])
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce([platformModel('updated')])

  const catalog = createPlatformModelCatalog(account, list)

  await catalog.load()
  await catalog.load({ force: true })
  expect(catalog.state.get().phase).toBe('error')
  await catalog.load()

  expect(catalog.state.get().models.map(model => model.id)).toEqual(['updated'])
  expect(list).toHaveBeenCalledTimes(3)
})

it('isolates defaults by account, connection, profile and exact platform origin', () => {
  const developmentA = 'http://127.0.0.1:7001'
  const developmentB = 'http://127.0.0.1:7002'
  writePlatformDefault('user-a', 'catalog-a', undefined, 'development', developmentA)
  expect(readPlatformDefault('user-a', undefined, 'development', developmentA)).toBe('catalog-a')
  expect(readPlatformDefault('user-a', undefined, 'development', developmentB)).toBeNull()
  expect(readPlatformDefault('user-b', undefined, 'development', developmentA)).toBeNull()
  writePlatformDefault('user-a', null, undefined, 'development', developmentA)
  expect(readPlatformDefault('user-a', undefined, 'development', developmentA)).toBeNull()
  const work = { connectionId: 'remote-a', profile: 'work' }
  writePlatformDefault('user-a', 'work-model', work, 'development', developmentA)
  expect(readPlatformDefault('user-a', work, 'development', developmentA)).toBe('work-model')
  expect(readPlatformDefault('user-a', work, 'development', developmentB)).toBeNull()
  expect(readPlatformDefault('user-a', { ...work, profile: 'other' }, 'development', developmentA)).toBeNull()
  expect(readPlatformDefault('user-a', { ...work, connectionId: 'remote-b' }, 'development', developmentA)).toBeNull()
  expect(readPlatformDefault('user-b', work, 'development', developmentA)).toBeNull()
  expect(readPlatformDefault('user-a', work, 'production', 'https://api.agentera.com.cn')).toBeNull()
  localStorage.setItem('aino.desktop.platform-default.user-a', 'legacy-model')
  expect(readPlatformDefault('user-a', undefined, 'production', 'https://api.agentera.com.cn')).toBe('legacy-model')
  expect(readPlatformDefault('user-a', 'work', 'production', 'https://api.agentera.com.cn')).toBeNull()
  expect(
    readPlatformDefault(
      'user-a',
      { connectionId: 'remote-b', profile: 'default' },
      'production',
      'https://api.agentera.com.cn'
    )
  ).toBeNull()
  rescopeConnectionScopedStores({ mode: 'remote', baseUrl: 'https://legacy.example', profile: 'default' })
  expect(readPlatformDefault('user-a', undefined, 'development', developmentA)).toBeNull()
  writePlatformDefault('user-a', 'legacy-remote-work', 'work', 'development', developmentA)
  rescopeConnectionScopedStores({ mode: 'remote', baseUrl: 'https://legacy.example', profile: 'work' })
  expect(readPlatformDefault('user-a', 'work', 'development', developmentA)).toBe('legacy-remote-work')
  rescopeConnectionScopedStores({ mode: 'local', profile: 'default' })
})

it('completes an in-flight catalog load after an equivalent account snapshot refresh', async () => {
  const account = atom<PlatformAccountSnapshot | null>(platformSnapshot())
  let resolve!: (value: PlatformModel[]) => void

  const catalog = createPlatformModelCatalog(
    account,
    () =>
      new Promise(r => {
        resolve = r
      })
  )

  const loading = catalog.load()
  account.set(platformSnapshot())
  const refresh = catalog.load()
  resolve([platformModel()])
  await loading
  await refresh
  expect(catalog.state.get().phase).toBe('ready')
  expect(catalog.state.get().models.map(row => row.id)).toEqual(['catalog-a'])
})

it('does not expose an old catalog when account changes during a request', async () => {
  const account = atom<PlatformAccountSnapshot | null>(platformSnapshot())
  let resolve!: (value: PlatformModel[]) => void

  const catalog = createPlatformModelCatalog(
    account,
    () =>
      new Promise(r => {
        resolve = r
      })
  )

  const loading = catalog.load()
  account.set(platformSnapshot('user-b', 2))
  resolve([platformModel()])
  await loading
  expect(catalog.state.get().models).toEqual([])
  expect(catalog.state.get().phase).toBe('idle')
})

it('distinguishes errors from an empty catalog and refuses unavailable or foreign selections', async () => {
  const account = atom<PlatformAccountSnapshot | null>(platformSnapshot())
  const list = vi.fn().mockRejectedValueOnce({ code: 'network_error' }).mockResolvedValueOnce([])
  const catalog = createPlatformModelCatalog(account, list)
  await catalog.load()
  expect(catalog.state.get().phase).toBe('error')
  await catalog.load()
  expect(catalog.state.get().phase).toBe('ready')
  const model = platformModel()
  expect(requirePlatformSelection(account.get(), [model], model.id, 'user-a')).toEqual(model)
  expect(() => requirePlatformSelection(account.get(), [model], model.id, 'user-b')).toThrow()
  expect(() =>
    requirePlatformSelection(account.get(), [{ ...model, state: 'insufficient_balance' }], model.id, 'user-a')
  ).toThrow()
})

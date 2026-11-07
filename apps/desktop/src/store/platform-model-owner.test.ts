import { atom } from 'nanostores'
import { expect, it } from 'vitest'

import type { PlatformAccountSnapshot } from '../../shared/platform-contract'
import { platformSnapshot } from '../test/platform-model'

import { createPlatformModelOwner } from './platform-model-owner'

it('discards an old authority after the account mode changes, even with the same id and revision', async () => {
  const account = atom<PlatformAccountSnapshot | null>({ ...platformSnapshot(), mode: 'production' })
  let complete!: (owner: { user_id: string; platform_origin: string }) => void
  const owner = createPlatformModelOwner(
    account,
    () =>
      new Promise(resolve => {
        complete = resolve
      })
  )
  const pending = owner.load()
  await Promise.resolve()
  account.set({ ...platformSnapshot(), mode: 'development' })
  complete({ user_id: 'user-a', platform_origin: 'https://api.agentera.com.cn' })
  await pending
  expect(owner.state.get()).toEqual({ phase: 'idle', owner: null })
})

it('publishes only the matching authority and invalidates it on account revision changes', async () => {
  const account = atom<PlatformAccountSnapshot | null>(platformSnapshot())
  let user = 'other-user'
  const owner = createPlatformModelOwner(account, async () => ({
    user_id: user,
    platform_origin: 'http://127.0.0.1:7001'
  }))
  await owner.load()
  expect(owner.state.get()).toEqual({ phase: 'error', owner: null })
  user = 'user-a'
  await owner.load()
  expect(owner.state.get()).toEqual({
    phase: 'ready',
    owner: { user_id: user, platform_origin: 'http://127.0.0.1:7001' }
  })
  account.set(platformSnapshot('user-a', 2))
  expect(owner.state.get()).toEqual({ phase: 'idle', owner: null })
})

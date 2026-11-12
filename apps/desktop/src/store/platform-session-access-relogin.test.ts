import { afterEach, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { createClientSessionState } from '@/lib/chat-runtime'
import { platformModelCatalog } from '@/store/platform-models'
import { $sessionStates } from '@/store/session-states'
import { deferred } from '@/test/deferred'
import { platformSnapshot } from '@/test/platform-model'

import { platformHistoryOwner, platformSessionAccess } from './platform-session-access'

const originalDesktop = window.hermesDesktop
afterEach(() => {
  $sessionStates.set({})
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
})

it('does not relabel a same-account chat as foreign while a relogin refreshes its origin authority', async () => {
  let snapshot = platformSnapshot('user-a', 1)
  const pending = deferred<{ user_id: string; platform_origin: string }>()
  const owner = { user_id: 'user-a', platform_origin: 'https://aino.test' }
  const lookup = vi
    .fn()
    .mockResolvedValueOnce(owner)
    .mockImplementationOnce(() => pending.promise)
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      accountAdapter: 'platform',
      platformAccount: {
        status: async () => snapshot,
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: { list: async () => [], owner: lookup }
    }
  })
  const actions = platformAccountActions(window.hermesDesktop.platformAccount)
  await actions.refresh()
  const catalog = platformModelCatalog()
  await catalog.owner.load()
  $sessionStates.set({
    chat: {
      ...createClientSessionState('stored'),
      model: 'catalog-a',
      provider: 'aino',
      platformModel: {
        modelId: 'catalog-a',
        ownerUserId: 'user-a',
        platformOrigin: owner.platform_origin,
        status: 'ready'
      }
    }
  })
  expect(platformHistoryOwner('chat')).toBeNull()

  snapshot = platformSnapshot('user-a', 2)
  await actions.refresh()
  const refreshing = catalog.owner.load()
  expect(catalog.owner.state.get().phase).toBe('loading')
  expect(platformHistoryOwner('chat')).toBeNull()
  expect(platformSessionAccess('chat')).toEqual({ kind: 'authority_pending' })

  pending.resolve(owner)
  await refreshing
  expect(platformHistoryOwner('chat')).toBeNull()
  expect(platformSessionAccess('chat')).toEqual({ kind: 'allowed' })
})

it('distinguishes an unbound managed stage from foreign history without authorizing either', async () => {
  const snapshot = platformSnapshot('user-a', 1)
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      accountAdapter: 'platform',
      platformAccount: {
        status: async () => snapshot,
        capabilities: async () => ({}),
        onChanged: () => () => undefined
      },
      platformModels: {
        list: async () => [],
        owner: async () => ({ user_id: 'user-a', platform_origin: 'https://aino.test' })
      }
    }
  })
  await platformAccountActions(window.hermesDesktop.platformAccount).refresh()
  await platformModelCatalog().owner.load()

  const staged = {
    ...createClientSessionState('stored'),
    model: 'catalog-a',
    provider: 'aino',
    platformModel: { modelId: 'catalog-a', ownerUserId: '', status: 'awaiting_managed_credentials' as const }
  }

  $sessionStates.set({ staged })

  expect(platformHistoryOwner('staged')).toBeNull()
  expect(platformSessionAccess('staged')).toEqual({ kind: 'unbound' })

  $sessionStates.set({
    staged: {
      ...staged,
      platformModel: {
        ...staged.platformModel,
        ownerUserId: 'user-b',
        platformOrigin: 'https://aino.test',
        status: 'ready'
      }
    }
  })
  expect(platformHistoryOwner('staged')).toBe('user-b')
  expect(platformSessionAccess('staged')).toEqual({ kind: 'foreign', ownerUserId: 'user-b' })
})

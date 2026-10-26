import { expect, it } from 'vitest'

import { platformModel, platformSnapshot } from '../test/platform-model'

import { platformCreateOverrides, platformModelStatePatch } from './platform-session-model'

it('keeps the catalog identity through draft creation and runtime updates', () => {
  const account = platformSnapshot()
  const catalog = [platformModel()]
  expect(platformCreateOverrides('aino', 'catalog-a', 'user-a', account, catalog)).toEqual({
    model_source: 'aino',
    model_id: 'catalog-a'
  })

  const patch = platformModelStatePatch({
    model_source: 'aino',
    model_id: 'catalog-a',
    model: 'wire-model',
    provider: 'aino',
    platform_owner: { user_id: 'user-a', platform_origin: 'http://127.0.0.1:1234' },
    model_status: 'ready'
  })

  expect(patch).toEqual({
    model: 'catalog-a',
    platformModel: {
      modelId: 'catalog-a',
      ownerUserId: 'user-a',
      platformOrigin: 'http://127.0.0.1:1234',
      status: 'ready'
    }
  })
  expect(platformModelStatePatch({ model: 'byok-model', provider: 'custom:local' })).toEqual({ platformModel: null })
  expect(platformModelStatePatch({ running: false })).toEqual({})
})

it('never silently switches a saved platform choice to a different account', () => {
  expect(() =>
    platformCreateOverrides('aino', 'catalog-a', 'user-a', platformSnapshot('user-b'), [platformModel()])
  ).toThrow()
  expect(platformCreateOverrides('custom:local', 'byok-model', '', null, [])).toEqual({
    model: 'byok-model',
    provider: 'custom:local'
  })
})

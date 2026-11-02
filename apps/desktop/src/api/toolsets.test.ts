import { afterEach, expect, it, vi } from 'vitest'

import { selectToolsetModel } from './toolsets'

afterEach(() => Reflect.deleteProperty(window, 'hermesDesktop'))

it('keeps legacy selection payloads and opts into atomic activation only when requested', async () => {
  const api = vi.fn().mockResolvedValue({ ok: true })
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
  const profile = { connectionId: 'remote', profile: 'writer' }
  await selectToolsetModel('image_gen', 'image-model', 'Aino', profile)
  expect(api).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ...profile,
      method: 'PUT',
      path: '/api/tools/toolsets/image_gen/model',
      body: { model: 'image-model', provider: 'Aino' }
    })
  )
  await selectToolsetModel('image_gen', 'image-model', 'Aino', profile, { activate: true })
  expect(api).toHaveBeenLastCalledWith(
    expect.objectContaining({
      ...profile,
      method: 'PUT',
      path: '/api/tools/toolsets/image_gen/model',
      body: { model: 'image-model', provider: 'Aino', activate: true }
    })
  )
})

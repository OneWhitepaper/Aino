import { afterEach, expect, it, vi } from 'vitest'

import { validateCustomEndpoint } from '@/api/config'

afterEach(() => Reflect.deleteProperty(window, 'hermesDesktop'))

it('gives bounded protocol detection time to complete for the captured owner', async () => {
  const api = vi.fn().mockResolvedValue({ ok: true, reachable: true, models: [], message: '' })
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })

  await validateCustomEndpoint(
    { name: 'Fixture', base_url: 'https://fixture.example/v1', model: 'fixture-model', api_mode: '' },
    { connectionId: 'remote-fixture', profile: 'writer' }
  )

  expect(api).toHaveBeenCalledWith(
    expect.objectContaining({
      path: '/api/providers/custom-endpoints/validate',
      timeoutMs: 60_000,
      connectionId: 'remote-fixture',
      profile: 'writer'
    })
  )
})

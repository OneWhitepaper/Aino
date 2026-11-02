// @vitest-environment node
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { queryClient } from '@/lib/query-client'

import { catalogQueryKey, fetchCatalog, prefetchCatalogWhenIdle } from './catalog-data'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[{"name":"weather","tier":"community","source":"community"}]'))
  )
})

afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
})

describe('profile catalog queries', () => {
  it('prefetches the default public catalog while retaining the requested profile cache', async () => {
    const profile = { connectionId: 'local', profile: 'writer' }
    let idle!: IdleRequestCallback
    const cancel = vi.fn()
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn(callback => {
        idle = callback

        return 73
      })
    )
    vi.stubGlobal('cancelIdleCallback', cancel)

    const dispose = prefetchCatalogWhenIdle('plugins', profile)
    idle({ didTimeout: false, timeRemaining: () => 50 })
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(catalogQueryKey('plugins', profile))?.status).toBe('success')
    )
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://nousresearch.github.io/hermes-agent/docs/api/plugins.json',
      expect.objectContaining({ credentials: 'omit' })
    )
    dispose()
    expect(cancel).toHaveBeenCalledWith(73)
  })

  it.each(['skills', 'plugins'] as const)('loads the published %s catalog without a new service flag', async kind => {
    expect(await fetchCatalog(kind)).toMatchObject([{ name: 'weather' }])
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      'https://nousresearch.github.io/hermes-agent/docs/api/' + kind + '.json',
      expect.objectContaining({ credentials: 'omit' })
    )
  })

  it('keeps profile and gateway query caches independent', async () => {
    const client = new QueryClient()
    const local = { connectionId: 'local', profile: 'bot' }
    const remote = { connectionId: 'gateway-two', profile: 'bot' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('[{"name":"Local","source":"official"}]'))
      .mockResolvedValueOnce(new Response('[{"name":"Remote","source":"official"}]'))

    await client.fetchQuery({ queryKey: catalogQueryKey('skills', local), queryFn: () => fetchCatalog('skills') })
    await client.fetchQuery({ queryKey: catalogQueryKey('skills', remote), queryFn: () => fetchCatalog('skills') })
    expect(client.getQueryData(catalogQueryKey('skills', local))).toMatchObject([{ name: 'Local' }])
    expect(client.getQueryData(catalogQueryKey('skills', remote))).toMatchObject([{ name: 'Remote' }])
    expect(catalogQueryKey('skills', 'bot')).not.toEqual(catalogQueryKey('skills', 'default'))
    client.clear()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activateCustomEndpoint,
  deleteCustomEndpoint,
  getCustomEndpoints,
  getEnvVars,
  saveCustomEndpoint,
  setApiRequestConnection,
  setApiRequestProfile,
  validateCustomEndpoint
} from '@/hermes'

const api = vi.fn(async (_request: { connectionId?: string; path: string; profile?: string }) => ({}))
const endpoint = { base_url: 'https://models.example/v1', model: 'fixture-model', name: 'Fixture' }

beforeEach(() => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { api } })
  setApiRequestConnection('ambient-gateway')
  setApiRequestProfile('ambient-profile')
})

afterEach(() => {
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  api.mockClear()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

describe('custom endpoint ownership', () => {
  it.each(['local', 'remote-gateway'])('routes every operation to the explicit %s owner', async connectionId => {
    const scope = { connectionId, profile: 'writer' }
    await getEnvVars(scope)
    await getCustomEndpoints(scope)
    await validateCustomEndpoint(endpoint, scope)
    await saveCustomEndpoint(endpoint, scope)
    await activateCustomEndpoint('fixture', scope)
    await deleteCustomEndpoint('fixture', scope)

    expect(api).toHaveBeenCalledTimes(6)

    for (const [request] of api.mock.calls) {
      expect(request).toEqual(expect.objectContaining({ connectionId, profile: 'writer' }))
    }
  })

  it('keeps a captured legacy env route untagged when a registry connection becomes active', async () => {
    const capturedOwner = { connectionId: null, profile: 'legacy-remote-profile' }
    setApiRequestConnection('new-registry-primary')
    setApiRequestProfile('unrelated-profile')

    await getEnvVars(capturedOwner)

    expect(api).toHaveBeenCalledWith(expect.objectContaining({ path: '/api/env', profile: 'legacy-remote-profile' }))
    expect(api.mock.calls[0][0].connectionId).toBeUndefined()
  })

  it('does not replace a captured primary profile with the later ambient profile', async () => {
    await getEnvVars({ connectionId: 'local', profile: null })

    expect(api.mock.calls[0][0]).toMatchObject({ connectionId: 'local', path: '/api/env' })
    expect(api.mock.calls[0][0].profile).toBeUndefined()
  })
})

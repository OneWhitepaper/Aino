import { describe, expect, it, vi } from 'vitest'

import { createCloudTransferDiscovery } from './cloud-transfer-discovery'

function fixture() {
  return {
    assertCurrent: vi.fn(),
    portalBaseUrl: 'https://portal.example',
    hasLivePortalSession: vi.fn(async () => true),
    hasPortalAccessToken: vi.fn(async () => true),
    renewPortalAccessSilently: vi.fn(async () => true),
    fetchAgents: vi.fn<(...args: string[]) => Promise<unknown>>(async () => ({
      agents: [{ id: 'agent-a', name: 'My agent', secret: 'private' }]
    }))
  }
}

describe('explicit cloud transfer discovery', () => {
  it('does no work until requested and projects only public destination fields', async () => {
    const deps = fixture()
    const discover = createCloudTransferDiscovery(deps)
    expect(deps.hasLivePortalSession).not.toHaveBeenCalled()
    expect(deps.fetchAgents).not.toHaveBeenCalled()
    const result = await discover('team / one')
    expect(deps.fetchAgents).toHaveBeenCalledWith('https://portal.example/api/agents?org=team%20%2F%20one')
    expect(result.agents?.[0]).toMatchObject({ id: 'agent-a', name: 'My agent' })
    expect(result.agents?.[0]).not.toHaveProperty('secret')
  })

  it('fences an account change before discovery can send a request', async () => {
    const deps = fixture()
    deps.hasLivePortalSession.mockImplementation(async () => {
      deps.assertCurrent.mockImplementation(() => {
        throw new Error('account changed')
      })

      return true
    })
    await expect(createCloudTransferDiscovery(deps)()).rejects.toThrow('account changed')
    expect(deps.fetchAgents).not.toHaveBeenCalled()
  })

  it('renews a rejected session once and retains the selected team', async () => {
    const deps = fixture()
    deps.fetchAgents.mockRejectedValueOnce(Object.assign(new Error('expired'), { statusCode: 401 }))
    await createCloudTransferDiscovery(deps)('team-a')
    expect(deps.renewPortalAccessSilently).toHaveBeenCalledExactlyOnceWith({ force: true })
    expect(deps.fetchAgents).toHaveBeenCalledTimes(2)
    expect(deps.fetchAgents.mock.calls[1]?.[0]).toContain('org=team-a')
  })
})

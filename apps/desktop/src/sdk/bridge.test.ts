import { afterEach, describe, expect, it, vi } from 'vitest'

import { $pluginDecisions } from '@/contrib/plugins-store'
import { host } from '@/sdk'
import * as gateway from '@/store/gateway'
import { $connection } from '@/store/session'

// The bridge must hit the SAME api-module functions the Capabilities page
// calls (not a parallel fetch path), forwarding the ProfileScope untouched —
// that is the whole contract: typing + profile scoping over existing doors.
const apiMocks = vi.hoisted(() => ({
  getProfiles: vi.fn(async () => ({ profiles: [] })),
  getSkills: vi.fn(async () => []),
  getToolsets: vi.fn(async () => []),
  runExportProfileFlow: vi.fn(async () => '/tmp/writer.tar.gz'),
  runImportProfileFlow: vi.fn(async () => 'writer-copy'),
  setSkillEnabled: vi.fn(async () => ({ enabled: false, name: 'docx', ok: true })),
  setToolsetEnabled: vi.fn(async () => ({ enabled: true, name: 'browser', ok: true }))
}))

vi.mock('@/api/skills', () => ({ getSkills: apiMocks.getSkills, setSkillEnabled: apiMocks.setSkillEnabled }))
vi.mock('@/api/toolsets', () => ({ getToolsets: apiMocks.getToolsets, setToolsetEnabled: apiMocks.setToolsetEnabled }))
vi.mock('@/api/profiles', () => ({ getProfiles: apiMocks.getProfiles }))
vi.mock('@/store/profile-share', () => ({
  runExportProfileFlow: apiMocks.runExportProfileFlow,
  runImportProfileFlow: apiMocks.runImportProfileFlow
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  $connection.set(null)
})

describe('host capabilities bridge', () => {
  it('routes list/setEnabled through the Capabilities api modules with the profile scope', async () => {
    const scope = { connectionId: 'conn-1', profile: 'writer' }

    await host.skills.list(scope)
    await host.skills.setEnabled('docx', false, scope)
    await host.toolsets.list('writer')
    await host.toolsets.setEnabled('browser', true, 'writer')
    await host.profiles.list()

    expect(apiMocks.getSkills).toHaveBeenCalledWith(scope)
    expect(apiMocks.setSkillEnabled).toHaveBeenCalledWith('docx', false, scope)
    expect(apiMocks.getToolsets).toHaveBeenCalledWith('writer')
    expect(apiMocks.setToolsetEnabled).toHaveBeenCalledWith('browser', true, 'writer')
    expect(apiMocks.getProfiles).toHaveBeenCalledWith(undefined)
  })

  it('imports without activating the bot and exports the selected exact local owner', async () => {
    vi.spyOn(gateway, 'activeGatewayConnectionId').mockReturnValue('local')
    const route = { connectionId: 'local', profile: 'writer', targetProfile: 'writer', mode: 'local' as const }

    await expect(host.profiles.import()).resolves.toBe('writer-copy')
    await expect(host.profiles.export('writer', route)).resolves.toBe('/tmp/writer.tar.gz')

    expect(apiMocks.runImportProfileFlow).toHaveBeenCalledWith({ management: true, scope: { connectionId: 'local' } })
    expect(apiMocks.runExportProfileFlow).toHaveBeenCalledWith('writer', { connectionId: 'local', profile: 'writer' })
  })

  it('refuses a different owner or remote archive before opening a local filesystem dialog', async () => {
    const local = { connectionId: 'local', profile: 'writer', targetProfile: 'writer', mode: 'local' as const }
    const remote = { ...local, connectionId: 'server', mode: 'remote' as const }

    await expect(host.profiles.export('other-bot', local)).rejects.toThrow('owner')
    await expect(host.profiles.export('writer', remote)).rejects.toThrow()
    $connection.set({ mode: 'remote' } as never)
    await expect(host.profiles.import()).rejects.toThrow()
    expect(apiMocks.runImportProfileFlow).not.toHaveBeenCalled()
    expect(apiMocks.runExportProfileFlow).not.toHaveBeenCalled()
  })

  // Declined by design: a plugin must not flip another plugin's enable state,
  // and the singleton host cannot attribute the caller to restrict `set` to its
  // own id. The view is a live, subscribable mirror of the app's store with NO
  // writer at runtime (a type-only `ReadableAtom` cast would still carry `.set`),
  // and the values it hands out are frozen copies — mutating one must not reach
  // the object `pluginActive()` reads and `saveDecisions()` persists.
  it('pluginDecisions is a live read-only view of the decisions store', () => {
    const seen: Record<string, boolean>[] = []
    const unsubscribe = host.pluginDecisions.subscribe(value => seen.push(value))

    $pluginDecisions.set({ 'demo-plugin': false })

    expect(host.pluginDecisions.get()).toEqual({ 'demo-plugin': false })
    expect(seen.at(-1)).toEqual({ 'demo-plugin': false })
    expect(typeof (host.pluginDecisions as unknown as { set?: unknown }).set).toBe('undefined')

    for (const view of [host.pluginDecisions.get(), host.pluginDecisions.value!, seen.at(-1)!]) {
      expect(() => {
        view['other-plugin'] = false
      }).toThrow(TypeError)
    }

    expect($pluginDecisions.get()).toEqual({ 'demo-plugin': false })

    unsubscribe()
  })
})

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesktopProfileRoute, HermesApiRequest } from '@/global'
import { createClientSessionState } from '@/lib/chat-runtime'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { freshDraftScope } from '@/store/composer'
import { $defaultProfileRoute, setDefaultProfile } from '@/store/default-profile'
import { requestGatewayForAgent } from '@/store/gateway'
import { $modelPresets, getModelPreset, modelPresetScope, setModelPreset } from '@/store/model-presets'
import {
  $activeGatewayProfile,
  $newChatConnectionId,
  $newChatProfile,
  $newChatRoute,
  captureNewChatSource,
  ensureGatewayAgent,
  ensureGatewayProfile,
  resolveNewChatOwnerRoute
} from '@/store/profile'
import { $projectScope, ALL_PROJECTS } from '@/store/project-scope'
import {
  $activeSessionId,
  $connection,
  $currentModel,
  $currentProvider,
  $currentReasoningEffort,
  $currentReasoningEffortWire,
  $sessions,
  _resetSessionOwnerHintsForTests,
  applyConfiguredDefaultProjectDir,
  clearComposerSelectionOwner,
  getCurrentModelSource,
  getSessionOwnerHint,
  markComposerSelectionManual,
  setActiveSessionId,
  setComposerSelectionOwner,
  setConnection,
  setCurrentModel,
  setCurrentModelSource,
  setCurrentProvider,
  setCurrentReasoningEffort,
  setCurrentReasoningEffortWire,
  setSessions
} from '@/store/session'

import { useSlashCommand } from './use-prompt-actions/slash'
import { useSessionActions } from './use-session-actions'

vi.mock('@/store/profile', async original => ({
  ...(await original<Record<string, unknown>>()),
  ensureGatewayAgent: vi.fn(async () => undefined),
  ensureGatewayProfile: vi.fn(async () => undefined)
}))
vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  activeGatewayConnectionId: vi.fn(() => 'previous'),
  requestGatewayForAgent: vi.fn(),
  retainGatewayForAgent: vi.fn(async () => () => undefined)
}))

// Routed session.create dials are user gestures (send / "New session"), so the
// hook tags them foreground (#105104); the two undefineds are timeout/signal.
const FOREGROUND_CREATE_DIAL = [undefined, undefined, { spawnPriority: 'foreground' }] as const

function mountActions() {
  const ref = <T,>(current: T) => ({ current })
  const requestGateway = vi.fn(async () => ({ session_id: 'ambient', stored_session_id: 'ambient-stored' }) as never)
  const navigate = vi.fn()
  const state = createClientSessionState()

  const result = renderHook(() =>
    useSessionActions({
      activeSessionId: 'existing-runtime',
      activeSessionIdRef: ref<string | null>('existing-runtime'),
      busyRef: ref(false),
      creatingSessionRef: ref(false),
      ensureSessionState: () => state,
      getRouteToken: () => 'route',
      getRoutedStoredSessionId: () => null,
      navigate,
      requestGateway,
      resetViewSync: vi.fn(),
      routedSessionId: null,
      runtimeIdByStoredSessionIdRef: ref(new Map()),
      selectedStoredSessionId: null,
      selectedStoredSessionIdRef: ref<string | null>(null),
      sessionStateByRuntimeIdRef: ref(new Map()),
      syncSessionStateToView: vi.fn(),
      updateSessionState: () => state
    })
  )

  return { ...result, navigate, requestGateway, state }
}

function mountSlashCommand(startFreshSessionDraft: () => void) {
  return renderHook(() =>
    useSlashCommand({
      activeSessionIdRef: { current: 'existing-runtime' },
      busyRef: { current: false },
      selectedStoredSessionIdRef: { current: null },
      startFreshSessionDraft,
      requestGateway: vi.fn(async () => ({})),
      copy: {},
      getRoutedStoredSessionId: () => null,
      getRuntimeIdForStoredSession: () => null
    } as never)
  )
}

beforeEach(() => {
  $modelPresets.set({})
  setCurrentModel('')
  setCurrentProvider('')
  setCurrentModelSource('')
  setCurrentReasoningEffort('')
  _resetSessionOwnerHintsForTests()
  $defaultProfileRoute.set(null)
  $newChatRoute.set({ connectionId: 'previous', profile: 'other' })
  $newChatProfile.set('other')
  $newChatConnectionId.set('previous')
  $activeGatewayProfile.set('other')
  $projectScope.set(ALL_PROJECTS)
  setSessions([])
  setActiveSessionId('existing-runtime')
  setConnection({
    baseUrl: 'http://localhost:7070',
    connectionId: 'previous',
    isFullscreen: false,
    logs: [],
    mode: 'remote',
    nativeOverlayWidth: 0,
    token: '',
    windowButtonPosition: null,
    wsUrl: 'ws://localhost:7070'
  })
  window.hermesDesktop = {
    api: vi.fn(async ({ path, method = 'GET' }: HermesApiRequest) => {
      if (path !== '/api/model/info' || method !== 'GET') {
        throw new Error(`Unexpected default model request: ${method} ${path}`)
      }

      return { model: 'configured-model', provider: 'configured-provider' }
    }),
    profile: { setDefault: async (route: DesktopProfileRoute) => route }
  } as never
  vi.mocked(requestGatewayForAgent).mockReset()
  vi.mocked(requestGatewayForAgent).mockResolvedValue({
    session_id: 'created',
    stored_session_id: 'created-stored',
    info: {}
  })
})

afterEach(() => {
  cleanup()
  applyConfiguredDefaultProjectDir('')
  window.history.replaceState(null, '', '/')
  $defaultProfileRoute.set(null)
  $newChatRoute.set(null)
  $newChatProfile.set(null)
  $newChatConnectionId.set(null)
  captureNewChatSource(null)
  setActiveSessionId(null)
  setConnection(null)
  setSessions([])
  setCurrentModel('')
  setCurrentProvider('')
  setCurrentModelSource('')
  setCurrentReasoningEffort('')
  $modelPresets.set({})
  vi.clearAllMocks()
})

describe('generic new session default routing', () => {
  it('keeps draft model options with the assigned conversation after the first send', async () => {
    const { result } = mountActions()
    act(() => result.current.selectSidebarItem({ action: 'new-session' } as never))
    const owner = platformDefaultScope({ connectionId: 'previous', profile: 'other' }).key
    setModelPreset('provider', 'model', { effort: 'high' }, modelPresetScope(owner, freshDraftScope()))
    await act(() => result.current.createBackendSessionForSend())
    expect(getModelPreset('provider', 'model', modelPresetScope(owner, 'created-stored'))).toEqual({ effort: 'high' })
    expect(getModelPreset('provider', 'model')).toEqual({})
  })

  it.each(['draft', 'slash'])('drops the previous conversation model and effort before %s first send', async action => {
    const { result, state } = mountActions()
    state.model = 'existing-manual-model'
    state.provider = 'existing-provider'
    state.reasoningEffort = 'high'
    setCurrentModel(state.model)
    setCurrentProvider(state.provider)
    setCurrentReasoningEffort(state.reasoningEffort)
    setCurrentReasoningEffortWire('high')
    markComposerSelectionManual()

    if (action === 'slash') {
      const slash = mountSlashCommand(result.current.startFreshSessionDraft)
      await act(() => slash.result.current('/new'))
    } else {
      act(() => result.current.selectSidebarItem({ action: 'new-session' } as never))
    }

    expect(getCurrentModelSource()).toBe('default')
    expect($currentModel.get()).toBe('')
    expect($currentProvider.get()).toBe('')
    expect($currentReasoningEffort.get()).toBe('')
    expect($currentReasoningEffortWire.get()).toBe('')
    await act(() => result.current.createBackendSessionForSend('use the Settings default'))
    const create = vi.mocked(requestGatewayForAgent).mock.calls.find(call => call[2] === 'session.create')?.[3]
    expect(create).not.toHaveProperty('model')
    expect(create).not.toHaveProperty('provider')
    expect(create).not.toHaveProperty('reasoning_effort')
    expect(state).toMatchObject({
      model: 'existing-manual-model',
      provider: 'existing-provider',
      reasoningEffort: 'high'
    })
  })

  it('creates an independent new tile from Settings without reusing the occupied conversation selection', async () => {
    const { result } = mountActions()
    setCurrentModel('existing-manual-model')
    setCurrentProvider('existing-provider')
    setCurrentReasoningEffort('high')
    markComposerSelectionManual()

    await act(() => result.current.openNewSessionTile('right'))

    const create = vi.mocked(requestGatewayForAgent).mock.calls.find(call => call[2] === 'session.create')?.[3]
    expect(create).not.toHaveProperty('model')
    expect(create).not.toHaveProperty('provider')
    expect(create).not.toHaveProperty('reasoning_effort')
    expect($currentModel.get()).toBe('existing-manual-model')
    expect($currentProvider.get()).toBe('existing-provider')
    expect($currentReasoningEffort.get()).toBe('high')
    expect(getCurrentModelSource()).toBe('manual')
  })

  it('does not resurrect an old destination pick when the selected default source finishes activating', async () => {
    const { result } = mountActions()
    const destination = { connectionId: 'chosen-host', profile: 'chosen' }
    setComposerSelectionOwner(destination.connectionId, destination.profile)
    setCurrentModel('destination-old-model')
    setCurrentProvider('destination-provider')
    markComposerSelectionManual()
    setComposerSelectionOwner('previous', 'other')
    setCurrentModel('existing-model')
    setCurrentProvider('existing-provider')
    markComposerSelectionManual()
    await act(() => setDefaultProfile(destination))

    act(() => result.current.selectSidebarItem({ action: 'new-session' } as never))
    // Mirrors ensureGatewayAgent's delayed activation publication.
    act(() => setComposerSelectionOwner(destination.connectionId, destination.profile))

    expect(getCurrentModelSource()).toBe('default')
    expect($currentModel.get()).toBe('')
    expect($currentProvider.get()).toBe('')
    await act(() => result.current.createBackendSessionForSend())
    const create = vi.mocked(requestGatewayForAgent).mock.calls.find(call => call[2] === 'session.create')?.[3]
    expect(create).not.toHaveProperty('model')
    expect(create).not.toHaveProperty('provider')
  })

  it('keeps an independent tile on its Settings default while the occupied conversation changes model', async () => {
    const { result } = mountActions()
    let complete!: (value: { provider: string; model: string }) => void

    const info = new Promise(resolve => {
      complete = resolve
    })

    const api = vi.fn(async () => info)
    window.hermesDesktop!.api = api as never
    setCurrentModel('existing-model')
    setCurrentProvider('existing-provider')
    markComposerSelectionManual()
    const pending = result.current.openNewSessionTile('right')
    await vi.waitFor(() => expect(api).toHaveBeenCalled())
    setCurrentModel('new-occupied-model')
    markComposerSelectionManual()

    await act(async () => {
      complete({ model: 'configured-model', provider: 'configured-provider' })
      await pending
    })

    const create = vi.mocked(requestGatewayForAgent).mock.calls.find(call => call[2] === 'session.create')?.[3]
    expect(create).toBeDefined()
    expect(create).not.toHaveProperty('model')
    expect(create).not.toHaveProperty('provider')
    expect($currentModel.get()).toBe('new-occupied-model')
  })

  it('keeps a fresh legacy-profile draft on Settings defaults when its descriptor arrives later', async () => {
    const { result } = mountActions()
    const previous = $connection.get()!
    const legacy = { ...previous, mode: 'local' as const, profile: 'personal', registryScoped: false }
    setConnection(legacy)
    setCurrentModel('old-local-manual-model')
    setCurrentProvider('old-local-provider')
    markComposerSelectionManual()
    setConnection(previous)
    await act(() => setDefaultProfile({ connectionId: null, profile: 'personal' }))
    act(() => result.current.selectSidebarItem({ action: 'new-session' } as never))

    act(() => {
      clearComposerSelectionOwner()
      setConnection(legacy)
    })

    expect(getCurrentModelSource()).toBe('default')
    expect($currentModel.get()).toBe('')
    expect($currentProvider.get()).toBe('')
  })

  it.each(
    [
      { name: 'primary window control', query: '/' },
      { name: 'peer inherited legacy route', query: '/?peer=1&profile=boot-profile&connectionId=' },
      { name: 'peer inherited local', query: '/?peer=1&profile=other&connectionId=local' },
      { name: 'peer inherited another remote', query: '/?peer=1&profile=other&connectionId=original-remote' }
    ].flatMap(source => ['draft', 'slash', 'tile'].map(action => ({ ...source, action })))
  )('preserves a later device selection for $action: $name', async ({ query, action }) => {
    // beforeEach establishes the state after selecting `previous`/`other`.
    // There is no saved app default; launch hints must not repin the draft.
    window.history.replaceState(null, '', query)
    const selected = { connectionId: 'previous', profile: 'other' }
    const { result } = mountActions()
    expect(resolveNewChatOwnerRoute()).toEqual(selected)

    if (action === 'tile') {
      await act(() => result.current.openNewSessionTile('right'))
    } else {
      if (action === 'slash') {
        const slash = mountSlashCommand(result.current.startFreshSessionDraft)

        await act(() => slash.result.current('/new'))
      } else {
        act(() => result.current.selectSidebarItem({ action: 'new-session' } as never))
      }

      await act(() => result.current.createBackendSessionForSend())
    }

    expect(requestGatewayForAgent).toHaveBeenCalledWith(
      selected.connectionId,
      selected.profile,
      'session.create',
      expect.objectContaining({ profile: selected.profile }),
      ...FOREGROUND_CREATE_DIAL
    )
    expect(getSessionOwnerHint('created-stored')).toEqual(selected)
  })

  it.each(['draft', 'tile'])('keeps a legacy default on the profile-only creation path for a %s', async action => {
    const { result, requestGateway } = mountActions()
    await act(() => setDefaultProfile({ connectionId: null, profile: 'personal' }))

    if (action === 'draft') {
      act(() => result.current.selectSidebarItem({ action: 'new-session' } as never))
      expect(resolveNewChatOwnerRoute()).toBeNull()
      await act(() => result.current.createBackendSessionForSend())
    } else {
      await act(() => result.current.openNewSessionTile('right'))
    }

    expect(ensureGatewayProfile).toHaveBeenCalledWith('personal', { forceLegacyRoute: true })
    expect(ensureGatewayAgent).not.toHaveBeenCalledWith('local', 'personal')
    expect(ensureGatewayAgent).not.toHaveBeenCalledWith('previous', 'personal')
    expect(requestGatewayForAgent).not.toHaveBeenCalled()
    expect(requestGateway).toHaveBeenCalledWith('session.create', expect.objectContaining({ profile: 'personal' }))
  })

  it('keeps a legacy profile peer separate from the app default and the active source', async () => {
    window.history.replaceState(null, '', '/?peer=1&profile=peer-agent&profileWindow=1')
    const { result, requestGateway } = mountActions()
    await act(() => setDefaultProfile({ connectionId: 'lab', profile: 'research' }))
    act(() => result.current.selectSidebarItem({ action: 'new-session' } as never))
    expect(resolveNewChatOwnerRoute()).toBeNull()
    await act(() => result.current.createBackendSessionForSend())
    expect(ensureGatewayProfile).toHaveBeenCalledWith('peer-agent', { forceLegacyRoute: true })
    expect(requestGatewayForAgent).not.toHaveBeenCalled()
    expect(requestGateway).toHaveBeenCalledWith('session.create', expect.objectContaining({ profile: 'peer-agent' }))
  })

  it('keeps an explicit legacy-profile tile request ahead of both defaults', async () => {
    const { result, requestGateway } = mountActions()
    await act(() => setDefaultProfile({ connectionId: 'lab', profile: 'research' }))
    await act(() => result.current.openNewSessionTile('right', { profile: 'chosen', route: null }))
    expect(requestGateway).toHaveBeenCalledWith('session.create', expect.objectContaining({ profile: 'chosen' }))
    expect(requestGatewayForAgent).not.toHaveBeenCalled()
  })

  it('does not mistake the configured default folder for explicit project routing', async () => {
    applyConfiguredDefaultProjectDir('/configured-default')
    const { result } = mountActions()
    await act(() => setDefaultProfile({ connectionId: 'lab', profile: 'research' }))
    act(() => result.current.selectSidebarItem({ action: 'new-session' } as never))
    expect($newChatRoute.get()).toEqual({ connectionId: 'lab', profile: 'research' })
    applyConfiguredDefaultProjectDir('')
  })

  it.each(['/', '/?peer=1&profile=opener&connectionId=opener-host'])(
    'routes /new to the saved default in %s',
    async query => {
      window.history.replaceState(null, '', query)
      const { result } = mountActions()
      const slash = mountSlashCommand(result.current.startFreshSessionDraft)

      await act(() => setDefaultProfile({ connectionId: 'lab', profile: 'research' }))
      await act(() => slash.result.current('/new'))
      expect($newChatRoute.get()).toEqual({ connectionId: 'lab', profile: 'research' })
    }
  )

  it('prefers a profile peer window over the app default after switching away', async () => {
    window.history.replaceState(null, '', '/?peer=1&profile=peer-agent&connectionId=peer-host&profileWindow=1')
    const { result } = mountActions()
    await act(() => setDefaultProfile({ connectionId: 'lab', profile: 'research' }))
    act(() => result.current.selectSidebarItem({ action: 'new-session' } as never))
    await act(() => result.current.createBackendSessionForSend())
    expect(requestGatewayForAgent).toHaveBeenCalledWith(
      'peer-host',
      'peer-agent',
      'session.create',
      expect.objectContaining({ profile: 'peer-agent' }),
      ...FOREGROUND_CREATE_DIAL
    )
  })

  it.each([
    { options: undefined, connectionId: 'lab', profile: 'research' },
    { options: { profile: 'chosen' }, connectionId: 'previous', profile: 'chosen' },
    {
      options: { route: { connectionId: 'chosen-host', profile: 'chosen' } },
      connectionId: 'chosen-host',
      profile: 'chosen'
    },
    { options: { cwd: '/clicked-project' }, connectionId: 'previous', profile: 'other' }
  ])(
    'routes tiles by explicit intent before the saved default: $profile',
    async ({ options, connectionId, profile }) => {
      const { result } = mountActions()
      await act(() => setDefaultProfile({ connectionId: 'lab', profile: 'research' }))
      await act(() => result.current.openNewSessionTile('right', options))
      expect(requestGatewayForAgent).toHaveBeenCalledWith(
        connectionId,
        profile,
        'session.create',
        expect.objectContaining({ profile }),
        ...FOREGROUND_CREATE_DIAL
      )
      expect(getSessionOwnerHint('created-stored')).toEqual({ connectionId, profile })
    }
  )

  it.each([
    { connectionId: 'lab', profile: 'research' },
    { connectionId: 'local', profile: 'personal' }
  ])('uses the saved exact owner only for a new draft: $connectionId/$profile', async saved => {
    const { result, requestGateway } = mountActions()
    await act(() => setDefaultProfile(saved))
    expect($activeSessionId.get()).toBe('existing-runtime')
    expect($newChatProfile.get()).toBe('other')

    act(() => result.current.selectSidebarItem({ action: 'new-session' } as never))
    await act(() => result.current.createBackendSessionForSend('hello'))

    const expected = saved
    expect(requestGatewayForAgent).toHaveBeenCalledWith(
      expected.connectionId,
      expected.profile,
      'session.create',
      expect.objectContaining({ profile: expected.profile }),
      ...FOREGROUND_CREATE_DIAL
    )
    expect(getSessionOwnerHint('created-stored')).toEqual(expected)
    expect($sessions.get().find(row => row.id === 'created-stored')).toMatchObject({
      connection_id: expected.connectionId,
      profile: expected.profile
    })
    expect(requestGateway).not.toHaveBeenCalled()
  })
})

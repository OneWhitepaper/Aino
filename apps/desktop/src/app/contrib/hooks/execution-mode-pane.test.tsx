import { useStore } from '@nanostores/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { openSession } from '@/app/open-session'
import { routeSessionId } from '@/app/routes'
import { Harness, type HarnessHandle } from '@/app/session/hooks/use-session-actions-harness'
import type { FreshSessionDraftOptions } from '@/app/session/hooks/use-session-actions/types'
import { ExecutionModeSwitcher } from '@/app/shell/execution-mode-switcher'
import { group, split } from '@/components/pane-shell/tree/model'
import { $layoutTree, noteActiveTreeGroup } from '@/components/pane-shell/tree/store'
import { setWorkspaceScope } from '@/components/pane-shell/workspace-scope'
import type * as HermesApi from '@/hermes'
import { getHermesConfigRecord } from '@/hermes'
import { createClientSessionState } from '@/lib/chat-runtime'
import { queryClient } from '@/lib/query-client'
import { freshDraftScope, rotateFreshDraftKey, stashSessionDraft, takeSessionDraft } from '@/store/composer'
import {
  $executionModeRequest,
  $executionModeScope,
  getDraftExecutionMode,
  getExecutionWorkspace,
  rememberExecutionWorkspace,
  rememberSessionExecutionMode,
  setDraftExecutionMode
} from '@/store/execution-mode'
import { $modeWorkspaces } from '@/store/execution-mode/workspaces'
import {
  $activeGatewayProfile,
  $newChatConnectionId,
  $newChatProfile,
  $newChatRoute,
  pinNewChatRoute
} from '@/store/profile'
import { $projectScope, ALL_PROJECTS } from '@/store/project-scope'
import {
  $activeSessionId,
  $freshDraftReady,
  $gatewayState,
  $selectedStoredSessionId,
  $sessionResumeRequest,
  $sessions,
  $workspaceCwdOwner,
  _resetSessionOwnerHintsForTests,
  setConnection,
  setRememberedRoute,
  setRememberedSessionId,
  setSessionOwnerHint
} from '@/store/session'
import { $focusedStoredSessionId } from '@/store/session-focus'
import type { SessionOwnerRoute } from '@/store/session-request-router'
import {
  $sessionStates,
  $sessionTiles,
  openSessionTile,
  patchSessionTile,
  publishSessionState
} from '@/store/session-states'
import { makeSessionInfo } from '@/test/session-info'
import type { HermesConfigRecord } from '@/types/hermes'

import { useFreshSessionRequest, useResumeLastSessionPreference } from '../wiring-effects'

import { useDesktopIntegrations } from './use-desktop-integrations'

vi.mock('@/hermes', async original => ({
  ...(await original<typeof HermesApi>()),
  getHermesConfigRecord: vi.fn()
}))

type StartFresh = (options?: boolean | FreshSessionDraftOptions) => void
const ownerA: SessionOwnerRoute = { connectionId: 'mode-pane-a', profile: 'default' }
const ownerB: SessionOwnerRoute = { connectionId: 'mode-pane-b', profile: 'coder', targetProfile: 'remote-coder' }
const rpc = vi.fn().mockRejectedValue(new Error('Unexpected network request'))
let navigate: ReturnType<typeof useNavigate>

interface StartupSettings {
  resumeLastSession: boolean | undefined
}

function DesktopRestore({ resumeLastSession }: StartupSettings) {
  const { pathname } = useLocation()
  const route = useNavigate()
  const sessions = useStore($sessions)
  const runtimes = useRef(new Map<string, string>())
  useDesktopIntegrations({
    activeProfile: 'default',
    chatOpen: true,
    hasPreview: false,
    locationPathname: pathname,
    navigate: route,
    profileReady: true,
    refreshSessions: () => undefined,
    resumeLastSession,
    resumeExhaustedSessionId: null,
    routedSessionId: routeSessionId(pathname),
    runtimeIdByStoredSessionId: runtimes,
    sessions,
    sessionsLoading: false
  })

  return null
}

function Listener({
  startFresh,
  desktop,
  resumeLastSession
}: StartupSettings & { startFresh: StartFresh; desktop: boolean }) {
  useFreshSessionRequest(startFresh, resumeLastSession)

  return (
    <>
      <ExecutionModeSwitcher />
      <output data-testid="route">{useLocation().pathname}</output>
      {desktop && <DesktopRestore resumeLastSession={resumeLastSession} />}
    </>
  )
}

function PaneHarness({ desktop, resumeLastSession }: StartupSettings & { desktop: boolean }) {
  navigate = useNavigate()
  const selected = useStore($selectedStoredSessionId)
  const active = useStore($activeSessionId)
  const actions = useRef<HarnessHandle | null>(null)
  const [ready, setReady] = useState(false)

  const onReady = useCallback((next: HarnessHandle) => {
    actions.current = next
    setReady(true)
  }, [])

  const startFresh = useCallback<StartFresh>(options => actions.current!.startFreshSessionDraft(options), [])

  return (
    <>
      <Harness
        activeSessionId={active}
        navigate={navigate as never}
        onReady={onReady}
        requestGateway={rpc}
        selectedStoredSessionId={selected}
      />
      {ready && <Listener desktop={desktop} resumeLastSession={resumeLastSession} startFresh={startFresh} />}
    </>
  )
}

async function mount(desktop = false, pathname = '/', startup: StartupSettings = { resumeLastSession: true }) {
  const content = (settings: StartupSettings) => (
    <MemoryRouter initialEntries={[pathname]}>
      <PaneHarness desktop={desktop} {...settings} />
    </MemoryRouter>
  )

  const view = render(content(startup))
  await act(async () => {})

  return async (resumeLastSession: boolean) => {
    view.rerender(content({ resumeLastSession }))
    await act(async () => {})
  }
}

function rememberCodeHistory() {
  const scope = $executionModeScope.get()
  setSessionOwnerHint('saved-code', ownerA)
  $sessions.set([
    makeSessionInfo({
      id: 'saved-code',
      connection_id: ownerA.connectionId,
      profile: ownerA.profile,
      execution_mode: 'code'
    })
  ])
  const previous = $modeWorkspaces.get()[scope]
  $modeWorkspaces.set({
    ...$modeWorkspaces.get(),
    [scope]: {
      ...previous,
      mode: 'code',
      filter: 'current',
      code: { sessionId: 'saved-code', projectScope: ALL_PROJECTS, draft: previous?.code?.draft ?? null }
    }
  })
}

async function choose(mode: 'Work' | 'Code') {
  fireEvent.keyDown(screen.getByRole('button', { name: /^Switch Aino mode:/ }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: new RegExp(`^Aino ${mode}`) }))
  await act(async () => {})
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
})
beforeEach(() => {
  localStorage.clear()
  $modeWorkspaces.set({})
  $executionModeRequest.set(null)
  $sessionTiles.set([])
  $sessionStates.set({})
  _resetSessionOwnerHintsForTests()
  $newChatRoute.set(null)
  $newChatProfile.set(null)
  $newChatConnectionId.set(null)
  $activeGatewayProfile.set('default')
  setConnection({ mode: 'local', ...ownerA, registryScoped: true } as never)
  $selectedStoredSessionId.set(null)
  $activeSessionId.set(null)
  $sessionResumeRequest.set(null)
  $workspaceCwdOwner.set(null)
  $freshDraftReady.set(true)
  $gatewayState.set('open')
  $sessions.set([])
  $projectScope.set(ALL_PROJECTS)
  setWorkspaceScope('sessions')
  $layoutTree.set(group(['workspace'], { id: 'main', active: 'workspace' }))
  noteActiveTreeGroup(null)
  setDraftExecutionMode('work')
  rpc.mockClear()
})
afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.mocked(getHermesConfigRecord).mockReset()
  $sessionTiles.set([])
  $sessionStates.set({})
  $layoutTree.set(null)
  noteActiveTreeGroup(null)
})

it('restores B history on B, not the pinned A draft owner, after Work → Code', async () => {
  pinNewChatRoute(ownerA)
  await mount()
  const scopeA = $executionModeScope.get()
  const draftA = freshDraftScope()
  await act(async () => {
    stashSessionDraft(draftA, 'A private draft', [])
    setSessionOwnerHint('b-code', ownerB)
    $sessions.set([
      makeSessionInfo({
        id: 'b-code',
        connection_id: ownerB.connectionId,
        profile: ownerB.profile,
        execution_mode: 'code'
      })
    ])
    setConnection({ mode: 'remote', ...ownerB, baseUrl: 'http://owner-b.invalid', registryScoped: true } as never)
    $selectedStoredSessionId.set('b-code')
    $workspaceCwdOwner.set('b-code')
    openSession('b-code', navigate, 'main')
    rememberSessionExecutionMode('b-code', 'code')
  })
  await choose('Work')
  await choose('Code')
  expect($sessionResumeRequest.get()).toMatchObject({ sessionId: 'b-code', ownerRoute: ownerB })
  expect(getExecutionWorkspace('code', scopeA)?.sessionId ?? null).toBeNull()
  expect(getExecutionWorkspace('work', scopeA)?.draft?.key).toBe(draftA)
  expect(takeSessionDraft(draftA).text).toBe('A private draft')
  expect(rpc).not.toHaveBeenCalled()
})

it('switches a foreground Code tile to the existing primary Work draft and keeps its running runtime', async () => {
  await mount()
  const workKey = freshDraftScope()
  await act(async () => {
    stashSessionDraft(workKey, 'Work survives foreground tiles', [])
    openSessionTile('tile-code', 'right', 'workspace', undefined, { workspaceMode: 'sessions', ownerRoute: ownerA })
    patchSessionTile('tile-code', { runtimeId: 'rt-code' })
    publishSessionState('rt-code', { ...createClientSessionState('tile-code'), executionMode: 'code', busy: true })
    $layoutTree.set(
      split('row', [
        group(['workspace'], { id: 'main', active: 'workspace' }),
        group(['session-tile:tile-code'], { id: 'code-pane', active: 'session-tile:tile-code' })
      ])
    )
    noteActiveTreeGroup('code-pane')
  })
  expect($focusedStoredSessionId.get()).toBe('tile-code')
  expect(getDraftExecutionMode()).toBe('work')
  await choose('Work')
  expect($focusedStoredSessionId.get()).toBeNull()
  expect(getDraftExecutionMode()).toBe('work')
  expect(freshDraftScope()).toBe(workKey)
  expect(getExecutionWorkspace('code')?.sessionId).toBe('tile-code')
  expect($sessionStates.get()['rt-code'].busy).toBe(true)
  expect($sessionTiles.get().some(tile => tile.storedSessionId === 'tile-code')).toBe(true)
  expect(takeSessionDraft(workKey).text).toBe('Work survives foreground tiles')
  await choose('Code')
  expect($focusedStoredSessionId.get()).toBe('tile-code')
  expect($selectedStoredSessionId.get()).toBeNull()
  expect(getDraftExecutionMode()).toBe('work')
  expect($sessionTiles.get().find(tile => tile.storedSessionId === 'tile-code')?.runtimeId).toBe('rt-code')
  await choose('Work')
  await act(async () => publishSessionState('rt-code', { ...$sessionStates.get()['rt-code'], needsInput: true }))
  expect($focusedStoredSessionId.get()).toBeNull()
  expect(screen.getByRole('button', { name: 'Switch Aino mode: Aino Work' })).toBeTruthy()
  expect(freshDraftScope()).toBe(workKey)
  expect(rpc).not.toHaveBeenCalled()
})

it('keeps the Work draft on reload when real desktop navigation still remembers an older Code session', async () => {
  await mount()
  const key = freshDraftScope()
  await act(async () => {
    stashSessionDraft(key, 'AINO_UI_WORK_DRAFT_no_model_send', [])
    rememberExecutionWorkspace()
  })

  const oldCode = makeSessionInfo({
    id: 'old-code',
    profile: 'default',
    connection_id: ownerA.connectionId,
    execution_mode: 'code'
  })

  await act(async () => {
    $sessions.set([oldCode])
    setRememberedSessionId('old-code', 'default')
    setRememberedRoute('/', 'default')
  })
  cleanup()
  await mount(true)
  await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/'))
  expect(getDraftExecutionMode()).toBe('work')
  expect(freshDraftScope()).toBe(key)
  expect(takeSessionDraft(key).text).toBe('AINO_UI_WORK_DRAFT_no_model_send')
})

it('still honors legacy startup history when no mode workspace existed at mount', async () => {
  $sessions.set([
    makeSessionInfo({
      id: 'legacy-code',
      profile: 'default',
      connection_id: ownerA.connectionId,
      execution_mode: 'code'
    })
  ])
  setRememberedSessionId('legacy-code', 'default')
  setRememberedRoute('/', 'default')
  await mount(true)
  expect(screen.getByTestId('route').textContent).toBe('/legacy-code')
})

it('does not replace an explicit session URL with a remembered mode draft', async () => {
  await mount()
  rememberExecutionWorkspace()
  cleanup()
  await mount(true, '/explicit-code')
  expect(screen.getByTestId('route').textContent).toBe('/explicit-code')
})

it.each(['/capabilities', '/settings'])(
  'leaves explicit %s open without overwriting the saved draft on remount',
  async pathname => {
    await mount()
    const key = freshDraftScope()
    stashSessionDraft(key, 'Saved Work on a page', [])
    rememberExecutionWorkspace()
    cleanup()
    rotateFreshDraftKey()
    const saved = getExecutionWorkspace('work')
    await mount(true, pathname)
    expect(screen.getByTestId('route').textContent).toBe(pathname)
    expect(getExecutionWorkspace('work')).toEqual(saved)
    expect(takeSessionDraft(key).text).toBe('Saved Work on a page')
    await act(async () => navigate('/'))
    expect(freshDraftScope()).toBe(key)
    expect(screen.getByTestId('route').textContent).toBe('/')
  }
)

it('does not resume saved mode history when startup history is disabled', async () => {
  rememberCodeHistory()
  await mount(true, '/', { resumeLastSession: false })
  expect(screen.getByTestId('route').textContent).toBe('/')
  expect($sessionResumeRequest.get()).toBeNull()
  expect($selectedStoredSessionId.get()).toBeNull()
  expect(getDraftExecutionMode()).toBe('code')
  expect(rpc).not.toHaveBeenCalled()
})

it.each([false, true])('waits for startup config before applying resumeLastSession=%s', async resumeLastSession => {
  rememberCodeHistory()
  const saved = getExecutionWorkspace('code')
  const resolveConfig = await mount(true, '/', { resumeLastSession: undefined })
  expect(screen.getByTestId('route').textContent).toBe('/')
  expect($sessionResumeRequest.get()).toBeNull()
  expect(getExecutionWorkspace('code')).toEqual(saved)
  await resolveConfig(resumeLastSession)
  expect(screen.getByTestId('route').textContent).toBe(resumeLastSession ? '/saved-code' : '/')
  expect($sessionResumeRequest.get()?.sessionId ?? null).toBe(resumeLastSession ? 'saved-code' : null)
})

it('restores unsent mode draft content even when startup history is disabled', async () => {
  await mount()
  await choose('Code')
  const key = freshDraftScope()
  stashSessionDraft(key, 'Unsent Code draft', [{ id: 'draft-file', kind: 'file', label: 'Draft', path: '/draft.txt' }])
  rememberExecutionWorkspace()
  cleanup()
  rememberCodeHistory()
  rotateFreshDraftKey()
  await mount(true, '/', { resumeLastSession: false })
  expect(screen.getByTestId('route').textContent).toBe('/')
  expect($sessionResumeRequest.get()).toBeNull()
  expect(freshDraftScope()).toBe(key)
  expect(takeSessionDraft(key)).toMatchObject({ text: 'Unsent Code draft', attachments: [{ id: 'draft-file' }] })
  expect(getDraftExecutionMode()).toBe('code')
})

it('allows an explicit mode switch from a page to saved history even when startup history is disabled', async () => {
  await mount()
  cleanup()
  rememberCodeHistory()
  setDraftExecutionMode('work')
  await mount(true, '/capabilities', { resumeLastSession: false })
  expect(screen.getByTestId('route').textContent).toBe('/capabilities')
  await choose('Code')
  expect(screen.getByTestId('route').textContent).toBe('/saved-code')
  expect($sessionResumeRequest.get()).toMatchObject({ sessionId: 'saved-code', ownerRoute: ownerA })
  expect(rpc).not.toHaveBeenCalled()
})

it('shares the real config-record loading and disabled preference with both startup restorers', async () => {
  let resolveConfig!: (config: HermesConfigRecord) => void
  vi.mocked(getHermesConfigRecord).mockReturnValueOnce(
    new Promise(resolve => {
      resolveConfig = resolve
    })
  )
  rememberCodeHistory()
  const saved = getExecutionWorkspace('code')

  function ConfiguredPane() {
    const resumeLastSession = useResumeLastSessionPreference()

    return <PaneHarness desktop resumeLastSession={resumeLastSession} />
  }

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <ConfiguredPane />
      </MemoryRouter>
    </QueryClientProvider>
  )
  await act(async () => {})
  expect(screen.getByTestId('route').textContent).toBe('/')
  expect($sessionResumeRequest.get()).toBeNull()
  expect(getExecutionWorkspace('code')).toEqual(saved)
  await act(async () => resolveConfig({ display: { resume_last_session: false } }))
  await waitFor(() => expect(getExecutionWorkspace('code')?.sessionId).toBeNull())
  expect(screen.getByTestId('route').textContent).toBe('/')
  expect($sessionResumeRequest.get()).toBeNull()
  expect(getDraftExecutionMode()).toBe('code')
})

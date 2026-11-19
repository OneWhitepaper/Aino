import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WritableAtom } from 'nanostores'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { Harness, type HarnessHandle } from '@/app/session/hooks/use-session-actions-harness'
import { ExecutionModeSwitcher } from '@/app/shell/execution-mode-switcher'
import { announceGoneSessionDraft, freshDraftScope, stashSessionDraft, takeSessionDraft } from '@/store/composer'
import { getComposerModelSelection } from '@/store/composer-model-selection'
import {
  $executionModeRequest,
  getDraftExecutionMode,
  getExecutionWorkspace,
  rememberSessionExecutionMode,
  requestExecutionMode,
  setDraftExecutionMode
} from '@/store/execution-mode'
import { $activeGatewayProfile, $newChatProfile, $newChatRoute } from '@/store/profile'
import { $projectScope, ALL_PROJECTS } from '@/store/project-scope'
import {
  $currentCwd,
  $currentCwdExplicit,
  $freshDraftReady,
  $gatewayState,
  $newChatWorkspaceTarget,
  $selectedStoredSessionId,
  $sessionResumeRequest,
  $sessions,
  $workspaceCwdOwner,
  setConnection,
  setCurrentModel,
  setCurrentModelSource,
  setCurrentProvider,
  setNewChatWorkspaceTarget
} from '@/store/session'
import { $removedSessionIds, tombstoneSessions } from '@/store/session-removal'
import { $sessionStates } from '@/store/session-states'
import { makeSessionInfo } from '@/test/session-info'

import type { PlatformAccountSnapshot } from '../../../../shared/platform-contract'
import { useFreshSessionRequest } from '../wiring-effects'

let actions: HarnessHandle
const rpc = vi.fn().mockRejectedValue(new Error('Unexpected network request'))

function Listener() {
  useFreshSessionRequest(actions.startFreshSessionDraft, true)

  return <output>{useLocation().pathname}</output>
}

async function mount(navigate = vi.fn()) {
  render(
    <Harness
      navigate={navigate}
      onReady={next => {
        actions = next
      }}
      requestGateway={rpc}
    />
  )
  render(
    <MemoryRouter initialEntries={['/']}>
      <Listener />
    </MemoryRouter>
  )
  await act(async () => {})
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.scrollIntoView ??= () => undefined
})

beforeEach(() => {
  localStorage.clear()
  announceGoneSessionDraft(null)
  $executionModeRequest.set(null)
  $newChatProfile.set(null)
  $newChatRoute.set(null)
  $activeGatewayProfile.set('default')
  setConnection({
    mode: 'local',
    connectionId: `hook-${crypto.randomUUID()}`,
    profile: 'default',
    registryScoped: true
  } as never)
  $selectedStoredSessionId.set(null)
  $workspaceCwdOwner.set(null)
  $freshDraftReady.set(true)
  $gatewayState.set('open')
  $sessions.set([])
  $projectScope.set(ALL_PROJECTS)
  $removedSessionIds.set(new Set())
  setDraftExecutionMode('work')
  rpc.mockClear()
})
afterEach(cleanup)

it('restores two fresh workspaces through the real fresh-session lifecycle without clearing stashed attachments', async () => {
  await mount()
  const workKey = freshDraftScope()
  await act(async () => {
    setCurrentModel('writer')
    setCurrentProvider('custom:writer')
    setCurrentModelSource('manual')
    setNewChatWorkspaceTarget(null)
    stashSessionDraft(workKey, 'Report draft', [{ id: 'report', kind: 'file', label: 'Report', path: '/report.txt' }])
  })
  await act(async () => requestExecutionMode('code'))
  expect(freshDraftScope()).not.toBe(workKey)
  const codeKey = freshDraftScope()
  await act(async () => {
    $projectScope.set('p_code')
    $currentCwd.set('/repo')
    $currentCwdExplicit.set(true)
    setNewChatWorkspaceTarget('/repo')
    setCurrentModel('coder')
    setCurrentProvider('custom:coder')
    setCurrentModelSource('manual')
    stashSessionDraft(codeKey, 'Patch draft', [])
  })
  await act(async () => requestExecutionMode('work'))
  expect(freshDraftScope()).toBe(workKey)
  expect(takeSessionDraft(freshDraftScope())).toMatchObject({ text: 'Report draft', attachments: [{ id: 'report' }] })
  expect(getComposerModelSelection()).toEqual({ model: 'writer', provider: 'custom:writer', source: 'manual' })
  expect($newChatWorkspaceTarget.get()).toBeNull()
  await act(async () => requestExecutionMode('code'))
  expect(freshDraftScope()).toBe(codeKey)
  expect(takeSessionDraft(freshDraftScope()).text).toBe('Patch draft')
  expect($currentCwd.get()).toBe('/repo')
  expect($currentCwdExplicit.get()).toBe(true)
  expect($projectScope.get()).toBe('p_code')
  expect(getComposerModelSelection().model).toBe('coder')
  expect(rpc).not.toHaveBeenCalled()
})

it('restores saved history via its captured owner while background work keeps running; deleted targets recover to the mode draft', async () => {
  await mount()
  const workKey = freshDraftScope()
  await act(async () => requestExecutionMode('code'))
  const codeKey = freshDraftScope()
  await act(async () => {
    $sessions.set([makeSessionInfo({ id: 'code-chat', execution_mode: 'code' })])
    $selectedStoredSessionId.set('code-chat')
    $workspaceCwdOwner.set('code-chat')
    $sessionStates.set({ running: { busy: true, storedSessionId: 'code-chat' } } as never)
  })
  await act(async () => requestExecutionMode('work'))
  expect(freshDraftScope()).toBe(workKey)
  expect($sessionStates.get().running.busy).toBe(true)
  await act(async () => requestExecutionMode('code'))
  expect($sessionResumeRequest.get()).toMatchObject({ sessionId: 'code-chat', ownerRoute: { profile: 'default' } })
  await act(async () => {
    $selectedStoredSessionId.set('code-chat')
    tombstoneSessions(['code-chat'])
    requestExecutionMode('work')
  })
  await act(async () => requestExecutionMode('code'))
  expect($selectedStoredSessionId.get()).toBeNull()
  expect(freshDraftScope()).toBe(codeKey)
  expect(getDraftExecutionMode()).toBe('code')
  expect(rpc).not.toHaveBeenCalled()
})

it('recovers persisted mode draft on a remount', async () => {
  await mount()
  await act(async () => requestExecutionMode('code'))
  const key = freshDraftScope()
  await act(async () => {
    setCurrentModel('restore-me')
    setCurrentProvider('custom:coder')
    setCurrentModelSource('manual')
    stashSessionDraft(key, 'Reload draft', [])
  })
  expect(getExecutionWorkspace('code')?.draft?.model.model).toBe('restore-me')
  cleanup()
  setCurrentModel('')
  setCurrentProvider('')
  expect($selectedStoredSessionId.get()).toBeNull()
  expect($gatewayState.get()).toBe('open')
  await mount()
  await waitFor(() => expect(getComposerModelSelection().model).toBe('restore-me'))
  expect(getDraftExecutionMode()).toBe('code')
  expect(takeSessionDraft(freshDraftScope()).text).toBe('Reload draft')
})

it('switches account ownership without adopting the outgoing draft or selected history', async () => {
  const { platformModelCatalog } = await import('@/store/platform-models')

  const account = platformModelCatalog().account as WritableAtom<PlatformAccountSnapshot | null>

  account.set({ mode: 'production', account: { id: 'owner-a' } } as never)
  await mount()
  const key = freshDraftScope()
  await act(async () => {
    setCurrentModel('account-a-model')
    setCurrentProvider('custom:a')
    setCurrentModelSource('manual')
    stashSessionDraft(key, 'Private draft A', [])
  })
  await act(async () => account.set({ mode: 'production', account: { id: 'owner-b' } } as never))
  expect(freshDraftScope()).not.toBe(key)
  expect(getComposerModelSelection().model).toBe('')
  expect(takeSessionDraft(freshDraftScope()).text).toBe('')
  await act(async () => account.set({ mode: 'production', account: { id: 'owner-a' } } as never))
  expect(freshDraftScope()).toBe(key)
  expect(getComposerModelSelection().model).toBe('account-a-model')
  await act(async () => {
    $sessions.set([makeSessionInfo({ id: 'account-a-session', execution_mode: 'code' })])
    $selectedStoredSessionId.set('account-a-session')
  })
  await act(async () => account.set({ mode: 'production', account: { id: 'owner-b' } } as never))
  expect($selectedStoredSessionId.get()).toBeNull()
  account.set(null)
})

it('keeps the restored mode while its saved session is outside the loaded history page', async () => {
  await mount()
  await act(async () => requestExecutionMode('code'))
  await act(async () => {
    $sessions.set([makeSessionInfo({ id: 'outside-page', execution_mode: 'code' })])
    $selectedStoredSessionId.set('outside-page')
    $workspaceCwdOwner.set('outside-page')
  })
  await act(async () => requestExecutionMode('work'))
  await act(async () => $sessions.set([]))
  await act(async () => requestExecutionMode('code'))
  await act(async () => $selectedStoredSessionId.set('outside-page'))
  expect(getDraftExecutionMode()).toBe('code')
})

it('uses the mode draft only after authoritative missing-history recovery, never while resume is pending', async () => {
  await mount()
  await act(async () => requestExecutionMode('code'))
  const codeKey = freshDraftScope()
  await act(async () => {
    setCurrentModel('code-draft-model')
    setCurrentProvider('custom:code')
    setCurrentModelSource('manual')
  })
  await act(async () => {
    $sessions.set([makeSessionInfo({ id: 'missing-code', execution_mode: 'code' })])
    $selectedStoredSessionId.set('missing-code')
    $workspaceCwdOwner.set('missing-code')
  })
  await act(async () => requestExecutionMode('work'))
  const workKey = freshDraftScope()
  await act(async () => requestExecutionMode('code'))
  // Navigation has been requested; the route resume still owns resolution.
  expect(freshDraftScope()).toBe(workKey)
  await act(async () => $selectedStoredSessionId.set('missing-code'))
  const { announceGoneSessionDraft } = await import('@/store/composer')
  await act(async () => {
    announceGoneSessionDraft('missing-code')
    actions.startFreshSessionDraft(true)
  })
  expect(freshDraftScope()).toBe(codeKey)
  expect(getComposerModelSelection().model).toBe('code-draft-model')
})

it('discards a mode request from the previous account so the new owner keeps recording its workspace', async () => {
  const { platformModelCatalog } = await import('@/store/platform-models')
  const account = platformModelCatalog().account as WritableAtom<PlatformAccountSnapshot | null>
  account.set({ mode: 'production', account: { id: 'pending-owner-a' } } as never)
  await mount()
  await act(async () => {
    requestExecutionMode('code')
    account.set({ mode: 'production', account: { id: 'pending-owner-b' } } as never)
  })
  await act(async () => {
    setCurrentModel('new-owner-model')
    setCurrentProvider('custom:new-owner')
    setCurrentModelSource('manual')
  })
  expect(getExecutionWorkspace('work')?.draft?.model.model).toBe('new-owner-model')
  expect($executionModeRequest.get()).toBeNull()
  cleanup()
  account.set(null)
})

it('leaves a Code session for the Work draft even when its mode arrives after selection', async () => {
  const navigate = vi.fn()
  await mount(navigate)
  const workDraft = freshDraftScope()
  await act(async () => {
    $selectedStoredSessionId.set('code-before-metadata')
    $workspaceCwdOwner.set('code-before-metadata')
  })
  await act(async () => {
    $sessions.set([makeSessionInfo({ id: 'code-before-metadata', execution_mode: 'code' })])
    rememberSessionExecutionMode('code-before-metadata', 'code')
  })
  navigate.mockClear()
  render(<ExecutionModeSwitcher />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Switch Aino mode: Aino Code' }), { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitemradio', { name: /^Aino Work/ }))
  await waitFor(() => expect($selectedStoredSessionId.get()).toBeNull())
  expect(screen.getByRole('button', { name: 'Switch Aino mode: Aino Work' })).toBeTruthy()
  expect(getDraftExecutionMode()).toBe('work')
  expect(freshDraftScope()).toBe(workDraft)
  expect(navigate).toHaveBeenCalledWith('/', { replace: false })
  expect(rpc).not.toHaveBeenCalled()
})

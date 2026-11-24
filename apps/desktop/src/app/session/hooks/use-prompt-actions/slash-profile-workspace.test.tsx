import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { WritableAtom } from 'nanostores'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useFreshSessionRequest } from '@/app/contrib/wiring-effects'
import {
  type HarnessHandle as SessionActionsHandle,
  Harness as SessionActionsHarness
} from '@/app/session/hooks/use-session-actions-harness'
import { $executionModeRequest, requestExecutionMode, setDraftExecutionMode } from '@/store/execution-mode'
import { $notifications } from '@/store/notifications'
import { platformModelCatalog } from '@/store/platform-models'
import {
  $activeGatewayProfile,
  $newChatProfile,
  $newChatRoute,
  captureNewChatSource,
  currentNewChatIntent,
  pinNewChatProfile,
  resolveNewChatOwnerRoute
} from '@/store/profile'
import { $freshDraftReady, $gatewayState, $selectedStoredSessionId, setConnection } from '@/store/session'

import { Harness, type HarnessHandle } from './index-test-utils'

const fixture = vi.hoisted(() => ({ activate: vi.fn<() => Promise<void>>() }))
vi.mock('@/hermes', () => ({
  getLatestSessionMessages: vi.fn(async () => ({ messages: [], session_id: 'session' })),
  getProfiles: vi.fn(async () => ({ profiles: [{ name: 'alpha' }, { name: 'beta' }] })),
  getHermesConfig: vi.fn(async () => ({ display: { timestamps: false } })),
  getHermesConfigDefaults: vi.fn(async () => ({})),
  getSession: vi.fn(),
  PROMPT_SUBMIT_REQUEST_TIMEOUT_MS: 1_800_000,
  setApiRequestProfile: vi.fn(),
  transcribeAudio: vi.fn()
}))
// The fixture transport serves this exact registry source; no native socket is opened.
vi.mock('@/store/gateway', async original => ({
  ...(await original<Record<string, unknown>>()),
  activeGatewayConnectionId: () => 'local'
}))
vi.mock('@/store/profile', async original => ({
  ...(await original<Record<string, unknown>>()),
  ensureGatewayProfile: fixture.activate
}))

let sessionActions: SessionActionsHandle

function WorkspaceLifecycle() {
  useFreshSessionRequest(sessionActions.startFreshSessionDraft, false)

  return null
}

beforeEach(() => {
  localStorage.clear()
  $executionModeRequest.set(null)
  $newChatProfile.set(null)
  $newChatRoute.set(null)
  captureNewChatSource('local')
  $activeGatewayProfile.set('default')
  setConnection({ mode: 'local', connectionId: 'local', profile: 'default', registryScoped: true } as never)
  $selectedStoredSessionId.set(null)
  $freshDraftReady.set(true)
  $gatewayState.set('open')
  setDraftExecutionMode('work')
  $notifications.set([])
  fixture.activate.mockReset()
})

afterEach(() => {
  cleanup()
  $newChatProfile.set(null)
  $newChatRoute.set(null)
  captureNewChatSource(null)
  $notifications.set([])
  setConnection(null)
  ;(platformModelCatalog().account as WritableAtom<unknown>).set(null)
})

async function mount() {
  let handle: HarnessHandle | undefined
  const requestGateway = vi.fn(async () => ({}) as never)
  render(
    <SessionActionsHarness
      onReady={actions => {
        sessionActions = actions
      }}
      requestGateway={requestGateway}
    />
  )
  render(
    <MemoryRouter>
      <WorkspaceLifecycle />
    </MemoryRouter>
  )
  render(
    <Harness
      activeSessionId={null}
      onReady={actions => {
        handle = actions
      }}
      refreshSessions={async () => undefined}
      requestGateway={requestGateway}
      storedSessionId={null}
    />
  )
  await act(async () => {})

  return handle!
}

it('completes a profile slash after its own automatic Work/Code draft restoration without losing exact owner intent', async () => {
  const activation = Promise.withResolvers<void>()
  fixture.activate.mockReturnValue(activation.promise)
  const prompt = await mount()
  let slash: Promise<boolean>
  await act(async () => {
    slash = prompt.submitTextRaw('/profile alpha')
  })
  await waitFor(() => expect(fixture.activate).toHaveBeenCalledWith('alpha'))
  const selectedIntent = currentNewChatIntent()
  await act(async () => {
    setConnection({ mode: 'local', connectionId: 'local', profile: 'alpha', registryScoped: true } as never)
    $activeGatewayProfile.set('alpha')
    activation.resolve()
    await slash!
  })
  expect($newChatProfile.get()).toBe('alpha')
  expect(resolveNewChatOwnerRoute()).toEqual({ connectionId: 'local', profile: 'alpha' })
  expect($notifications.get().map(item => item.message)).toContain('New chats will use bot alpha.')
  // Only successful source capture advances the already-selected intent.
  expect(currentNewChatIntent()).toBe(selectedIntent + 1)
})

it('still suppresses an older slash completion when a newer same-owner draft is explicitly requested', async () => {
  const activation = Promise.withResolvers<void>()
  fixture.activate.mockReturnValue(activation.promise)
  const prompt = await mount()
  let slash: Promise<boolean>
  await act(async () => {
    slash = prompt.submitTextRaw('/profile alpha')
  })
  await waitFor(() => expect(fixture.activate).toHaveBeenCalledWith('alpha'))
  await act(async () => {
    pinNewChatProfile('alpha')
    sessionActions.startFreshSessionDraft()
  })
  const newerIntent = currentNewChatIntent()
  await act(async () => {
    activation.resolve()
    await slash!
  })
  expect(currentNewChatIntent()).toBe(newerIntent)
  expect($notifications.get().map(item => item.message)).not.toContain('New chats will use bot alpha.')
})

it('reports a profile activation error even after automatic workspace restoration', async () => {
  const activation = Promise.withResolvers<void>()
  fixture.activate.mockReturnValue(activation.promise)
  const prompt = await mount()
  let slash: Promise<boolean>
  await act(async () => {
    slash = prompt.submitTextRaw('/profile alpha')
  })
  await waitFor(() => expect(fixture.activate).toHaveBeenCalledWith('alpha'))
  await act(async () => {
    activation.reject(new Error('Target gateway unavailable'))
    await slash!
  })
  expect(
    $notifications.get().some(item => item.kind === 'error' && item.message?.includes('Target gateway unavailable'))
  ).toBe(true)
  expect($notifications.get().map(item => item.message)).not.toContain('New chats will use bot alpha.')
})

it.each(['mode', 'account'] as const)('does not revive an old slash after an explicit %s change', async change => {
  const account = platformModelCatalog().account as WritableAtom<unknown>
  account.set({ mode: 'production', account: { id: 'a' } })
  const activation = Promise.withResolvers<void>()
  fixture.activate.mockReturnValue(activation.promise)
  const prompt = await mount()
  let slash: Promise<boolean>
  await act(async () => {
    slash = prompt.submitTextRaw('/profile alpha')
  })
  await waitFor(() => expect(fixture.activate).toHaveBeenCalledWith('alpha'))
  await act(async () => {
    if (change === 'mode') {
      requestExecutionMode('code')
    } else {
      account.set({ mode: 'production', account: { id: 'b' } })
    }
  })
  const newerIntent = currentNewChatIntent()
  await act(async () => {
    activation.resolve()
    await slash!
  })
  expect(currentNewChatIntent()).toBe(newerIntent)
  expect($notifications.get().map(item => item.message)).not.toContain('New chats will use bot alpha.')
})

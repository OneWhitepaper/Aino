import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { platformAccountActions } from '@/api/platform'
import { getGlobalModelInfo, type SessionCreateResponse } from '@/hermes'
import { $composerAttachments, $composerDraft } from '@/store/composer'
import { requestGatewayForAgent, retainGatewayForAgent } from '@/store/gateway'
import {
  clearGatewayManagedCapabilities,
  recordGatewayReadyCapability,
  resetGatewayManagedCapability
} from '@/store/gateway-managed-capability'
import { $notifications, clearNotifications } from '@/store/notifications'
import { platformModelCatalog } from '@/store/platform-models'
import {
  $activeGatewayProfile,
  $newChatProfile,
  $newChatRoute,
  ensureGatewayAgent,
  ensureGatewayProfile
} from '@/store/profile'
import { $projectScope, ALL_PROJECTS } from '@/store/project-scope'
import { $projectTree } from '@/store/projects'
import {
  $activeSessionId,
  $currentCwd,
  $currentFastMode,
  $currentModel,
  $currentPlatformOrigin,
  $currentPlatformOwner,
  $currentProvider,
  $currentReasoningEffort,
  $modelPickerOpen,
  $selectedStoredSessionId,
  getCurrentModelSource,
  setAwaitingResponse,
  setBusy,
  setComposerSelectionOwner,
  setCurrentCwd,
  setCurrentFastMode,
  setCurrentModel,
  setCurrentModelSource,
  setCurrentPlatformOwner,
  setCurrentProvider,
  setCurrentReasoningEffort,
  setCurrentServiceTier,
  setNewChatWorkspaceTarget
} from '@/store/session'
import { platformModel, platformSnapshot } from '@/test/platform-model'

import type { PlatformAccountBridge, PlatformAccountSnapshot } from '../../../../shared/platform-contract'
import { deferred } from '../../../test/deferred'

import { useModelControls } from './use-model-controls'
import { createWith } from './use-session-actions-create-harness'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  getAllSessionMessages: vi.fn(),
  getGlobalModelInfo: vi.fn(),
  getLatestSessionMessages: vi.fn(),
  listAllProfileSessions: vi.fn(),
  setApiRequestProfile: vi.fn(),
  setSessionArchived: vi.fn()
}))

vi.mock('@/store/profile', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ensureGatewayAgent: vi.fn().mockResolvedValue(undefined),
  ensureGatewayProfile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/store/gateway', async importOriginal => {
  const original = await importOriginal<Record<string, unknown>>()

  return {
    ...original,
    // Default-preserving spy: tests that route by the active source override it.
    activeGatewayConnectionId: vi.fn(original.activeGatewayConnectionId as () => null | string),
    requestGatewayForAgent: vi.fn(),
    requestGatewayForProfile: vi.fn(),
    retainGatewayForAgent: vi.fn(async () => () => undefined)
  }
})

vi.mock('@/components/pane-shell/tree/store', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  noteActiveTreeGroup: vi.fn(),
  revealTreePane: vi.fn()
}))

const RUNTIME_SESSION_ID = 'rt-new-001'

beforeEach(() => {
  vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: 'backend-default', provider: 'backend-provider' })
})
import { FirstSendHarness, Harness, type HarnessHandle, routeManagedDraftRequests } from './use-session-actions-harness'

describe('createBackendSessionForSend profile routing', () => {
  async function prepareDeferredManagedCreate() {
    let account: PlatformAccountSnapshot = { ...platformSnapshot(), mode: 'development' }
    let broadcast!: (next: PlatformAccountSnapshot) => void
    const create = deferred<SessionCreateResponse>()
    const bind = vi.fn()
    const clear = vi.fn()

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.create') {
        return create.promise as never
      }

      if (method === 'session.close') {
        return {} as never
      }

      if (method === 'session.managed_model_ticket') {
        throw new Error('must not mint a ticket for the newer authority')
      }

      if (method === 'prompt.submit') {
        throw new Error('must not submit after authority changes')
      }

      throw new Error(`unexpected request: ${method}`)
    })

    const accountBridge: PlatformAccountBridge = {
      status: async () => account,
      capabilities: vi.fn(),
      retry: async () => account,
      requestPhoneCode: vi.fn(),
      verifyPhoneCode: vi.fn(),
      loginExisting: vi.fn(),
      completeSecondFactor: vi.fn(),
      updateProfile: vi.fn(),
      requestBindingCode: vi.fn(),
      submitStepUp: vi.fn(),
      bindPhone: vi.fn(),
      logout: vi.fn(),
      onChanged: listener => {
        broadcast = listener

        return () => undefined
      }
    }

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: accountBridge,
        platformModels: {
          owner: async () => ({
            user_id: 'user-a',
            platform_origin: account.mode === 'development' ? 'http://127.0.0.1:7001' : 'https://api.agentera.com.cn'
          }),
          bind,
          clear,
          list: async () => [platformModel()]
        }
      }
    })
    await platformAccountActions(accountBridge).refresh()
    await platformModelCatalog().load()
    recordGatewayReadyCapability(
      { profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
    setCurrentModel('catalog-a')
    setCurrentProvider('aino')
    setCurrentPlatformOwner('user-a', 'http://127.0.0.1:7001')
    setCurrentModelSource('manual')

    return {
      bind,
      clear,
      create,
      requestGateway,
      switchToNewerAuthority: () => {
        account = { ...platformSnapshot('user-a', 2), mode: 'production' }
        broadcast(account)
      }
    }
  }

  async function prepareManagedCatalog() {
    const account = platformSnapshot()

    const accountBridge: PlatformAccountBridge = {
      status: async () => account,
      capabilities: vi.fn(),
      retry: async () => account,
      requestPhoneCode: vi.fn(),
      verifyPhoneCode: vi.fn(),
      loginExisting: vi.fn(),
      completeSecondFactor: vi.fn(),
      updateProfile: vi.fn(),
      requestBindingCode: vi.fn(),
      submitStepUp: vi.fn(),
      bindPhone: vi.fn(),
      logout: vi.fn(),
      onChanged: () => () => undefined
    }

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: accountBridge,
        platformModels: { list: async () => [platformModel()] }
      }
    })
    await platformAccountActions(accountBridge).refresh()
    await platformModelCatalog().load()
  }

  afterEach(() => {
    cleanup()
    $newChatProfile.set(null)
    $newChatRoute.set(null)
    $activeGatewayProfile.set('default')
    $activeSessionId.set(null)
    $projectScope.set(ALL_PROJECTS)
    $projectTree.set([])
    $currentCwd.set('')
    $currentFastMode.set(false)
    $currentModel.set('')
    $currentPlatformOwner.set('')
    $currentProvider.set('')
    setCurrentModelSource('')
    $currentReasoningEffort.set('')
    $modelPickerOpen.set(false)
    $composerAttachments.set([])
    $composerDraft.set('')
    setNewChatWorkspaceTarget(undefined)
    clearGatewayManagedCapabilities()
    vi.restoreAllMocks()
  })

  it('routes a plain new chat (no explicit profile) to the live gateway profile', async () => {
    // The "rubberband to default" bug: the top New Session button clears
    // $newChatProfile to null. In global-remote mode one backend serves every
    // profile, so an omitted `profile` lands the chat on the launch (default)
    // profile. The session must instead carry the active gateway profile.
    const params = await createWith(() => {
      $activeGatewayProfile.set('coder')
      $newChatProfile.set(null)
    })

    expect(params).toMatchObject({ profile: 'coder' })
  })

  it('honours an explicit per-profile "+" selection', async () => {
    const params = await createWith(() => {
      $activeGatewayProfile.set('coder')
      $newChatProfile.set('analyst')
    })

    expect(params).toMatchObject({ profile: 'analyst' })
  })

  // Regression (Settings → Model doesn't stick): a stale composer selection
  // must not be shipped as a per-session override on a NEW chat.
  //
  // Saving Settings → Model while a session is live deliberately leaves
  // $currentModel painted with the LIVE agent's model (applySavedMainModel
  // keeps the live session authoritative) and only flips the source to
  // 'default'. If session.create still sent that value, every new chat was
  // pinned to the old model and the backend never resolved model.default —
  // the user-visible "my default won't change" bug.
  it('omits a default-sourced selection so the backend resolves model.default', async () => {
    const params = await createWith(() => {
      // What the composer holds after Settings saved a new default while a
      // chat was open: the previous session's model, marked default-sourced.
      setCurrentModel('openai/gpt-5.6-sol')
      setCurrentProvider('openai-codex')
      setCurrentModelSource('default')
    })

    expect(params).not.toHaveProperty('model')
    expect(params).not.toHaveProperty('provider')
  })

  it('creates and binds an automatically selected Aino default without writing BYOK config', async () => {
    const account = platformSnapshot()
    const order: string[] = []

    const accountBridge: PlatformAccountBridge = {
      status: async () => account,
      capabilities: vi.fn(),
      retry: async () => account,
      requestPhoneCode: vi.fn(),
      verifyPhoneCode: vi.fn(),
      loginExisting: vi.fn(),
      completeSecondFactor: vi.fn(),
      updateProfile: vi.fn(),
      requestBindingCode: vi.fn(),
      submitStepUp: vi.fn(),
      bindPhone: vi.fn(),
      logout: vi.fn(),
      onChanged: () => () => undefined
    }

    const bind = vi.fn(async () => {
      order.push('bind')

      return {
        ok: true as const,
        ready: true as const,
        model_id: 'catalog-a',
        billing_source: 'aino' as const,
        expires_at: 'later'
      }
    })

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: accountBridge,
        platformModels: {
          owner: async () => ({ platform_origin: 'http://127.0.0.1:1234', user_id: 'user-a' }),
          bind,
          clear: vi.fn(),
          list: async () => [platformModel()]
        }
      }
    })
    await platformAccountActions(accountBridge).refresh()
    recordGatewayReadyCapability(
      { profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
    await platformModelCatalog().load()
    vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: '', provider: '' })

    const { result: modelControls } = renderHook(() =>
      useModelControls({
        queryClient: new QueryClient(),
        requestGateway: vi.fn()
      })
    )

    await act(async () => modelControls.current.refreshCurrentModel())
    expect($currentModel.get()).toBe('catalog-a')
    expect($currentProvider.get()).toBe('aino')
    expect(getCurrentModelSource()).toBe('default')

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      order.push(method)

      if (method === 'session.create') {
        return {
          session_id: RUNTIME_SESSION_ID,
          stored_session_id: null,
          info: {
            model_source: 'aino',
            model_id: 'catalog-a',
            provider: 'aino',
            model_status: 'awaiting_managed_credentials'
          }
        } as never
      }

      if (method === 'session.managed_model_ticket') {
        return { managed_model_binding: 1, session_ticket: 'single-use-ticket' } as never
      }

      if (method === 'prompt.submit') {
        return {} as never
      }

      throw new Error(`unexpected request: ${method}`)
    })

    setCurrentCwd('')
    setCurrentReasoningEffort('high')
    setNewChatWorkspaceTarget(undefined)

    routeManagedDraftRequests(requestGateway)
    let submitText: null | ((text: string) => Promise<boolean>) = null
    render(<FirstSendHarness onReady={value => (submitText = value)} requestGateway={requestGateway} />)
    await waitFor(() => expect(submitText).not.toBeNull())

    await act(async () => {
      await submitText!('first managed prompt')
    })

    expect(requestGateway).toHaveBeenCalledWith(
      'session.create',
      expect.objectContaining({ model_source: 'aino', model_id: 'catalog-a' })
    )
    expect(requestGateway.mock.calls.find(([method]) => method === 'session.create')?.[1]).not.toHaveProperty(
      'reasoning_effort'
    )
    expect(order).toEqual(['session.create', 'session.managed_model_ticket', 'bind', 'prompt.submit'])
    expect(requestGateway).toHaveBeenCalledWith(
      'prompt.submit',
      { session_id: RUNTIME_SESSION_ID, text: 'first managed prompt' },
      1_800_000
    )
    expect(requestGateway.mock.calls.find(([method]) => method === 'config.set')).toBeUndefined()
  })

  it('refreshes a missed same-owner account revision before a manual Aino first send', async () => {
    $activeSessionId.set(null)
    $selectedStoredSessionId.set(null)
    setCurrentModel('')
    setCurrentProvider('')
    setCurrentPlatformOwner('')
    setCurrentModelSource('')
    setAwaitingResponse(false)
    setBusy(false)
    $activeGatewayProfile.set('default')

    let snapshot: PlatformAccountSnapshot = platformSnapshot('user-a', 3)

    const bind = vi.fn(async () => ({
      ok: true as const,
      ready: true as const,
      model_id: 'catalog-a',
      billing_source: 'aino' as const,
      expires_at: 'later'
    }))

    const accountBridge: PlatformAccountBridge = {
      status: vi.fn(async () => snapshot),
      capabilities: vi.fn(async () => ({}) as never),
      retry: async () => snapshot,
      requestPhoneCode: vi.fn(),
      verifyPhoneCode: vi.fn(),
      loginExisting: vi.fn(),
      completeSecondFactor: vi.fn(),
      updateProfile: vi.fn(),
      requestBindingCode: vi.fn(),
      submitStepUp: vi.fn(),
      bindPhone: vi.fn(),
      logout: vi.fn(),
      // Main's revision publication is intentionally missed by this renderer.
      onChanged: () => () => undefined
    }

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.create') {
        return {
          session_id: RUNTIME_SESSION_ID,
          info: {
            model_source: 'aino',
            model_id: 'catalog-a',
            provider: 'aino',
            model_status: 'awaiting_managed_credentials'
          }
        } as never
      }

      if (method === 'session.managed_model_ticket') {
        return { managed_model_binding: 1, session_ticket: 'ticket' } as never
      }

      throw new Error(`unexpected ${method}`)
    })

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: accountBridge,
        platformModels: {
          owner: async (revision: number) => {
            if (revision !== snapshot.revision) {
              throw new Error('stale main revision')
            }

            return { user_id: 'user-a', platform_origin: 'http://127.0.0.1:7001' }
          },
          bind,
          clear: vi.fn(),
          list: async () => [platformModel()]
        }
      }
    })
    await platformAccountActions(accountBridge).refresh()
    await platformModelCatalog().load()
    recordGatewayReadyCapability(
      { profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )

    const { result: controls } = renderHook(() => useModelControls({ queryClient: new QueryClient(), requestGateway }))
    await expect(controls.current.selectModel({ model: 'catalog-a', provider: 'aino' })).resolves.toBe(true)
    expect([$currentPlatformOwner.get(), $currentPlatformOrigin.get()]).toEqual(['user-a', 'http://127.0.0.1:7001'])

    snapshot = platformSnapshot('user-a', 4)
    routeManagedDraftRequests(requestGateway)
    let handle: HarnessHandle | null = null
    render(<Harness onReady={value => (handle = value)} requestGateway={requestGateway} />)
    await waitFor(() => expect(handle).not.toBeNull())

    await expect(handle!.createBackendSessionForSend()).resolves.toBe(RUNTIME_SESSION_ID)
    expect(bind).toHaveBeenCalledOnce()
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ expected_account_revision: 4 }))
    expect(accountBridge.status).toHaveBeenCalledTimes(2)
    expect(requestGateway.mock.calls.map(([method]) => method)).toEqual([
      'session.create',
      'session.managed_model_ticket'
    ])
  })

  it('rejects a missed different-owner publication before a default-sourced fresh tile creates', async () => {
    $activeSessionId.set('history-runtime')
    setCurrentModel('shared-model')
    setCurrentProvider('aino')
    setCurrentPlatformOwner('user-a', 'http://127.0.0.1:7001')
    setCurrentModelSource('default')
    setAwaitingResponse(false)
    setBusy(false)
    $activeGatewayProfile.set('default')

    let snapshot: PlatformAccountSnapshot = platformSnapshot('user-a', 3)

    const bind = vi.fn()

    const requestGateway = vi.fn(async (method: string) => {
      throw new Error(`must reject before ${method}`)
    })

    const accountBridge: PlatformAccountBridge = {
      status: vi.fn(async () => snapshot),
      capabilities: vi.fn(async () => ({}) as never),
      retry: async () => snapshot,
      requestPhoneCode: vi.fn(),
      verifyPhoneCode: vi.fn(),
      loginExisting: vi.fn(),
      completeSecondFactor: vi.fn(),
      updateProfile: vi.fn(),
      requestBindingCode: vi.fn(),
      submitStepUp: vi.fn(),
      bindPhone: vi.fn(),
      logout: vi.fn(),
      onChanged: () => () => undefined
    }

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: accountBridge,
        platformModels: {
          owner: async (revision: number) => {
            if (revision !== snapshot.revision) {
              throw new Error('stale main revision')
            }

            return { user_id: snapshot.account!.id, platform_origin: 'http://127.0.0.1:7001' }
          },
          bind,
          clear: vi.fn(),
          list: async () => [platformModel('shared-model')]
        }
      }
    })
    vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: '', provider: '' })
    await platformAccountActions(accountBridge).refresh()
    await platformModelCatalog().load()
    recordGatewayReadyCapability(
      { profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )

    // Main moved to user B on the same platform, but the renderer missed IPC.
    snapshot = platformSnapshot('user-b', 4)
    let handle: HarnessHandle | null = null
    render(<Harness onReady={value => (handle = value)} requestGateway={requestGateway} />)
    await waitFor(() => expect(handle).not.toBeNull())

    await expect(handle!.openNewSessionTile('center', { listed: false })).resolves.toBeUndefined()
    expect(requestGateway).not.toHaveBeenCalled()
    expect(bind).not.toHaveBeenCalled()
  })

  it.each(['navigation', 'missing-stored-id'])(
    'closes an abandoned managed profile draft before releasing its socket (%s)',
    async reason => {
      const fixture = await prepareDeferredManagedCreate()
      const close = deferred<object>()
      const events: string[] = []

      const release = vi.fn(() => {
        events.push('release')
      })

      vi.mocked(retainGatewayForAgent).mockResolvedValueOnce(release)
      $activeGatewayProfile.set('work')
      $newChatProfile.set('work')
      recordGatewayReadyCapability(
        { profile: 'work' },
        { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
      )
      fixture.bind.mockResolvedValue({
        ok: true,
        ready: true,
        model_id: 'catalog-a',
        billing_source: 'aino',
        expires_at: 'later'
      })
      vi.mocked(requestGatewayForAgent).mockImplementation(async (connectionId, profile, method, params) => {
        expect({ connectionId, profile }).toEqual({ connectionId: null, profile: 'work' })

        if (method === 'session.create') {
          return fixture.create.promise as never
        }

        if (method === 'session.managed_model_ticket') {
          return { managed_model_binding: 1, session_ticket: 'ticket' } as never
        }

        if (method === 'session.close') {
          expect(params).toEqual({ session_id: 'abandoned-runtime' })
          events.push('close')

          return close.promise as never
        }

        throw new Error(`unexpected ${method}`)
      })

      const generic = vi.fn(async () => {
        throw new Error('Unpublished runtime has no generic owner')
      })

      let routeToken = 'draft'
      const selectedRef = { current: null as string | null }
      let handle: HarnessHandle | null = null
      render(
        <Harness
          getRouteToken={() => routeToken}
          onReady={value => (handle = value)}
          requestGateway={generic}
          selectedStoredSessionIdRef={selectedRef}
        />
      )
      await waitFor(() => expect(handle).not.toBeNull())

      const pending =
        reason === 'navigation'
          ? handle!.createBackendSessionForSend()
          : handle!.openNewSessionTile('center', { listed: false })

      await waitFor(() =>
        expect(requestGatewayForAgent).toHaveBeenCalledWith(
          null,
          'work',
          'session.create',
          expect.anything(),
          undefined,
          undefined,
          { spawnPriority: 'foreground' }
        )
      )

      if (reason === 'navigation') {
        routeToken = 'other'
        selectedRef.current = 'other-session'
      }

      fixture.create.resolve({
        session_id: 'abandoned-runtime',
        stored_session_id: reason === 'navigation' ? 'abandoned-stored' : undefined,
        info: { model_source: 'aino', model_id: 'catalog-a', provider: 'aino' }
      })
      await waitFor(() => expect(events).toEqual(['close']))
      expect(release).not.toHaveBeenCalled()
      close.resolve({})
      await pending
      expect(fixture.bind).toHaveBeenCalledOnce()
      expect(events).toEqual(['close', 'release'])
      expect(generic).not.toHaveBeenCalled()
      expect(release).toHaveBeenCalledOnce()
    }
  )

  it('rejects a deferred first send after its captured commercial authority changes', async () => {
    const deferredCreate = await prepareDeferredManagedCreate()
    routeManagedDraftRequests(deferredCreate.requestGateway)
    let submitText: null | ((text: string) => Promise<boolean>) = null
    render(<FirstSendHarness onReady={value => (submitText = value)} requestGateway={deferredCreate.requestGateway} />)
    await waitFor(() => expect(submitText).not.toBeNull())

    const pending = submitText!('do not adopt authority B')
    await waitFor(() =>
      expect(deferredCreate.requestGateway.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(1)
    )
    deferredCreate.switchToNewerAuthority()
    deferredCreate.create.resolve({
      session_id: 'created-under-a',
      info: {
        model_source: 'aino',
        model_id: 'catalog-a',
        provider: 'aino',
        model_status: 'awaiting_managed_credentials'
      }
    })

    await expect(pending).resolves.toBe(false)
    expect(deferredCreate.requestGateway.mock.calls.map(([method]) => method)).toEqual([
      'session.create',
      'session.close'
    ])
    expect(deferredCreate.bind).not.toHaveBeenCalled()
    expect(deferredCreate.clear).toHaveBeenCalledOnce()
  })

  it('rejects a deferred managed tile after its captured commercial authority changes', async () => {
    const deferredCreate = await prepareDeferredManagedCreate()
    routeManagedDraftRequests(deferredCreate.requestGateway)
    let handle: HarnessHandle | null = null
    render(<Harness onReady={value => (handle = value)} requestGateway={deferredCreate.requestGateway} />)
    await waitFor(() => expect(handle).not.toBeNull())

    const pending = handle!.openNewSessionTile('center', { listed: false })
    await waitFor(() =>
      expect(deferredCreate.requestGateway.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(1)
    )
    deferredCreate.switchToNewerAuthority()
    deferredCreate.create.resolve({
      session_id: 'tile-created-under-a',
      stored_session_id: 'stored-tile-created-under-a',
      info: {
        model_source: 'aino',
        model_id: 'catalog-a',
        provider: 'aino',
        model_status: 'awaiting_managed_credentials'
      }
    })

    await expect(pending).resolves.toBeUndefined()
    expect(deferredCreate.requestGateway.mock.calls.map(([method]) => method)).toEqual([
      'session.create',
      'session.close'
    ])
    expect(deferredCreate.bind).not.toHaveBeenCalled()
    expect(deferredCreate.clear).toHaveBeenCalledOnce()
  })

  it('preserves a quota-blocked managed draft and opens the picker without replaying it', async () => {
    const account = platformSnapshot()
    const bind = vi.fn(async () => ({ ok: false as const, error: { code: 'quota_exhausted' } }))

    const accountBridge: PlatformAccountBridge = {
      status: async () => account,
      capabilities: vi.fn(),
      retry: async () => account,
      requestPhoneCode: vi.fn(),
      verifyPhoneCode: vi.fn(),
      loginExisting: vi.fn(),
      completeSecondFactor: vi.fn(),
      updateProfile: vi.fn(),
      requestBindingCode: vi.fn(),
      submitStepUp: vi.fn(),
      bindPhone: vi.fn(),
      logout: vi.fn(),
      onChanged: () => () => undefined
    }

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: accountBridge,
        platformModels: {
          owner: async () => ({ platform_origin: 'http://127.0.0.1:1234', user_id: 'user-a' }),
          bind,
          clear: vi.fn(),
          list: async () => [platformModel()]
        }
      }
    })
    await platformAccountActions(accountBridge).refresh()
    recordGatewayReadyCapability(
      { profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
    await platformModelCatalog().load()
    setCurrentModel('catalog-a')
    setCurrentProvider('aino')
    setCurrentPlatformOwner('user-a', 'http://127.0.0.1:1234')
    setCurrentModelSource('manual')
    $composerDraft.set('keep the blocked draft')

    const requestGateway = vi.fn(async (method: string) => {
      if (method === 'session.create') {
        return {
          session_id: RUNTIME_SESSION_ID,
          stored_session_id: null,
          info: { model_source: 'aino', model_id: 'catalog-a', provider: 'aino' }
        } as never
      }

      if (method === 'session.managed_model_ticket') {
        return { managed_model_binding: 1, session_ticket: 'single-use-ticket' } as never
      }

      return {} as never
    })

    routeManagedDraftRequests(requestGateway)
    let submitText: null | ((text: string) => Promise<boolean>) = null
    render(<FirstSendHarness onReady={value => (submitText = value)} requestGateway={requestGateway} />)
    await waitFor(() => expect(submitText).not.toBeNull())

    await expect(submitText!('keep the blocked draft')).resolves.toBe(false)

    expect(bind).toHaveBeenCalledOnce()
    expect(requestGateway.mock.calls.some(([method]) => method === 'prompt.submit')).toBe(false)
    expect($composerDraft.get()).toBe('keep the blocked draft')
    const recovery = $notifications.get().at(-1)?.action
    expect(recovery?.label).toBe('Choose model')
    act(() => recovery?.onClick())
    expect($modelPickerOpen.get()).toBe(true)
  })

  it('waits for pending default resolution before a reloaded automatic Aino first send', async () => {
    const account = platformSnapshot()
    const globalModel = deferred<{ model: string; provider: string }>()
    const order: string[] = []

    const accountBridge: PlatformAccountBridge = {
      status: async () => account,
      capabilities: vi.fn(),
      retry: async () => account,
      requestPhoneCode: vi.fn(),
      verifyPhoneCode: vi.fn(),
      loginExisting: vi.fn(),
      completeSecondFactor: vi.fn(),
      updateProfile: vi.fn(),
      requestBindingCode: vi.fn(),
      submitStepUp: vi.fn(),
      bindPhone: vi.fn(),
      logout: vi.fn(),
      onChanged: () => () => undefined
    }

    const bind = vi.fn(async () => {
      order.push('bind')

      return {
        ok: true as const,
        ready: true as const,
        model_id: 'catalog-a',
        billing_source: 'aino' as const,
        expires_at: 'later'
      }
    })

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: accountBridge,
        platformModels: {
          owner: async () => ({ platform_origin: 'http://127.0.0.1:1234', user_id: 'user-a' }),
          bind,
          clear: vi.fn(),
          list: async () => [{ ...platformModel(), capabilities: { ...platformModel().capabilities, reasoning: true } }]
        }
      }
    })
    await platformAccountActions(accountBridge).refresh()
    recordGatewayReadyCapability(
      { profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
    await platformModelCatalog().load()

    // Reload restores visible values only. Send must initiate its own default
    // resolution before any passive composer refresh has run.
    setCurrentModel('catalog-a')
    setCurrentProvider('aino')
    setCurrentPlatformOwner('user-a')
    setCurrentModelSource('default')
    setCurrentReasoningEffort('high')
    vi.mocked(getGlobalModelInfo).mockReturnValue(globalModel.promise)

    const requestGateway = vi.fn(async (method: string) => {
      order.push(method)

      if (method === 'session.create') {
        return {
          session_id: RUNTIME_SESSION_ID,
          stored_session_id: null,
          info: {
            model_source: 'aino',
            model_id: 'catalog-a',
            provider: 'aino',
            model_status: 'awaiting_managed_credentials'
          }
        } as never
      }

      if (method === 'session.managed_model_ticket') {
        return { managed_model_binding: 1, session_ticket: 'single-use-ticket' } as never
      }

      if (method === 'prompt.submit') {
        return {} as never
      }

      throw new Error(`unexpected request: ${method}`)
    })

    renderHook(() =>
      useModelControls({
        queryClient: new QueryClient(),
        requestGateway
      })
    )

    routeManagedDraftRequests(requestGateway)
    let submitText: null | ((text: string) => Promise<boolean>) = null
    render(<FirstSendHarness onReady={value => (submitText = value)} requestGateway={requestGateway} />)
    await waitFor(() => expect(submitText).not.toBeNull())

    let submitting!: Promise<boolean>

    await act(async () => {
      submitting = submitText!('first prompt after reload')
      await Promise.resolve()
    })
    await waitFor(() => expect(getGlobalModelInfo).toHaveBeenCalled())
    expect(requestGateway.mock.calls.some(([method]) => method === 'session.create')).toBe(false)

    globalModel.resolve({ model: '', provider: '' })
    await act(async () => {
      await expect(submitting).resolves.toBe(true)
    })

    expect(order).toEqual(['session.create', 'session.managed_model_ticket', 'bind', 'prompt.submit'])
    expect(requestGateway).toHaveBeenCalledWith(
      'session.create',
      expect.objectContaining({ model_source: 'aino', model_id: 'catalog-a', reasoning_effort: 'high' })
    )
  })

  it('rejects a managed first send on its unsupported captured owner before create or prompt submit', async () => {
    vi.mocked(requestGatewayForAgent).mockClear()
    await prepareManagedCatalog()

    const route = {
      connectionId: 'source-a',
      mode: 'remote' as const,
      profile: 'default',
      targetProfile: 'backend-default'
    }

    $newChatProfile.set(route.profile)
    $newChatRoute.set({ ...route })
    setCurrentModel('catalog-a')
    setCurrentProvider('aino')
    setCurrentPlatformOwner('user-a')
    setCurrentModelSource('manual')
    recordGatewayReadyCapability(route, { type: 'gateway.ready', payload: {} })
    const ambientRequest = vi.fn(async (_method: string) => ({}) as never)
    let submitText: null | ((text: string) => Promise<boolean>) = null
    render(<FirstSendHarness onReady={value => (submitText = value)} requestGateway={ambientRequest} />)
    await waitFor(() => expect(submitText).not.toBeNull())

    await expect(submitText!('must not leave this draft')).resolves.toBe(false)
    expect(requestGatewayForAgent).not.toHaveBeenCalled()
    expect(ambientRequest.mock.calls.some(([method]) => ['session.create', 'prompt.submit'].includes(method))).toBe(
      false
    )
  })

  it('rechecks the immutable captured route after readiness and rejects an owner replacement', async () => {
    vi.mocked(requestGatewayForAgent).mockClear()
    await prepareManagedCatalog()

    const route = {
      connectionId: 'source-a',
      mode: 'remote' as const,
      profile: 'default',
      targetProfile: 'backend-default'
    }

    const ready = deferred<void>()
    vi.mocked(ensureGatewayAgent).mockReturnValueOnce(ready.promise)
    $newChatProfile.set(route.profile)
    $newChatRoute.set({ ...route })
    setCurrentModel('catalog-a')
    setCurrentProvider('aino')
    setCurrentPlatformOwner('user-a')
    setCurrentModelSource('manual')
    recordGatewayReadyCapability(route, {
      type: 'gateway.ready',
      payload: { managed_model_binding: 1 }
    })
    const ambientRequest = vi.fn(async (_method: string) => ({}) as never)
    let submitText: null | ((text: string) => Promise<boolean>) = null
    render(<FirstSendHarness onReady={value => (submitText = value)} requestGateway={ambientRequest} />)
    await waitFor(() => expect(submitText).not.toBeNull())

    const submitting = submitText!('captured owner only')
    await waitFor(() => expect(ensureGatewayAgent).toHaveBeenCalledWith('source-a', 'default'))
    resetGatewayManagedCapability(route)
    $activeGatewayProfile.set('replacement-profile')
    recordGatewayReadyCapability(
      { connectionId: 'source-b', profile: 'replacement-profile' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
    ready.resolve()

    await expect(submitting).resolves.toBe(false)
    expect(requestGatewayForAgent).not.toHaveBeenCalled()
    expect(ambientRequest.mock.calls.some(([method]) => ['session.create', 'prompt.submit'].includes(method))).toBe(
      false
    )
  })

  it('captures manual A at Send while catalog work and a later manual B remain independent', async () => {
    const catalogReady = deferred<void>()
    const profileReady = deferred<void>()
    const catalogLoad = vi.spyOn(platformModelCatalog(), 'load').mockReturnValue(catalogReady.promise)
    vi.mocked(ensureGatewayProfile).mockReturnValueOnce(profileReady.promise)

    const requestGateway = vi.fn(async (method: string) =>
      method === 'session.create'
        ? ({ session_id: RUNTIME_SESSION_ID, stored_session_id: null } as never)
        : ({} as never)
    )

    const { result: controls } = renderHook(() => useModelControls({ queryClient: new QueryClient(), requestGateway }))
    await act(async () => controls.current.selectModel({ model: 'manual-a', provider: 'provider-a' }))
    setCurrentReasoningEffort('high')
    setCurrentFastMode(false)
    let submitText!: (text: string) => Promise<boolean>
    render(<FirstSendHarness onReady={value => (submitText = value)} requestGateway={requestGateway} />)
    await waitFor(() => expect(submitText).toBeDefined())

    let submitting!: Promise<boolean>
    act(() => {
      submitting = submitText('captured intent')
    })
    await act(async () => controls.current.selectModel({ model: 'manual-b', provider: 'provider-b' }))
    setCurrentReasoningEffort('low')
    setCurrentFastMode(true)
    // Manual sends must reach profile readiness without joining catalog/default I/O.
    const reachedProfileBeforeCatalog = vi.mocked(ensureGatewayProfile).mock.calls.length > 0
    catalogReady.resolve()
    profileReady.resolve()
    await act(async () => {
      await expect(submitting).resolves.toBe(true)
    })

    expect(requestGateway).toHaveBeenCalledWith(
      'session.create',
      expect.objectContaining({
        model: 'manual-a',
        provider: 'provider-a',
        reasoning_effort: 'high',
        fast: false
      })
    )
    expect(reachedProfileBeforeCatalog).toBe(true)
    expect(catalogLoad).not.toHaveBeenCalled()
    expect($currentModel.get()).toBe('manual-b')
    expect($currentProvider.get()).toBe('provider-b')
    expect(getCurrentModelSource()).toBe('manual')
    expect(requestGateway.mock.calls.filter(([method]) => method === 'prompt.submit')).toHaveLength(1)
    const nextParams = await createWith(() => $activeSessionId.set(null))
    expect(nextParams).toMatchObject({ model: 'manual-b', provider: 'provider-b', reasoning_effort: 'low', fast: true })
  })

  it.each(['manual', 'saved default', 'owner scope'] as const)(
    'keeps the draft recoverable when %s changes during captured default validation',
    async change => {
      const globalModel = deferred<{ model: string; provider: string }>()
      vi.mocked(getGlobalModelInfo).mockReturnValue(globalModel.promise)
      setCurrentModel('old-default')
      setCurrentProvider('old-provider')
      setCurrentModelSource('default')
      const attachment = { id: 'file-a', kind: 'file' as const, label: 'notes.txt', path: '/notes.txt' }
      $composerDraft.set('keep this draft')
      $composerAttachments.set([attachment])
      clearNotifications()

      const requestGateway = vi.fn(async (method: string) =>
        method === 'session.create'
          ? ({ session_id: RUNTIME_SESSION_ID, stored_session_id: null } as never)
          : ({} as never)
      )

      const { result: controls } = renderHook(() =>
        useModelControls({ queryClient: new QueryClient(), requestGateway })
      )

      let submitText!: (text: string) => Promise<boolean>
      render(<FirstSendHarness onReady={value => (submitText = value)} requestGateway={requestGateway} />)
      await waitFor(() => expect(submitText).toBeDefined())
      let submitting!: Promise<boolean>
      act(() => {
        submitting = submitText('keep this draft')
      })
      await waitFor(() => expect(getGlobalModelInfo).toHaveBeenCalled())
      expect(requestGateway).not.toHaveBeenCalled()
      await act(async () => {
        if (change === 'manual') {
          await controls.current.selectModel({ model: 'manual-b', provider: 'provider-b' })
        } else if (change === 'saved default') {
          controls.current.applySavedMainModel('new-provider', 'new-default')
        } else {
          setComposerSelectionOwner('another-connection', 'another-profile')
        }
      })
      globalModel.resolve({ model: 'validated-old-default', provider: 'old-provider' })
      await act(async () => {
        await expect(submitting).resolves.toBe(false)
      })
      expect(requestGateway).not.toHaveBeenCalled()
      expect($composerDraft.get()).toBe('keep this draft')
      expect($composerAttachments.get()).toEqual([attachment])
      expect($notifications.get().some(item => item.kind === 'error')).toBe(true)
    }
  )

  it('omits a live Aino model when a saved BYOK default is submitted before draft refresh', async () => {
    const account = platformSnapshot()
    const order: string[] = []
    let createParams: Record<string, unknown> | undefined

    const accountBridge: PlatformAccountBridge = {
      status: async () => account,
      capabilities: vi.fn(),
      retry: async () => account,
      requestPhoneCode: vi.fn(),
      verifyPhoneCode: vi.fn(),
      loginExisting: vi.fn(),
      completeSecondFactor: vi.fn(),
      updateProfile: vi.fn(),
      requestBindingCode: vi.fn(),
      submitStepUp: vi.fn(),
      bindPhone: vi.fn(),
      logout: vi.fn(),
      onChanged: () => () => undefined
    }

    const bind = vi.fn(async () => {
      order.push('bind')

      return {
        ok: true as const,
        ready: true as const,
        model_id: 'catalog-a',
        billing_source: 'aino' as const,
        expires_at: 'later'
      }
    })

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        platformAccount: accountBridge,
        platformModels: {
          owner: async () => ({ platform_origin: 'http://127.0.0.1:1234', user_id: 'user-a' }),
          bind,
          clear: vi.fn(),
          list: async () => [platformModel()]
        }
      }
    })
    await platformAccountActions(accountBridge).refresh()
    recordGatewayReadyCapability(
      { profile: 'default' },
      { type: 'gateway.ready', payload: { managed_model_binding: 1 } }
    )
    await platformModelCatalog().load()
    vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: '', provider: '' })

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      order.push(method)

      if (method === 'session.create') {
        createParams = params
        const managed = params?.model_source === 'aino'

        return {
          session_id: RUNTIME_SESSION_ID,
          stored_session_id: null,
          info: managed
            ? {
                model_source: 'aino',
                model_id: 'catalog-a',
                provider: 'aino',
                model_status: 'awaiting_managed_credentials'
              }
            : { model: 'openai/gpt-5.6-sol', provider: 'openai-codex' }
        } as never
      }

      if (method === 'session.managed_model_ticket') {
        return { managed_model_binding: 1, session_ticket: 'single-use-ticket' } as never
      }

      if (method === 'prompt.submit') {
        return {} as never
      }

      throw new Error(`unexpected request: ${method}`)
    })

    const { result } = renderHook(() =>
      useModelControls({
        queryClient: new QueryClient(),
        requestGateway
      })
    )

    await act(async () => result.current.refreshCurrentModel())
    expect($currentModel.get()).toBe('catalog-a')
    expect($currentProvider.get()).toBe('aino')
    expect(getCurrentModelSource()).toBe('default')

    $activeSessionId.set('runtime-live')
    act(() => result.current.applySavedMainModel('openai-codex', 'openai/gpt-5.6-sol'))
    vi.mocked(getGlobalModelInfo).mockResolvedValue({ model: 'openai/gpt-5.6-sol', provider: 'openai-codex' })

    expect($currentModel.get()).toBe('catalog-a')
    expect($currentProvider.get()).toBe('aino')
    expect(getCurrentModelSource()).toBe('default')

    $activeSessionId.set(null)
    let submitText: null | ((text: string) => Promise<boolean>) = null
    render(<FirstSendHarness onReady={value => (submitText = value)} requestGateway={requestGateway} />)
    await waitFor(() => expect(submitText).not.toBeNull())

    await expect(submitText!('first prompt after settings save')).resolves.toBe(true)
    expect(createParams).not.toHaveProperty('model_source')
    expect(createParams).not.toHaveProperty('model_id')
    expect(order).toEqual(['session.create', 'prompt.submit'])
    expect(bind).not.toHaveBeenCalled()
    expect(requestGateway.mock.calls.find(([method]) => method === 'config.set')).toBeUndefined()
  })

  it('still sends an explicit manual pick as a per-session override', async () => {
    const params = await createWith(() => {
      setCurrentModel('anthropic/claude-opus-5')
      setCurrentProvider('anthropic')
      setCurrentModelSource('manual')
    })

    expect(params).toMatchObject({
      model: 'anthropic/claude-opus-5',
      provider: 'anthropic'
    })
  })

  // An unset source is the first-run/cleared state — nothing the user picked,
  // so it must not pin the session either.
  it('omits the model when no selection source is recorded', async () => {
    const params = await createWith(() => {
      setCurrentModel('openai/gpt-5.6-sol')
      setCurrentProvider('openai-codex')
      setCurrentModelSource('')
    })

    expect(params).not.toHaveProperty('model')
    expect(params).not.toHaveProperty('provider')
  })

  // Effort and fast mode are independent of the model-override decision.
  it('keeps sending reasoning effort even when the model is omitted', async () => {
    const params = await createWith(() => {
      setCurrentModel('openai/gpt-5.6-sol')
      setCurrentProvider('openai-codex')
      setCurrentModelSource('default')
      setCurrentReasoningEffort('high')
    })

    expect(params).not.toHaveProperty('model')
    expect(params).toMatchObject({ reasoning_effort: 'high' })
  })

  it('passes the current workspace cwd into session.create', async () => {
    const params = await createWith(() => {
      $currentCwd.set('/remote/worktree')
    })

    expect(params).toMatchObject({ cwd: '/remote/worktree' })
  })

  it('keeps a route-aware New Chat pinned when foreground activation changes before Send', async () => {
    const route = {
      connectionId: 'source-a',
      mode: 'remote' as const,
      profile: 'default',
      targetProfile: 'backend-default'
    }

    const ambientRequest = vi.fn(async () => ({}) as never)
    vi.mocked(requestGatewayForAgent).mockResolvedValueOnce({
      session_id: RUNTIME_SESSION_ID,
      stored_session_id: null
    } as never)

    $newChatProfile.set(route.profile)
    $newChatRoute.set({ ...route })
    $activeGatewayProfile.set('other-connection-profile')

    let handle: HarnessHandle | null = null
    render(<Harness onReady={value => (handle = value)} requestGateway={ambientRequest} />)
    await waitFor(() => expect(handle).not.toBeNull())

    await act(async () => {
      await handle!.createBackendSessionForSend()
    })

    expect(requestGatewayForAgent).toHaveBeenCalledWith(
      'source-a',
      'default',
      'session.create',
      expect.objectContaining({ profile: 'backend-default', source: 'desktop' }),
      undefined,
      undefined,
      // #105104 / #105390: first send on a fresh chat is a user gesture; the
      // create dial must not queue behind background roster hydration.
      { spawnPriority: 'foreground' }
    )
    expect(getGlobalModelInfo).toHaveBeenCalledWith({ connectionId: 'source-a', profile: 'backend-default' })
    expect(retainGatewayForAgent).toHaveBeenCalledWith('source-a', 'default', { spawnPriority: 'foreground' })
    expect(ambientRequest).not.toHaveBeenCalledWith('session.create', expect.anything())
  })

  it('freezes the visible selector state before profile readiness and sends Priority as fast alone', async () => {
    const profileReady = deferred<void>()
    vi.mocked(ensureGatewayProfile).mockReturnValueOnce(profileReady.promise)

    setCurrentModel('anthropic/claude-sonnet-4.6')
    setCurrentProvider('anthropic')
    // A real composer pick marks the selection manual; this test drives the
    // atoms directly, so set the source explicitly. Only a manual selection
    // rides along as a per-session override.
    setCurrentModelSource('manual')
    setCurrentReasoningEffort('high')
    setCurrentFastMode(true)
    // Priority rides as `fast` alone: a pre-Ultrafast backend rejects `service_tier`.
    setCurrentServiceTier('priority')

    let createParams: Record<string, unknown> | undefined

    const requestGateway = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'session.create') {
        createParams = params

        return { session_id: RUNTIME_SESSION_ID, stored_session_id: null } as never
      }

      return {} as never
    })

    let handle: HarnessHandle | null = null
    render(<Harness onReady={next => (handle = next)} requestGateway={requestGateway} />)
    await waitFor(() => expect(handle).not.toBeNull())

    let createPromise!: Promise<null | string>
    act(() => {
      createPromise = handle!.createBackendSessionForSend()
    })
    await waitFor(() => expect(ensureGatewayProfile).toHaveBeenCalled())

    // A background refresh or a second click can mutate the sticky atoms while
    // the profile is waking. This send must still use what was visible at Enter.
    setCurrentModel('openai/gpt-5.5')
    setCurrentProvider('openai-codex')
    setCurrentReasoningEffort('low')
    setCurrentFastMode(false)
    setCurrentServiceTier('ultrafast')
    profileReady.resolve()

    await act(async () => {
      await createPromise
    })

    expect(createParams).toMatchObject({
      fast: true,
      model: 'anthropic/claude-sonnet-4.6',
      provider: 'anthropic',
      reasoning_effort: 'high'
    })
    expect(createParams).not.toHaveProperty('service_tier')
  })

  it('falls back to the entered project cwd when the current cwd is blank', async () => {
    const { rememberOpenProject } = await import('@/store/open-projects')

    const params = await createWith(() => {
      rememberOpenProject({ id: 'p_app', path: '/repo/app' })
      $projectTree.set([
        {
          id: 'p_app',
          label: 'App',
          path: '/repo/app',
          repos: [{ groups: [], id: '/repo/app', label: 'app', path: '/repo/app', sessionCount: 0 }],
          sessionCount: 0
        }
      ])
      $projectScope.set('p_app')
      $currentCwd.set('')
    })

    expect(params).toMatchObject({ cwd: '/repo/app' })
  })
})

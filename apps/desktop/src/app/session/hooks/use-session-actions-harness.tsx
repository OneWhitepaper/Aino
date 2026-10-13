import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'
import { expect, vi } from 'vitest'

import { type SessionInfo } from '@/hermes'
import { createClientSessionState } from '@/lib/chat-runtime'
import { requestGatewayForAgent } from '@/store/gateway'

import type { ClientSessionState } from '../../types'

import { usePromptActions } from './use-prompt-actions'
import { useSessionActions } from './use-session-actions'
const RUNTIME_SESSION_ID = 'rt-new-001'
export type HarnessHandle = Pick<
  ReturnType<typeof useSessionActions>,
  | 'archiveSession'
  | 'branchStoredSession'
  | 'createBackendSessionForSend'
  | 'openNewSessionTile'
  | 'removeSession'
  | 'selectSidebarItem'
  | 'startFreshSessionDraft'
> &
  Pick<ReturnType<typeof useSessionActions>, 'submitTextToNewSession'>

export function storedSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    ended_at: null,
    id: 'stored-1',
    input_tokens: 0,
    is_active: false,
    last_active: 1,
    message_count: 0,
    model: null,
    output_tokens: 0,
    preview: null,
    source: 'desktop',
    started_at: 1,
    title: 'stored',
    tool_call_count: 0,
    ...overrides
  }
}

export function Harness({
  activeSessionId = null,
  activeSessionIdRef: activeSessionIdRefOverride,
  getRouteToken: getRouteTokenOverride,
  getRoutedStoredSessionId = () => null,
  navigate = vi.fn(),
  onReady,
  requestGateway,
  runtimeIdByStoredSessionIdRef: runtimeIdByStoredSessionIdRefOverride,
  selectedStoredSessionId = null,
  selectedStoredSessionIdRef: selectedStoredSessionIdRefOverride,
  updateSessionState: updateSessionStateOverride
}: {
  activeSessionId?: null | string
  activeSessionIdRef?: MutableRefObject<null | string>
  getRouteToken?: () => string
  getRoutedStoredSessionId?: () => null | string
  navigate?: ReturnType<typeof vi.fn>
  onReady: (handle: HarnessHandle) => void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  runtimeIdByStoredSessionIdRef?: MutableRefObject<Map<string, string>>
  selectedStoredSessionId?: null | string
  selectedStoredSessionIdRef?: MutableRefObject<null | string>
  updateSessionState?: (
    sessionId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    storedSessionId?: null | string
  ) => ClientSessionState
}) {
  const ref = <T,>(value: T): MutableRefObject<T> => ({ current: value })

  const actions = useSessionActions({
    activeSessionId,
    activeSessionIdRef: activeSessionIdRefOverride ?? ref(activeSessionId),
    busyRef: ref(false),
    creatingSessionRef: ref(false),
    ensureSessionState: () => ({}) as ClientSessionState,
    getRouteToken: getRouteTokenOverride ?? (() => 'token'),
    getRoutedStoredSessionId,
    navigate: navigate as never,
    requestGateway,
    resetViewSync: vi.fn(),
    routedSessionId: null,
    runtimeIdByStoredSessionIdRef: runtimeIdByStoredSessionIdRefOverride ?? ref(new Map<string, string>()),
    selectedStoredSessionId,
    selectedStoredSessionIdRef: selectedStoredSessionIdRefOverride ?? ref(selectedStoredSessionId),
    sessionStateByRuntimeIdRef: ref(new Map<string, ClientSessionState>()),
    syncSessionStateToView: vi.fn(),
    updateSessionState: updateSessionStateOverride ?? (() => ({}) as ClientSessionState)
  })

  useEffect(() => {
    onReady(actions)
  }, [actions, onReady])

  return null
}

export function routeManagedDraftRequests(
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>
) {
  vi.mocked(requestGatewayForAgent).mockImplementation((connectionId, profile, method, params) => {
    expect({ connectionId, profile }).toEqual({ connectionId: null, profile: 'default' })

    return request(method, params) as never
  })
}

export function FirstSendHarness({
  onReady,
  requestGateway
}: {
  onReady: (submitText: (text: string) => Promise<boolean>) => void
  requestGateway: <T>(method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<T>
}) {
  const activeSessionIdRef = useRef<string | null>(null)
  const selectedStoredSessionIdRef = useRef<string | null>(null)
  const runtimeIdByStoredSessionIdRef = useRef(new Map<string, string>())
  const sessionStateByRuntimeIdRef = useRef(new Map<string, ClientSessionState>())
  const busyRef = useRef(false)
  const creatingSessionRef = useRef(false)

  const ensureSessionState = (sessionId: string, storedSessionId?: null | string) => {
    const existing = sessionStateByRuntimeIdRef.current.get(sessionId)

    if (existing) {
      return existing
    }

    const created = createClientSessionState(storedSessionId ?? null)
    sessionStateByRuntimeIdRef.current.set(sessionId, created)

    if (storedSessionId) {
      runtimeIdByStoredSessionIdRef.current.set(storedSessionId, sessionId)
    }

    return created
  }

  const updateSessionState = (
    sessionId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    storedSessionId?: null | string
  ) => {
    const next = updater(ensureSessionState(sessionId, storedSessionId))
    sessionStateByRuntimeIdRef.current.set(sessionId, next)

    return next
  }

  const sessionActions = useSessionActions({
    activeSessionId: null,
    activeSessionIdRef,
    busyRef,
    creatingSessionRef,
    ensureSessionState,
    getRouteToken: () => 'new-chat',
    getRoutedStoredSessionId: () => null,
    navigate: vi.fn(),
    requestGateway,
    resetViewSync: vi.fn(),
    routedSessionId: null,
    holdSessionTranscriptView: vi.fn(),
    runtimeIdByStoredSessionIdRef,
    selectedStoredSessionId: null,
    selectedStoredSessionIdRef,
    sessionStateByRuntimeIdRef,
    syncSessionStateToView: vi.fn(),
    updateSessionState
  })

  const promptActions = usePromptActions({
    activeSessionId: null,
    activeSessionIdRef,
    branchCurrentSession: async () => true,
    busyRef,
    createBackendSessionForSend: sessionActions.createBackendSessionForSend,
    getRoutedStoredSessionId: () => null,
    getRuntimeIdForStoredSession: storedId => runtimeIdByStoredSessionIdRef.current.get(storedId) ?? null,
    getRouteToken: () => 'new-chat',
    openMemoryGraph: () => undefined,
    refreshSessions: async () => undefined,
    requestGateway,
    resumeStoredSession: () => undefined,
    runtimeIdByStoredSessionIdRef,
    selectedStoredSessionIdRef,
    startFreshSessionDraft: sessionActions.startFreshSessionDraft,
    sttEnabled: false,
    updateSessionState
  })

  useEffect(() => {
    onReady(promptActions.submitText)
  }, [onReady, promptActions.submitText])

  return null
}

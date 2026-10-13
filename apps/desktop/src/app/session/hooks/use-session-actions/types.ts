import { type MutableRefObject } from 'react'
import type { NavigateFunction } from 'react-router'

import { type ChatMessage } from '@/lib/chat-messages'
import { type NewChatWorkspaceTarget } from '@/store/session'

import type { ClientSessionState } from '../../../types'

export interface SessionActionsOptions {
  activeSessionId: string | null
  activeSessionIdRef: MutableRefObject<string | null>
  busyRef: MutableRefObject<boolean>
  creatingSessionRef: MutableRefObject<boolean>
  ensureSessionState: (sessionId: string, storedSessionId?: string | null) => ClientSessionState
  getRouteToken: () => string
  getRoutedStoredSessionId: () => null | string
  holdSessionTranscriptView?: (runtimeId: string) => () => void
  navigate: NavigateFunction
  onFreshDraftRouteIntent?: () => void
  requestGateway: <T>(method: string, params?: Record<string, unknown>) => Promise<T>
  resetViewSync: () => void
  // Live route session id from the router. Used to drop creatingSessionRef only
  // after navigate to a freshly created/forked stored id has actually landed
  // (setTimeout(0) cleared the guard before the route caught up — #66057).
  routedSessionId: string | null
  runtimeIdByStoredSessionIdRef: MutableRefObject<Map<string, string>>
  selectedStoredSessionId: string | null
  selectedStoredSessionIdRef: MutableRefObject<string | null>
  sessionStateByRuntimeIdRef: MutableRefObject<Map<string, ClientSessionState>>
  syncSessionStateToView: (sessionId: string, state: ClientSessionState) => void
  updateSessionState: (
    sessionId: string,
    updater: (state: ClientSessionState) => ClientSessionState,
    storedSessionId?: string | null
  ) => ClientSessionState
}

export interface BranchLoadedSessionOptions {
  busy: boolean
  contextDrift?: () => null | string
  cwd?: string
  messageId?: string
  messages: ChatMessage[]
  runtimeId: null | string
  storedSessionId: null | string
}

export interface FreshSessionDraftOptions {
  preserveRoute?: boolean
  replaceRoute?: boolean
  rotateFreshDraftKey?: boolean
  workspaceTarget?: NewChatWorkspaceTarget
}

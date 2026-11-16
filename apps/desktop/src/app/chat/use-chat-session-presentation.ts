import { sessionShouldHaveTranscript } from '@/app/session/hooks/use-session-actions/utils'
import { sessionMatchesStoredId } from '@/store/session'
import { isAuxiliaryWindow } from '@/store/windows'
import type { SessionInfo } from '@/types/hermes'

import { routeSessionId } from '../routes'

import { useShowChatBar } from './chat-surface-state'
import { shouldShowIntro } from './intro-visibility'
import { isRouteSessionMismatch } from './route-session-state'
import { routedSessionIsLoading, threadLoadingState } from './thread-loading'

interface ChatSessionPresentationOptions {
  activeSessionId: string | null
  awaitingResponse: boolean
  busy: boolean
  canonicalBotChat: boolean
  freshDraftReady: boolean
  gatewaySwapTarget: string | null
  guideStarting: boolean
  introSplash: boolean
  isPrimary: boolean
  lastVisibleIsUser: boolean
  messagesEmpty: boolean
  pathname: string
  resumeExhaustedSessionId: string | null
  selectedSessionId: string | null
  sessions: SessionInfo[]
  transcriptStoredSessionId: string | null
}

export function useChatSessionPresentation({
  activeSessionId,
  awaitingResponse,
  busy,
  canonicalBotChat,
  freshDraftReady,
  gatewaySwapTarget,
  guideStarting,
  introSplash,
  isPrimary,
  lastVisibleIsUser,
  messagesEmpty,
  pathname,
  resumeExhaustedSessionId,
  selectedSessionId,
  sessions,
  transcriptStoredSessionId
}: ChatSessionPresentationOptions) {
  const guideOpening = guideStarting && isPrimary
  // A tile IS its session — no route involved, never "mismatched".
  const routedSessionId = isPrimary ? routeSessionId(pathname) : selectedSessionId
  const isRoutedSessionView = Boolean(routedSessionId)

  // The URL points at a session the store hasn't loaded yet (sidebar / cmd-K /
  // direct nav). Derived in render so the swap reads instantly: the same frame
  // the id changes we drop the old transcript and show the loader, instead of
  // waiting for the resume effect (which paints a frame later) to clear them.
  const routeSessionMismatch = isPrimary
    ? isRouteSessionMismatch(routedSessionId, selectedSessionId, sessions, {
        activeRuntimeId: activeSessionId,
        contextSwitching: Boolean(gatewaySwapTarget),
        messagesEmpty,
        transcriptStoredSessionId
      })
    : false

  // The compact new-session pop-out skips the wordmark/tagline intro — it's a
  // scratch window, not the full-height empty state. The Appearance toggle
  // turns it off everywhere else.
  const showIntro = shouldShowIntro({
    activeSessionId,
    auxiliaryWindow: isAuxiliaryWindow(),
    enabled: introSplash,
    freshDraftReady,
    messagesEmpty,
    primary: isPrimary,
    routedSessionView: isRoutedSessionView,
    selectedSessionId
  })

  // Session is still loading if the route references a session we haven't
  // resumed yet. Brand-new routed drafts are empty on purpose once a runtime
  // is bound. A session the list already knows has history must keep the
  // loader up until a display-authoritative transcript arrives — including
  // the unproven warm-cache hold, where the runtime is bound but messages
  // are still suppressed.
  //
  // resumeExhausted: the bounded auto-retry in use-route-resume gave up on this
  // routed session (gateway RPC + REST fallback failed through every attempt).
  // Suppress the loader and show an explicit error + manual Retry instead of
  // spinning forever. Gated on the route matching so a stale latch from another
  // session can't blank the current one.
  const resumeExhausted = isPrimary && isRoutedSessionView && resumeExhaustedSessionId === routedSessionId

  const routedHasHistory = Boolean(
    routedSessionId &&
    sessions.some(session => sessionMatchesStoredId(session, routedSessionId) && sessionShouldHaveTranscript(session))
  )

  const loadingSession = routedSessionIsLoading({
    activeSessionId,
    knownHistory: routedHasHistory,
    messagesEmpty,
    resumeExhausted,
    routeSessionMismatch,
    routedSessionView: isRoutedSessionView
  })

  const threadLoading = threadLoadingState(loadingSession, busy, awaitingResponse, lastVisibleIsUser)

  const showChatBar = useShowChatBar({
    guideOpening,
    loadingSession,
    resumeExhausted,
    routedSessionId,
    routedSessionView: isRoutedSessionView
  })

  const botWelcome = canonicalBotChat && messagesEmpty && !busy && !loadingSession && !resumeExhausted && showChatBar

  const threadKey = selectedSessionId || activeSessionId || (isRoutedSessionView ? pathname : 'new')

  return {
    botWelcome,
    guideOpening,
    isRoutedSessionView,
    resumeExhausted,
    routedSessionId,
    routeSessionMismatch,
    showChatBar,
    showIntro,
    threadKey,
    threadLoading
  }
}

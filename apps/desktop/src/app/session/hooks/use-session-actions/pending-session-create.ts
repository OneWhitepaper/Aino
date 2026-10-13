import { useCallback, useEffect, useRef } from 'react'

import { sessionRoute } from '../../../routes'

import type { SessionActionsOptions } from './types'

const CREATE_GUARD_RELEASE_MS = 3_000

export function usePendingSessionCreate({
  creatingSessionRef,
  routedSessionId,
  selectedStoredSessionId,
  selectedStoredSessionIdRef,
  navigate
}: Pick<
  SessionActionsOptions,
  'creatingSessionRef' | 'routedSessionId' | 'selectedStoredSessionId' | 'selectedStoredSessionIdRef' | 'navigate'
>) {
  // Stored id we just created/forked and navigated to. creatingSessionRef stays
  // true until routedSessionId + selection both agree on this id — clearing via
  // setTimeout(0) let use-route-resume resume the stale route as "stuck" (#66057).
  const pendingCreatedStoredSessionIdRef = useRef<string | null>(null)
  // Route id at the moment we armed pending (often the stale previous session).
  // Distinguishes "router still lagging on A" from "user navigated to C".
  const pendingCreatedFromRouteRef = useRef<string | null>(null)
  const pendingGuardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const releaseCreatingSessionGuard = useCallback(() => {
    if (pendingGuardTimeoutRef.current != null) {
      clearTimeout(pendingGuardTimeoutRef.current)
      pendingGuardTimeoutRef.current = null
    }

    pendingCreatedStoredSessionIdRef.current = null
    pendingCreatedFromRouteRef.current = null
    creatingSessionRef.current = false
  }, [creatingSessionRef])

  // Arm the create/fork hold: keep creatingSessionRef until the route lands on
  // `storedId`, the user leaves for another route, navigate throws, or the
  // safety timeout fires (so a stuck router can't block resumes forever).
  const armPendingCreatedSession = useCallback(
    (storedId: string) => {
      pendingCreatedStoredSessionIdRef.current = storedId
      pendingCreatedFromRouteRef.current = routedSessionId

      if (pendingGuardTimeoutRef.current != null) {
        clearTimeout(pendingGuardTimeoutRef.current)
      }

      pendingGuardTimeoutRef.current = setTimeout(() => {
        pendingGuardTimeoutRef.current = null

        if (pendingCreatedStoredSessionIdRef.current !== storedId) {
          return
        }

        // Route never caught up. Retry navigate so ChatView can leave the
        // route/selection mismatch loading state; then drop the guard so
        // use-route-resume can self-heal to the URL if navigate still fails.
        try {
          navigate(sessionRoute(storedId), { replace: true })
        } catch {
          // Ignore — release below still unblocks recovery.
        }

        releaseCreatingSessionGuard()
      }, CREATE_GUARD_RELEASE_MS)
    },
    [navigate, releaseCreatingSessionGuard, routedSessionId]
  )

  useEffect(
    () => () => {
      if (pendingGuardTimeoutRef.current != null) {
        clearTimeout(pendingGuardTimeoutRef.current)
      }
    },
    []
  )

  // Drop the create/fork guard once the router catches up — or if the user
  // navigates somewhere other than the pending id (left the pre-create route).
  useEffect(() => {
    const pending = pendingCreatedStoredSessionIdRef.current

    if (!creatingSessionRef.current || !pending) {
      return
    }

    if (routedSessionId === pending && selectedStoredSessionIdRef.current === pending) {
      releaseCreatingSessionGuard()

      return
    }

    const fromRoute = pendingCreatedFromRouteRef.current

    if (routedSessionId !== fromRoute && routedSessionId !== pending) {
      releaseCreatingSessionGuard()
    }
  }, [
    creatingSessionRef,
    releaseCreatingSessionGuard,
    routedSessionId,
    selectedStoredSessionId,
    selectedStoredSessionIdRef
  ])

  return { pendingCreatedStoredSessionIdRef, releaseCreatingSessionGuard, armPendingCreatedSession }
}

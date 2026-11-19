import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { openSession } from '@/app/open-session'
import { isNewChatRoute, routeSessionId } from '@/app/routes'
import type { FreshSessionDraftOptions } from '@/app/session/hooks/use-session-actions/types'
import { noteActiveTreeGroup } from '@/components/pane-shell/tree/store'
import { $freshDraftKey, pendingGoneSessionDraftKey, restoreFreshDraftKey } from '@/store/composer'
import {
  $currentExecutionMode,
  $executionModeRequest,
  $executionModeScope,
  type ExecutionModeRequest,
  getExecutionWorkspace,
  getPreferredExecutionMode,
  rememberExecutionWorkspace,
  setDraftExecutionMode
} from '@/store/execution-mode'
import {
  $executionForegroundId,
  $foregroundRuntimeMode,
  executionWorkspaceOwner
} from '@/store/execution-mode/foreground'
import { pinNewChatRoute } from '@/store/profile'
import { $projectScope, advanceProjectNavigation, ALL_PROJECTS } from '@/store/project-scope'
import {
  $connection,
  $currentCwd,
  $currentCwdExplicit,
  $currentModel,
  $currentModelSource,
  $currentProvider,
  $freshDraftReady,
  $gatewayState,
  $newChatWorkspaceTarget,
  $selectedStoredSessionId,
  $workspaceCwdOwner,
  markComposerSelectionDefault,
  markComposerSelectionManual,
  requestSessionResume,
  setCurrentCwdExplicit,
  setCurrentCwdTransient,
  setCurrentModel,
  setCurrentPlatformOwner,
  setCurrentProvider,
  setNewChatWorkspaceTarget,
  setWorkspaceCwdOwner
} from '@/store/session'
import { noteUserSessionOpen } from '@/store/session-open-intent'
import { isSessionRemovalPending } from '@/store/session-removal'
import { focusOpenSession } from '@/store/session-states'

type StartFresh = (options?: boolean | FreshSessionDraftOptions) => void

function restoreModeDraft(request: ExecutionModeRequest, startFresh: StartFresh): void {
  const saved = getExecutionWorkspace(request.mode, request.scope)
  const owner = request.owner ?? executionWorkspaceOwner(request.scope)

  if (owner) {
    pinNewChatRoute(owner)
  }

  const draft = saved?.draft
  advanceProjectNavigation()
  $projectScope.set(saved?.projectScope ?? ALL_PROJECTS)
  startFresh({ rotateFreshDraftKey: !draft, workspaceTarget: draft?.workspaceTarget ?? null })
  noteActiveTreeGroup(null)

  if (draft) {
    restoreFreshDraftKey(draft.key)
    // undefined (inherited), null (deliberately detached) and explicit paths
    // have different backend admission semantics even if their cwd is equal.
    setNewChatWorkspaceTarget(draft.workspaceTarget)
    setCurrentCwdTransient(draft.cwd)
    setCurrentCwdExplicit(draft.cwdExplicit)
    setWorkspaceCwdOwner(null)

    if (draft.model.source === 'manual') {
      markComposerSelectionManual()
      setCurrentModel(draft.model.model)
      setCurrentProvider(draft.model.provider)
      setCurrentPlatformOwner(draft.platformOwner, draft.platformOrigin)
    } else {
      markComposerSelectionDefault()
    }
  }

  setDraftExecutionMode(request.mode)
  rememberExecutionWorkspace()
}

/** Renderer navigation only: the session cache and running owners stay alive. */
export function useExecutionModeWorkspace(startFresh: StartFresh, resumeLastSession: boolean | undefined): void {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const scope = useStore($executionModeScope)
  const request = useStore($executionModeRequest)
  const gateway = useStore($gatewayState)
  const selectedId = useStore($executionForegroundId)
  const initialized = useRef<string | null>(null)
  const restoringSession = useRef<{ id: string; draftKey: string } | null>(null)
  const restoring = useRef(false)

  // eslint-disable-next-line no-restricted-syntax -- restore transaction/initialization latches, never mirrors of reactive values
  useEffect(() => {
    if (request && request.scope !== scope) {
      $executionModeRequest.set(null)

      return
    }

    const switching = request?.scope === scope
    const needsInitialization = initialized.current !== scope

    if (
      !switching &&
      (!needsInitialization || !$connection.get() || gateway !== 'open' || resumeLastSession === undefined)
    ) {
      return
    }

    // A page/deep link is not an empty chat. Leave initialization pending so
    // its boot-time draft cannot overwrite saved memory while the page is open.
    if (!switching && !isNewChatRoute(pathname) && !routeSessionId(pathname)) {
      return
    }

    const previousOwner = initialized.current ? (JSON.parse(initialized.current) as string[]) : null
    const nextOwner = JSON.parse(scope) as string[]

    const accountChanged =
      previousOwner !== null && (previousOwner[0] !== nextOwner[0] || previousOwner[1] !== nextOwner[1])

    // An explicit history URL is already restoring through useRouteResume.
    // Never replace it with a remembered pointer on boot.
    if (!switching && !accountChanged && (selectedId || routeSessionId(pathname))) {
      initialized.current = scope

      return
    }

    let cancelled = false
    restoring.current = true
    queueMicrotask(() => {
      if (cancelled || scope !== $executionModeScope.get()) {
        return
      }

      const target = switching ? request : { scope, mode: getPreferredExecutionMode() }
      const saved = getExecutionWorkspace(target.mode, scope)
      const changedOwner = initialized.current !== null && initialized.current !== scope
      initialized.current = scope

      if (saved?.sessionId && (switching || resumeLastSession) && !isSessionRemovalPending(saved.sessionId)) {
        restoringSession.current = { id: saved.sessionId, draftKey: $freshDraftKey.get() }
        advanceProjectNavigation()
        $projectScope.set(saved.projectScope)
        const focused = focusOpenSession(saved.sessionId)

        if (focused === 'tile') {
          noteUserSessionOpen()
          restoringSession.current = null
        } else {
          requestSessionResume(saved.sessionId, executionWorkspaceOwner(scope, saved.sessionId))
          openSession(saved.sessionId, navigate, 'main')
        }
      } else if (saved || switching || changedOwner) {
        restoringSession.current = null
        restoreModeDraft(target, startFresh)
      } else {
        rememberExecutionWorkspace()
      }

      if (switching && $executionModeRequest.get() === request) {
        $executionModeRequest.set(null)
      }

      restoring.current = false
    })

    return () => {
      cancelled = true
      restoring.current = false
    }
  }, [scope, request, gateway, selectedId, pathname, startFresh, navigate, resumeLastSession])

  // eslint-disable-next-line no-restricted-syntax -- restore transaction/initialization latches, never mirrors of reactive values
  useEffect(() => {
    let queued = false
    let disposed = false
    let goneSessionId: string | null = null

    const save = () => {
      queued = false

      if (
        disposed ||
        restoring.current ||
        initialized.current !== scope ||
        scope !== $executionModeScope.get() ||
        $executionModeRequest.get()
      ) {
        return
      }

      if (goneSessionId && getExecutionWorkspace(getPreferredExecutionMode(), scope)?.sessionId === goneSessionId) {
        goneSessionId = null
        restoringSession.current = null
        restoreModeDraft({ scope, mode: getPreferredExecutionMode() }, startFresh)

        return
      }

      if (restoringSession.current) {
        const pending = restoringSession.current
        const selected = $executionForegroundId.get()

        if (
          selected === pending.id ||
          (!selected && $freshDraftReady.get() && $freshDraftKey.get() !== pending.draftKey)
        ) {
          restoringSession.current = null
        } else {
          return
        }
      }

      rememberExecutionWorkspace()
    }

    const schedule = () => {
      if (!$selectedStoredSessionId.get()) {
        goneSessionId = pendingGoneSessionDraftKey()
      }

      if (!queued) {
        queued = true
        queueMicrotask(save)
      }
    }

    const stops = [
      $executionForegroundId,
      $foregroundRuntimeMode,
      $selectedStoredSessionId,
      $currentExecutionMode,
      $freshDraftKey,
      $projectScope,
      $currentCwd,
      $currentCwdExplicit,
      $newChatWorkspaceTarget,
      $currentModel,
      $currentProvider,
      $currentModelSource,
      $workspaceCwdOwner,
      $freshDraftReady
    ].map(store => store.listen(schedule))

    schedule()
    window.addEventListener('pagehide', save)

    return () => {
      disposed = true
      stops.forEach(stop => stop())
      window.removeEventListener('pagehide', save)
    }
  }, [scope, startFresh])
}

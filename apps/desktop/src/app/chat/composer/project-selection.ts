import { atom } from 'nanostores'

import type { SessionView } from '@/app/chat/session-view'
import { acquireSubmitInFlight, releaseSubmitInFlight } from '@/app/session/hooks/use-prompt-actions/utils'
import { formatRefValue } from '@/components/assistant-ui/directive-text'
import { contextPath } from '@/lib/chat-runtime'
import type { ComposerAttachmentScope } from '@/store/composer'
import { activeGateway, activeGatewayConnectionId } from '@/store/gateway'
import { $activeGatewayProfile, pinNewChatProfile } from '@/store/profile'
import { exitProjectScope } from '@/store/project-scope'
import { goToProject, requestStartWorkSession } from '@/store/projects'
import {
  $newChatWorkspaceTargetGeneration,
  setCurrentBranch,
  setCurrentCwd,
  setNewChatWorkspaceTarget,
  setWorkspaceCwdOwner
} from '@/store/session'
import {
  $sessionStates,
  knownOwnerForSession,
  requestForOwnedSession,
  sessionTileDelegate
} from '@/store/session-states'

export const $projectBindingSessions = atom<ReadonlySet<string>>(new Set())

export function canSelectDraftProject(view: SessionView): boolean {
  if (view.$busy.get() || !view.$messagesEmpty.get()) {
    return false
  }

  const runtimeId = view.$runtimeId.get()

  if (!runtimeId) {
    return !view.$storedId.get()
  }

  const state = $sessionStates.get()[runtimeId]
  const owner = knownOwnerForSession(runtimeId)
  const profile = typeof owner === 'string' ? owner : owner?.profile

  // Project/file pickers belong to the active source. Never write their path
  // into a draft owned by a different machine or profile.
  return Boolean(
    state?.isUnsentDraft &&
    !state.busy &&
    state.messages.length === 0 &&
    (!profile || profile === $activeGatewayProfile.get()) &&
    (!owner || typeof owner !== 'object' || owner.connectionId === activeGatewayConnectionId())
  )
}

// Capture intent before opening a native chooser/dialog. A late result must
// not move a different chat, or the same draft after it has been sent.
export function captureProjectSelection(view: SessionView, attachments: ComposerAttachmentScope) {
  const runtimeId = view.$runtimeId.get()
  const storedId = view.$storedId.get()
  const generation = $newChatWorkspaceTargetGeneration.get()
  const gateway = activeGateway()
  const profile = $activeGatewayProfile.get()
  const draft = canSelectDraftProject(view)

  const isCurrent = () =>
    activeGateway() === gateway &&
    $activeGatewayProfile.get() === profile &&
    view.$runtimeId.get() === runtimeId &&
    view.$storedId.get() === storedId &&
    $newChatWorkspaceTargetGeneration.get() === generation &&
    (!draft || canSelectDraftProject(view))

  const rebaseFolderReferences = (cwd: string, items = attachments.$attachments.get()) => {
    for (const attachment of items) {
      if (attachment.kind !== 'folder' || !attachment.path) {
        continue
      }

      const relativePath = contextPath(attachment.path, cwd)
      attachments.updateIfCurrent(attachment, {
        detail: relativePath,
        refText: `@folder:${formatRefValue(relativePath)}`
      })
    }
  }

  const select = async (cwd: string | null, projectId?: string) => {
    if (!isCurrent()) {
      return
    }

    if (!draft) {
      if (projectId) {
        goToProject(projectId)
      }

      if (cwd) {
        requestStartWorkSession(cwd, undefined, { openTab: true })
      }

      return
    }

    if (runtimeId) {
      const delegate = sessionTileDelegate()
      const lock = storedId ?? runtimeId

      if (!cwd || !gateway || !delegate || !acquireSubmitInFlight(lock)) {
        return
      }

      $projectBindingSessions.set(new Set([...$projectBindingSessions.get(), runtimeId]))
      const pendingAttachments = attachments.$attachments.get()

      try {
        const info = await requestForOwnedSession<{ cwd: string; branch?: string }>(
          runtimeId,
          (method, params, timeout, signal) => gateway.request(method, params, timeout, signal),
          'session.cwd.set',
          { session_id: runtimeId, cwd }
        )

        if (!isCurrent()) {
          // The backend write still succeeded. Keep surviving occurrences
          // anchored even when this composer is no longer foreground.
          rebaseFolderReferences('', pendingAttachments)

          return
        }

        delegate.updateSession(runtimeId, state => ({ ...state, cwd: info.cwd, branch: info.branch ?? '' }))
        rebaseFolderReferences(info.cwd)

        if (isCurrent() && projectId) {
          goToProject(projectId)
        }
      } finally {
        $projectBindingSessions.set(new Set([...$projectBindingSessions.get()].filter(id => id !== runtimeId)))
        releaseSubmitInFlight(lock)
      }

      return
    }

    if (projectId) {
      goToProject(projectId)
    } else if (!cwd) {
      exitProjectScope()
    }

    pinNewChatProfile(profile)
    rebaseFolderReferences(cwd ?? '')
    setNewChatWorkspaceTarget(cwd)
    setCurrentCwd(cwd ?? '')
    setWorkspaceCwdOwner(null)
    setCurrentBranch('')
  }

  return { isCurrent, select }
}

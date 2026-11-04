import { resolveNewChatOwnerRoute } from '@/store/profile'
import {
  markComposerSelectionDefault,
  setComposerSelectionOwner,
  setCurrentCwdExplicit,
  setCurrentModel,
  setCurrentPlatformOwner,
  setCurrentProvider,
  setCurrentReasoningEffort,
  setCurrentUsage,
  setMessages,
  setNewChatWorkspaceTarget,
  setSessionStartedAt,
  setTurnStartedAt,
  setYoloActive
} from '@/store/session'

export function resetFreshSessionSelection(workspaceTarget: string | null | undefined): void {
  setMessages([])
  setCurrentUsage({ calls: 0, input: 0, output: 0, total: 0 })
  setSessionStartedAt(null)
  setTurnStartedAt(null)
  // A conversation's picker overrides end here. A fast first send must
  // resolve the captured profile's Settings defaults before refresh effects
  // run, without borrowing the previous chat's model or reasoning level.
  const draftOwner = resolveNewChatOwnerRoute()

  if (draftOwner) {
    setComposerSelectionOwner(draftOwner.connectionId, draftOwner.profile)
  }

  markComposerSelectionDefault()
  setCurrentModel('')
  setCurrentProvider('')
  setCurrentPlatformOwner('')
  setCurrentReasoningEffort('')
  setYoloActive(false)
  setNewChatWorkspaceTarget(workspaceTarget)
  // #52589 provenance: only a deliberate string workspace target is an explicit
  // cwd choice. A plain new chat (or a detached `null`) is not — its inherited
  // launch/project workspace must yield to a named profile's configured cwd.
  setCurrentCwdExplicit(typeof workspaceTarget === 'string')
}

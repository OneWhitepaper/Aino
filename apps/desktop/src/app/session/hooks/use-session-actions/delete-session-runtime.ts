import { clearClarifyRequest } from '@/store/clarify'
import { $profiles } from '@/store/profile'
import { clearAllPrompts } from '@/store/prompts'
import { requestForSessionProfile, type SessionOwnerScope } from '@/store/session-request-router'

import type { ClientSessionState } from '../../../types'

import type { SessionActionsOptions } from './types'
import { isSessionGoneError } from './utils'

/** End the owned turn before deleting its durable session; rollback interruption on a real refusal. */
export async function closeRuntimeBeforeSessionDeletion(
  closingRuntimeId: string,
  removedOwner: SessionOwnerScope,
  { requestGateway, updateSessionState }: Pick<SessionActionsOptions, 'requestGateway' | 'updateSessionState'>
): Promise<void> {
  // Deleting a session must END its turn, not just drop the row.
  // `session.close` tears down the runtime but does not walk the
  // interrupt path that releases approval / clarify / sudo / secret
  // waits, so a blocked run could outlive its sidebar row and surface a
  // blocking prompt (and native notification) for a conversation that is
  // gone (#75587). Mark the runtime interrupted first so a
  // blocking-input request already queued on the transport is dropped
  // instead of parking its overlay, then interrupt, then close.
  let previousInterruptState: Pick<ClientSessionState, 'interrupted' | 'needsInput'> | null = null

  updateSessionState(closingRuntimeId, state => {
    previousInterruptState = { interrupted: state.interrupted, needsInput: state.needsInput }

    return { ...state, interrupted: true, needsInput: false }
  })

  try {
    await requestForSessionProfile(removedOwner, requestGateway, 'session.interrupt', {
      session_id: closingRuntimeId
    })
  } catch (error) {
    // A missing runtime has no turn left to stop. Any other failure means
    // deletion cannot safely continue: restore the live state and let the
    // outer rollback put the conversation back in the sidebar.
    if (!isSessionGoneError(error)) {
      updateSessionState(closingRuntimeId, state =>
        previousInterruptState ? { ...state, ...previousInterruptState } : state
      )
      throw error
    }
  }

  // Catch a blocking-input request already queued before the interrupted
  // flag became visible to this renderer.
  clearAllPrompts(closingRuntimeId)
  clearClarifyRequest(undefined, closingRuntimeId)

  await requestForSessionProfile(removedOwner, requestGateway, 'session.close', {
    session_id: closingRuntimeId
  }).catch(() => undefined)
}

/** A listed row with no provable owner must never fall through to the primary backend. */
export function sessionRemovalOwnerUnavailable(
  listed: boolean,
  stampedProfile: string | undefined,
  profile: string | null | undefined
): boolean {
  return listed && !stampedProfile && !profile?.trim() && $profiles.get().filter(item => item.name.trim()).length > 1
}

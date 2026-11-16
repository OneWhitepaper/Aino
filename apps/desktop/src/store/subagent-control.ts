import { translateNow } from '@/i18n'

import { requestForSessionProfile, type SessionOwnerScope } from './session-request-router'
import { $subagentsBySession, reconcileSubagentSnapshot, type SubagentPayload } from './subagents'

export class SubagentControlError extends Error {
  constructor(
    readonly code: 'owner-unavailable' | 'control-unavailable' | 'not-running' | 'request-failed',
    options?: ErrorOptions
  ) {
    super(code, options)
    this.name = 'SubagentControlError'
  }
}

export function subagentControlErrorMessage(error: unknown): string {
  const code = error instanceof SubagentControlError ? error.code : 'request-failed'

  return translateNow(
    code === 'not-running'
      ? 'agents.requestFinished'
      : code === 'control-unavailable' || code === 'owner-unavailable'
        ? 'agents.controlUnavailable'
        : 'agents.requestFailed'
  )
}

/** A rejection can race completion or a parent rebuild. Refresh the same owner before explaining it. */
async function rejectedControl(owner: SessionOwnerScope, sessionId: string, childId: string) {
  const before = $subagentsBySession.get()[sessionId]

  const snapshot = await requestForSessionProfile<{
    subagents: SubagentPayload[]
    delegations?: SubagentPayload[]
  }>(owner, rejectUnowned, 'subagent.list', { session_id: sessionId })

  if (!Array.isArray(snapshot.subagents)) {
    return new SubagentControlError('request-failed')
  }

  if ($subagentsBySession.get()[sessionId] === before) {
    reconcileSubagentSnapshot(sessionId, snapshot.subagents, snapshot.delegations ?? [])
  }

  const child = snapshot.subagents.find(row => row.subagent_id === childId)

  return new SubagentControlError(
    !child || (child.status !== 'running' && child.status !== 'queued') || child.accepting_steer === false
      ? 'not-running'
      : child.can_control === false
        ? 'control-unavailable'
        : 'request-failed'
  )
}

const rejectUnowned = async <T>(): Promise<T> => {
  throw new SubagentControlError('owner-unavailable')
}

export async function sendSubagentControl(
  owner: SessionOwnerScope,
  sessionId: string,
  childId: string,
  action: 'interrupt' | 'steer',
  text?: string
): Promise<void> {
  const child = $subagentsBySession.get()[sessionId]?.find(row => row.id === childId)

  if (child?.canControl === false) {
    throw new SubagentControlError('control-unavailable')
  }

  if (
    child &&
    ((child.status !== 'running' && child.status !== 'queued') ||
      (action === 'steer' && child.acceptingSteer === false))
  ) {
    throw new SubagentControlError('not-running')
  }

  try {
    const result = await requestForSessionProfile<{ found?: boolean; status?: string }>(
      owner,
      rejectUnowned,
      `subagent.${action}`,
      { session_id: sessionId, subagent_id: childId, ...(action === 'steer' ? { text: text?.trim() } : {}) }
    )

    if (action === 'steer' ? result.status !== 'queued' : !result.found) {
      throw await rejectedControl(owner, sessionId, childId)
    }
  } catch (error) {
    throw error instanceof SubagentControlError ? error : new SubagentControlError('request-failed', { cause: error })
  }
}

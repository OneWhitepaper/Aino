import { getSession } from '@/api/sessions'
import { platformModelStatePatch, unboundManagedSessionRow } from '@/lib/platform-session-model'
import type { SessionRuntimeInfo } from '@/types/hermes'

import { samePlatformAccount } from './platform-model-owner'
import { platformModelCatalog } from './platform-models'
import { profileScopeForSessionOwner, type SessionOwnerScope } from './session-request-router'
import { $sessionStates } from './session-states'
import {
  knownOwnerForSession,
  publishSessionState,
  requestForOwnedSession,
  sessionTileDelegate
} from './session-states'

export type PlatformSessionAccess =
  | { kind: 'allowed' }
  | { kind: 'authority_pending' }
  | { kind: 'unbound' }
  | { kind: 'session_owner_pending' }
  | { kind: 'foreign'; ownerUserId: string }

const ALLOWED: PlatformSessionAccess = { kind: 'allowed' }
const AUTHORITY_PENDING: PlatformSessionAccess = { kind: 'authority_pending' }
const UNBOUND: PlatformSessionAccess = { kind: 'unbound' }
const SESSION_OWNER_PENDING: PlatformSessionAccess = { kind: 'session_owner_pending' }
const foreignAccess = new Map<string, PlatformSessionAccess>()

function foreignSessionAccess(ownerUserId: string): PlatformSessionAccess {
  const existing = foreignAccess.get(ownerUserId)

  if (existing) {
    return existing
  }
  const access: PlatformSessionAccess = { kind: 'foreign', ownerUserId }
  foreignAccess.set(ownerUserId, access)

  return access
}

/** Revision refreshes retire authority, never the durable session principal. */
export function platformSessionAccess(sessionId?: string | null): PlatformSessionAccess {
  const model = sessionId ? $sessionStates.get()[sessionId]?.platformModel : undefined

  if (!model) {
    return ALLOWED
  }

  if (!model.ownerUserId && !model.platformOrigin && model.status === 'awaiting_managed_credentials') {
    return UNBOUND
  }

  if (!model.ownerUserId || !model.platformOrigin) {
    return SESSION_OWNER_PENDING
  }
  const owner = platformModelCatalog().owner.state.get().owner

  if (!owner) {
    return AUTHORITY_PENDING
  }

  return model.ownerUserId !== owner.user_id || model.platformOrigin !== owner.platform_origin
    ? foreignSessionAccess(model.ownerUserId)
    : ALLOWED
}

/** Only a positively different principal is foreign; pending remains fail-closed. */
export function platformHistoryOwner(sessionId?: string | null): string | null {
  const access = platformSessionAccess(sessionId)

  return access.kind === 'foreign' ? access.ownerUserId : null
}

/** Only an explicit recovery may claim a never-used staged selection.
 * Native ticket/claim still verifies the current account and owning transport. */
export async function canRecoverUnboundPlatformSession(sessionId: string, owner: SessionOwnerScope): Promise<boolean> {
  if (platformSessionAccess(sessionId).kind !== 'unbound' || !owner || typeof owner !== 'object') {
    return false
  }
  const state = $sessionStates.get()[sessionId]
  const account = platformModelCatalog().account.get()
  const scope = profileScopeForSessionOwner(owner)

  const modelId = state?.platformModel?.modelId

  if (!state?.storedSessionId || !modelId) {
    return false
  }
  const row = await getSession(state.storedSessionId, scope)

  return (
    samePlatformAccount(account, platformModelCatalog().account.get()) &&
    $sessionStates.get()[sessionId] === state &&
    unboundManagedSessionRow(
      row,
      state.storedSessionId,
      {
        connectionId: owner.connectionId,
        profile: owner.targetProfile ?? owner.profile
      },
      modelId
    )
  )
}

export async function refreshPlatformSessionAccess(sessionId: string): Promise<void> {
  const catalog = platformModelCatalog()
  const account = catalog.account.get()
  const state = $sessionStates.get()[sessionId]
  const owner = knownOwnerForSession(sessionId)

  await catalog.owner.load()

  if (!state || !owner || !samePlatformAccount(account, catalog.account.get())) {
    return
  }

  const result = await requestForOwnedSession<{ session_info?: SessionRuntimeInfo }>(
    sessionId,
    () => Promise.reject(new Error('Session owner unavailable')),
    'model.options',
    {
      session_id: sessionId,
      include_session_info: true,
      explicit_only: true
    }
  )

  const patch = platformModelStatePatch(result.session_info)

  if (
    !samePlatformAccount(account, catalog.account.get()) ||
    $sessionStates.get()[sessionId] !== state ||
    !patch.platformModel?.ownerUserId ||
    !patch.platformModel.platformOrigin
  ) {
    return
  }

  const update = (current: typeof state) => ({ ...current, ...patch })
  const delegate = sessionTileDelegate()

  if (delegate) {
    delegate.updateSession(sessionId, update)
  } else {
    publishSessionState(sessionId, update(state))
  }
}

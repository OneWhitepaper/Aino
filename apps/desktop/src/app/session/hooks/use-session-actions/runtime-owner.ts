// Runtime-info ownership for applyRuntimeInfo: approval caches belong to the
// exact source/profile that produced the runtime, including background tiles.
import { reconcileApprovalModeForProfile } from '@/store/approval-mode'
import { activeGatewayConnectionId } from '@/store/gateway'
import { $activeGatewayProfile, normalizeProfileKey } from '@/store/profile'
import type { SessionOwnerRoute, SessionOwnerScope } from '@/store/session-request-router'
import type { SessionRuntimeInfo } from '@/types/hermes'

/** Captured owners never borrow the connection/profile active at completion. */
export function reconcileOwnerApprovalMode(info: SessionRuntimeInfo, owner: SessionOwnerScope): void {
  if (info.approval_mode === undefined) {
    return
  }

  if (typeof owner === 'string') {
    reconcileApprovalModeForProfile(normalizeProfileKey(owner), info.approval_mode)

    return
  }

  if (owner) {
    reconcileApprovalModeForProfile(runtimeOwnerProfile(owner, owner.profile), info.approval_mode, owner.connectionId)

    return
  }

  reconcileApprovalModeForProfile($activeGatewayProfile.get(), info.approval_mode, activeGatewayConnectionId())
}

/** applyRuntimeInfo options for a runtime that must NOT publish into the main
 *  pane's composer (a session tile, a background branch): the owner is the
 *  create's route when the caller dialled one, else its profile. */
export function backgroundRuntimeOptions(
  route: null | SessionOwnerRoute | undefined,
  profile: null | string | undefined
): { foreground: false; owner: SessionOwnerScope } {
  return { foreground: false, owner: runtimeOwner(route, profile) }
}

/** The owner of a create's runtime: the dialled route, else its profile. */
export function runtimeOwner(
  route: null | SessionOwnerRoute | undefined,
  profile: null | string | undefined
): SessionOwnerScope {
  return route ?? profile
}

/** The profile a create's runtime lives in: the dialled route's backend
 *  profile, else the requested one. */
export function runtimeOwnerProfile(route: null | SessionOwnerRoute | undefined, profile: string): string {
  return route ? route.targetProfile || route.profile : profile
}

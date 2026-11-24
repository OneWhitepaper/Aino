import { type GatewayEvent, registryBackendScopeKey } from '@hermes/shared'

import type { HermesConnection } from '@/global'
import { RECONNECT_ATTEMPT_TIMEOUT_MS, SOURCE_SWITCH_DIAL_TIMEOUT_MS, withTimeout } from '@/lib/with-timeout'

import {
  type ManagedModelRoute,
  recordGatewayReadyCapability,
  resetGatewayManagedCapability
} from './gateway-managed-capability'

// True when `profile`'s backend route resolves to the SHARED primary backend
// (global-remote case 3 in resolveProfileBackendRoute). Both shared-primary and
// pooled descriptors carry `profile` so WebSocket URL minting targets the right
// profile. `sharedPrimary` is the explicit discriminator; treating every tagged
// descriptor as shared strands local/own-remote pooled profiles on the default
// socket. Dialing a second socket at the shared descriptor is wrong — over SSH
// the second dial fails (tunnel/token are per-backend) and the closed socket
// poisons the active gateway with "not connected" even though the primary is
// open right next to it.
//
// A failed or timed-out lookup REJECTS; it never answers "not shared". On main
// every local profile rides the primary's one multiplexing gateway, and the
// lookup is slow exactly when that gateway is still booting — reading the
// timeout as "not shared" dialed a secondary whose own getConnection joined the
// same boot for another 20 s, then opened a second socket at the shared process
// (#120005). Callers surface the rejection as the switch/request failure.
export async function sharedPrimaryRoute(profile: string): Promise<boolean> {
  return (await sharedPrimaryConnection(profile)) !== null
}

/** `profile`'s descriptor when it rides the shared primary backend, else null. */
export async function sharedPrimaryConnection(profile: string): Promise<HermesConnection | null> {
  const desktop = window.hermesDesktop

  if (!desktop) {
    return null
  }

  // Unbounded IPC round-trip into main (#93454): bound it so a wedge rejects.
  const conn = await withTimeout(
    desktop.getConnection(profile),
    RECONNECT_ATTEMPT_TIMEOUT_MS,
    `Timed out resolving the shared-primary route for profile "${profile}"`
  )

  return conn?.sharedPrimary === true ? conn : null
}

/** True when `connectionId` is the window's already-attached source AND main
 *  says `profile` rides the backend that source's primary socket is already
 *  connected to — a one-host-many-profiles remote (`sharedRemote`, #96493) or
 *  the one local host backend that serves every local profile under
 *  multiplex-only (`sharedPrimary`, #118246). Either way a registry secondary
 *  would be a SECOND WebSocket to the SAME process: on a remote it accept/closes
 *  in ~30ms and never runs `session.create`; on the local host backend it joins
 *  the chat's transport fan-out and the renderer receives every event twice
 *  (garbled streaming text + a duplicate interim bubble, #120005). Isolated
 *  SSH/pooled backends (neither flag) still get their own secondary. */
export async function sharedRegistryPrimaryRoute(
  owner: PrimaryIdentity,
  mode: 'local' | 'remote' | null,
  connectionId: null | string,
  profile: string
): Promise<boolean> {
  const id = String(connectionId ?? '').trim()
  const key = String(profile ?? '').trim() || 'default'

  if (!id || id !== owner.connectionId) {
    return false
  }

  if (key === owner.profile) {
    return false
  }

  const desktop = window.hermesDesktop

  if (!desktop?.getConnectionFor) {
    return false
  }

  // Resolve per call: only main can distinguish a shared owner from an
  // isolated pool. A local cold boot needs the same budget as the pool dial.
  let conn: HermesConnection | null

  try {
    conn = await withTimeout(
      desktop.getConnectionFor({ connectionId: id, profile: key }),
      mode === 'local' ? SOURCE_SWITCH_DIAL_TIMEOUT_MS : RECONNECT_ATTEMPT_TIMEOUT_MS,
      `Timed out resolving the backend route for "${key}"`
    )
  } catch (error) {
    // Guessing a local owner can mint on the wrong process, while a second
    // dial can duplicate the host socket. A failed remote probe may ride the
    // primary, but is not evidence of managed-model support.
    if (mode === 'local') {
      throw error
    }

    return notePrimaryRider(owner, { connectionId: id, profile: key }, true, false)
  }

  // Keep stale-owner rejection outside the probe fallback.
  return notePrimaryRider(
    owner,
    { connectionId: id, profile: key },
    conn?.sharedRemote === true || conn?.sharedPrimary === true
  )
}

// Scopes whose last route resolution rode the primary socket (shared primary /
// shared remote). A HINT for passive readers only (gateway.ts gatewayRouteState);
// requests still resolve the route per call. Each hint is bound to the primary
// socket + connection it was learned on: after a soft re-home the same profile
// may live on another backend, so a hint from the old primary must not key it
// as `primary:<profile>` under the new one.
export interface PrimaryIdentity {
  connectionId: null | string
  gateway: unknown
  profile: string
}

interface PrimaryRider {
  confirmed: boolean
  owner: PrimaryIdentity
  route: ManagedModelRoute
}

const primaryRiders = new Map<string, PrimaryRider>()
let currentPrimary: PrimaryIdentity | null = null
let primaryReady: { owner: PrimaryIdentity; event: GatewayEvent } | null = null

function samePrimary(left: PrimaryIdentity, right: PrimaryIdentity): boolean {
  return left.gateway === right.gateway && left.connectionId === right.connectionId && left.profile === right.profile
}

export function notePrimaryRider(
  owner: PrimaryIdentity,
  route: ManagedModelRoute,
  rides: boolean,
  confirmed = true
): boolean {
  // Before the primary socket has been installed there is no route identity
  // to compare against. This is the normal startup path for a secondary
  // profile: let it continue to its own backend. Once a primary exists, a
  // changed owner is a real re-home race and must still abort the stale probe.
  if (currentPrimary && !samePrimary(owner, currentPrimary)) {
    throw new Error('Gateway route changed while resolving the profile; retry the request')
  }

  const scope = registryBackendScopeKey(route.connectionId, route.profile)

  if (rides) {
    primaryRiders.set(scope, { confirmed, owner, route })

    // A shared descriptor proves socket ownership, not managed-model support.
    // Only the ready event belonging to that exact primary is transferable.
    if (confirmed && primaryReady && samePrimary(primaryReady.owner, owner)) {
      recordGatewayReadyCapability(route, primaryReady.event)
    } else {
      resetGatewayManagedCapability(route)
    }
  } else {
    if (primaryRiders.has(scope)) {
      resetGatewayManagedCapability(route)
    }

    primaryRiders.delete(scope)
  }

  return rides
}

export function isPrimaryRider(scope: string, current: PrimaryIdentity): boolean {
  const rider = primaryRiders.get(scope)

  return Boolean(rider && samePrimary(rider.owner, current))
}

export function recordPrimaryReadyCapability(owner: PrimaryIdentity, event: GatewayEvent): void {
  if (event.type !== 'gateway.ready' || !currentPrimary || !samePrimary(owner, currentPrimary)) {
    return
  }

  primaryReady = { owner, event }
  recordGatewayReadyCapability(owner, event)

  for (const rider of primaryRiders.values()) {
    if (rider.confirmed && samePrimary(rider.owner, owner)) {
      recordGatewayReadyCapability(rider.route, event)
    }
  }
}

/** Profile adoption after connect keeps the same socket's ready evidence. A
 * different socket or source needs its own ready and fresh route probes. */
export function setPrimaryManagedCapabilityOwner(owner: PrimaryIdentity): void {
  const previous = currentPrimary

  if (previous && samePrimary(previous, owner)) {
    return
  }

  const adoptingProfile = Boolean(
    previous?.gateway && previous.gateway === owner.gateway && previous.connectionId === owner.connectionId
  )

  const ready =
    adoptingProfile && primaryReady && previous && samePrimary(primaryReady.owner, previous) ? primaryReady.event : null

  if (previous) {
    resetPrimaryManagedCapability(previous)

    for (const [scope, rider] of primaryRiders) {
      if (samePrimary(rider.owner, previous)) {
        if (adoptingProfile) {
          primaryRiders.set(scope, { ...rider, owner })
        } else {
          primaryRiders.delete(scope)
        }
      }
    }
  }

  currentPrimary = owner
  resetGatewayManagedCapability(owner)

  if (ready) {
    recordPrimaryReadyCapability(owner, ready)
  }
}

export function resetPrimaryManagedCapability(owner: PrimaryIdentity): void {
  if (primaryReady && samePrimary(primaryReady.owner, owner)) {
    primaryReady = null
  }

  resetGatewayManagedCapability(owner)

  for (const rider of primaryRiders.values()) {
    if (samePrimary(rider.owner, owner)) {
      resetGatewayManagedCapability(rider.route)
    }
  }
}

import { type GatewayEvent, registryBackendScopeKey } from '@hermes/shared'

import { RECONNECT_ATTEMPT_TIMEOUT_MS, withTimeout } from '@/lib/with-timeout'

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
export async function sharedPrimaryRoute(profile: string): Promise<boolean> {
  const desktop = window.hermesDesktop

  if (!desktop) {
    return false
  }

  try {
    // Unbounded IPC round-trip into main (#93454) — a wedge here must reject
    // like any other failure, not hang the route decision forever, since
    // every caller (gatewayForProfile → requestGatewayForProfile/Agent) awaits
    // this before it can fall back to dialing a secondary.
    const conn = await withTimeout(
      desktop.getConnection(profile),
      RECONNECT_ATTEMPT_TIMEOUT_MS,
      `Timed out resolving the shared-primary route for profile "${profile}"`
    )

    return Boolean(conn && typeof conn === 'object' && (conn as { sharedPrimary?: boolean }).sharedPrimary === true)
  } catch {
    return false
  }
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

  // Resolved per call, never cached: main answers the route per request
  // (`resolveProfileBackendRoute` case 6 keeps a pooled backend for
  // `HERMES_DESKTOP_ISOLATED_BACKEND=1`), and for a pooled profile this is the
  // same dial `openSecondary` makes next, coalesced by main's claim key.
  try {
    const conn = await withTimeout(
      desktop.getConnectionFor({ connectionId: id, profile: key }),
      RECONNECT_ATTEMPT_TIMEOUT_MS,
      `Timed out resolving the backend route for "${key}"`
    )

    const flags =
      conn && typeof conn === 'object' ? (conn as { sharedPrimary?: boolean; sharedRemote?: boolean }) : null

    return notePrimaryRider(
      owner,
      { connectionId: id, profile: key },
      flags?.sharedRemote === true || flags?.sharedPrimary === true
    )
  } catch {
    // Probe failed on a remote (or not-yet-classified) primary: a secondary at
    // this already-attached source is the #96493 ghost WebSocket (accept/close,
    // messages=1), so prefer the primary until a later probe can prove
    // isolation (`sharedRemote: false`). A LOCAL primary must NOT get that
    // fallback: when main routes the profile to a pooled child (isolated
    // backend), the primary would still ACCEPT a `profile`-tagged
    // session.create (profile_home multiplexing) and mint the session under
    // its own pid, but the exact-owner route names the pool backend — after a
    // renderer reload or a pool respawn the resume dials that backend and is
    // refused SESSION_NOT_OWNED by a pid of the same Desktop (#101416).
    return notePrimaryRider(owner, { connectionId: id, profile: key }, mode !== 'local', false)
  }
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

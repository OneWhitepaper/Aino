/**
 * Recycle the backend behind a code-skew 503 ("Restart required" after `hermes update`).
 *
 * Closing the local tunnel/child is not enough for SSH: `serve --isolated`
 * detaches with setsid/nohup, so a reconnect would reuse the still-alive
 * stale process via the lockfile. Kill the owned remote serve first (while
 * the SSH channel can still exec), then tear down the local child — the
 * same order as connection apply (#97046, #91668).
 *
 * A LOCAL profile attaches to the per-host gateway (`hermes gateway ensure`),
 * which Desktop never owns: dropping its descriptor only re-attached the same
 * stale process. `restartLocalGateway` runs a supervised
 * `hermes --profile P gateway restart` (a no-op for a remote profile) before
 * the descriptor drop, so the next ensure dials the replacement.
 */

import { type ProfileBackendRoute, type ProfileRouteOptions, resolveProfileBackendRoute } from './connection-config'
import { type GatewayEndpoint, gatewayOwnerProfile } from './local-gateway'
import { localProfilePoolKeys } from './profile-delete-routing'

export type RecycleOwnedBackendTarget = 'pool' | 'primary'

export interface RecycleOwnedBackendDeps {
  duringRecycle: (run: () => Promise<void>) => Promise<void>
  notifyApplied: () => void
  primaryProfile: string
  profile?: null | string
  route?: ProfileBackendRoute
  restartLocalGateway: (profile: string) => Promise<boolean | void>
  teardownPool: (profile: string) => Promise<void>
  teardownPrimary: () => Promise<void>
  teardownSsh: (profile: string) => Promise<void>
}

export function recycleOwnedBackendTarget(
  profile: null | string | undefined,
  primaryProfile: string
): RecycleOwnedBackendTarget {
  const key = String(profile ?? '').trim()

  return !key || key === primaryProfile ? 'primary' : 'pool'
}

export async function recycleOwnedBackend(deps: RecycleOwnedBackendDeps): Promise<RecycleOwnedBackendTarget> {
  let target = deps.route?.backend ?? recycleOwnedBackendTarget(deps.profile, deps.primaryProfile)
  const profile = String(deps.profile ?? '').trim()

  await deps.duringRecycle(async () => {
    if (target === 'primary') {
      await deps.teardownSsh('')
      await deps.restartLocalGateway(deps.primaryProfile)
      await deps.teardownPrimary()

      return
    }

    await deps.teardownSsh(profile)
    const primaryAffected = await deps.restartLocalGateway(profile)
    await deps.teardownPool(profile)

    if (primaryAffected) {
      await deps.teardownPrimary()
      target = 'primary'
    }
  })

  if (target === 'primary') {
    deps.notifyApplied()
  }

  return target
}

interface ProfileBackendRecyclerDeps extends Omit<
  RecycleOwnedBackendDeps,
  'duringRecycle' | 'primaryProfile' | 'profile' | 'route'
> {
  duringLocalRecycle: RecycleOwnedBackendDeps['duringRecycle']
  primaryProfile: () => string
  primaryRemote: () => boolean
  profileRouteOptions: (profile: string) => ProfileRouteOptions
}

export function createProfileBackendRecycler(deps: ProfileBackendRecyclerDeps) {
  const { duringLocalRecycle, primaryProfile, primaryRemote, profileRouteOptions, ...callbacks } = deps

  return (profile: unknown): Promise<RecycleOwnedBackendTarget> => {
    const requestedProfile = typeof profile === 'string' ? profile.trim() : ''
    const options = profileRouteOptions(requestedProfile)
    const route = resolveProfileBackendRoute(requestedProfile, options)
    const remote = route.backend === 'primary' ? primaryRemote() : options.profileRemoteOverride || options.globalRemote

    return recycleOwnedBackend({
      ...callbacks,
      duringRecycle: run => (remote ? run() : duringLocalRecycle(run)),
      primaryProfile: primaryProfile(),
      profile: requestedProfile,
      route
    })
  }
}

interface AttachedGatewayConnection {
  gatewayEndpoint?: GatewayEndpoint
}

interface AttachedGatewayPoolEntry {
  connectionPromise: Promise<AttachedGatewayConnection>
  gatewayEndpoint?: GatewayEndpoint | null
}

interface AttachedGatewayRestarterDeps {
  pool: Map<string, AttachedGatewayPoolEntry>
  primaryConnection: () => Promise<AttachedGatewayConnection> | null
  primaryProfile: () => string
  restartOwner: (profile: string) => Promise<void>
}

/** Read the attached owner before dropping descriptors; remote entries never own a local gateway. */
export function createAttachedLocalGatewayRestarter(deps: AttachedGatewayRestarterDeps) {
  return async (profile: string): Promise<boolean> => {
    const selectedPrimary = profile === deps.primaryProfile()

    const pending = selectedPrimary
      ? deps.primaryConnection()
      : localProfilePoolKeys(profile)
          .map(key => deps.pool.get(key)?.connectionPromise)
          .find(Boolean)

    const connection = await pending?.catch(() => null)
    const endpoint = connection?.gatewayEndpoint

    if (!endpoint) {
      return false
    }

    const primary = selectedPrimary ? connection : await deps.primaryConnection()?.catch(() => null)
    await deps.restartOwner(gatewayOwnerProfile(endpoint))

    for (const [key, entry] of deps.pool) {
      if (entry.gatewayEndpoint?.instance_id === endpoint.instance_id) {
        deps.pool.delete(key)
      }
    }

    return primary?.gatewayEndpoint?.instance_id === endpoint.instance_id
  }
}

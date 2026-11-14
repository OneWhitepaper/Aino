import type { BackendConnectionState } from './backend-connection-state'

/**
 * Ownership helpers for the main-process descriptor cache (`backendPool` in
 * main.ts): keyed promises for gateway connection descriptors, never process
 * handles. A dial yields at the `gateway ensure` / update-clearance awaits, so
 * a profile delete, a retirement, or a faster sibling dial can replace or
 * forget the entry underneath it. Both helpers compare by identity so the
 * loser of that race can neither evict the winner nor resurrect itself.
 */

export interface BackendDescriptorEntry {
  connectionPromise: Promise<unknown> | null
}

export function newPoolEntry() {
  return { connectionPromise: null, gatewayEndpoint: null, remoteBaseUrl: null }
}

interface LocalGatewayDescriptor {
  gatewayEndpoint?: object
}

/** A failed ticket belongs to its exact cached endpoint, not a later ensure of the same route. */
export async function forgetStalePrimaryGatewayDescriptor<TProcess, TConnection extends LocalGatewayDescriptor>(
  state: BackendConnectionState<TProcess, TConnection>,
  failed: TConnection
): Promise<boolean> {
  const attempt = state.startAttempt()
  attempt.promise = state.getPromise()

  if (!attempt.promise || !failed.gatewayEndpoint) {
    return false
  }

  const current = await attempt.promise

  return current.gatewayEndpoint === failed.gatewayEndpoint && state.clearPromiseForAttempt(attempt)
}

export async function forgetStalePooledGatewayDescriptor<TConnection extends LocalGatewayDescriptor>(
  cache: Map<string, { connectionPromise: Promise<TConnection> | null }>,
  key: string,
  failed: TConnection
): Promise<boolean> {
  const entry = cache.get(key)

  if (!entry?.connectionPromise || !failed.gatewayEndpoint) {
    return false
  }

  const current = await entry.connectionPromise

  return cache.get(key) === entry && current.gatewayEndpoint === failed.gatewayEndpoint && cache.delete(key)
}

/** Drop a failed entry — only if it is still the installed one. */
export function forgetFailedDescriptor<TEntry extends BackendDescriptorEntry>(
  cache: Map<string, TEntry>,
  key: string,
  entry: TEntry
): void {
  if (cache.get(key) === entry) {
    cache.delete(key)
  }
}

/** Refuse to complete a dial whose entry is no longer the installed one. */
export function assertDescriptorStillOwned<TEntry extends BackendDescriptorEntry>(
  cache: Map<string, TEntry>,
  key: string,
  entry: TEntry
): void {
  if (cache.get(key) !== entry) {
    throw new Error(`Profile backend start for "${key}" was cancelled before spawn.`)
  }
}

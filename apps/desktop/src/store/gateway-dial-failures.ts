import { isGatewayReauthRequired, reconnectBackoffDelayMs } from '@hermes/shared'
// Dial failures the secondary redial ladder (store/gateway.ts reconnectSecondary)
// treats as permanent for a scoped socket, and the stalled dials it budgets.

import { isTimeoutError } from '@/lib/with-timeout'

import type { Secondary } from './gateway-socket-entry'

export interface GatewayDialFailure {
  at: number
  streak: number
  connectionId: null | string
  ownerProbe?: boolean
}

// Electron's getConnectionFor rejects with `No connection with id "…"` when
// the registry entry is gone. That is a permanent condition for the scoped
// socket, unlike transient transport errors.
export function isMissingConnectionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')

  return message.includes('No connection with id')
}

// Electron's spawn guard (assertLocalProfileCanStart) rejects with these when
// the profile's directory is gone or its DELETE is still in flight. For a
// renderer socket that condition is permanent: the backend it reconnects to
// can never come back, and every retry hammers the guard (#88769).
export function isMissingProfileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')

  return message.includes('no longer exists') || message.includes('is being deleted')
}

// A dial that waited out its budget (or a backend slot) rather than failing fast. The secondary
// ladder parks a scope after SECONDARY_STALLED_DIAL_BUDGET of these in a row (#103375).
export function isStalledDialError(error: unknown): boolean {
  if (isTimeoutError(error)) {
    return true
  }

  const message = error instanceof Error ? error.message : String(error ?? '')

  return message.includes('timed out while waiting for a free slot')
}

export function recordDialFailure(
  failures: Map<string, GatewayDialFailure>,
  entry: Pick<Secondary, 'connectionId' | 'scope'>,
  error?: unknown,
  ownerProbe = false
): void {
  // Auth rejection has its own ledger (reauthFailures) that already fails background callers fast.
  if (error !== undefined && isGatewayReauthRequired(error)) {
    return
  }

  const previous = failures.get(entry.scope)

  failures.set(entry.scope, {
    at: Date.now(),
    ownerProbe,
    streak: (previous?.streak ?? 0) + 1,
    connectionId: entry.connectionId ?? null
  })
}

/** True while a background caller must leave redialing to the ladder: the scope's last dial
 *  failed (or its socket died before RECONNECT_STABLE_OPEN_MS) inside a window that widens with
 *  the failure streak, on the same ceilings as the reconnect ladder. History clears on proof of
 *  health (a served RPC, or a socket that lived) and on a fresh start (foreground re-arm, connection
 *  removal, full teardown) — never on a bare open, so an accept-then-close backend keeps escalating. */
export function backgroundDialCoolingDown(
  failures: Map<string, GatewayDialFailure>,
  scope: string,
  now = Date.now()
): boolean {
  const failure = failures.get(scope)

  return failure !== undefined && now - failure.at < reconnectBackoffDelayMs(failure.streak - 1, { jitter: false })
}

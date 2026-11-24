import {
  $backendTransitions,
  BACKEND_TRANSITION_MAX_MS,
  backendTransitionFor,
  changesBackend,
  waitForBackendTransitionEnd
} from './backend-transition'
import { launcherPluginFor, probeLauncherTransition } from './launcher-transition'

const GATEWAY_TRANSPORT_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_NETWORK',
  'ERR_SOCKET_CLOSED'
])

function errorCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const code = (value as { code?: unknown }).code

  return typeof code === 'string' ? code.toUpperCase() : null
}

const HEARTBEAT_TIMEOUT_RE = /heartbeat acknowledgement timed out/i

/**
 * The requests sent again after a planned transition although the backend may
 * already have answered them: each only reads, or attaches a stored chat again
 * with the same result. A method that is not listed is not sent again.
 */
export const READS_SENT_AGAIN: ReadonlySet<string> = new Set(['session.history', 'session.resume'])

const NEVER_SENT_RE = /not connected/i

const hasKey = (value: unknown) => typeof value === 'string' && value !== ''

/**
 * Whether a request the transport cut can be sent a second time without
 * running anything twice: the socket was down before it was written, it is
 * one of the listed reads, or it carries a key by which the backend
 * recognises a request it has already taken.
 */
function safeToSendAgain(message: string, method: string, params: Record<string, unknown>): boolean {
  return (
    NEVER_SENT_RE.test(message) ||
    READS_SENT_AGAIN.has(method) ||
    hasKey(params.submission_id) ||
    hasKey(params.input_id)
  )
}

/**
 * Whether a request the transport failed is sent again once the connection is
 * back. During a planned transition of the profile's backend (a plugin
 * restarting or switching it): only a request that is safe to send twice, and
 * only when the transition ends as planned. The backend that held any other
 * request may have run it (a paid generation, a background task), so its
 * caller gets the error. Otherwise a closed or refused connection is retried
 * as before, and a heartbeat timeout is not: the socket went silent, so the
 * backend may be alive and may have run the request, and the caller gets the
 * error to decide.
 */
export interface BackendRequestOwner {
  connectionId: null | string
  profile: string
  mode?: 'local' | 'remote' | null
}

/** Owner-routed requests recover only an explicitly planned transition. */
export async function waitForPlannedBackendRecovery(
  error: unknown,
  owner: BackendRequestOwner,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<boolean> {
  if (
    !isGatewayTransportError(error) ||
    (!owner.connectionId && owner.mode === 'remote' && !launcherPluginFor(owner.profile))
  ) {
    return false
  }

  const { connectionId, profile } = owner

  const planned =
    backendTransitionFor(profile, connectionId) || (await probeLauncherTransition(profile, undefined, connectionId))

  const message = error instanceof Error ? error.message : String(error)

  // Starting/stopping can replace the persistence authority. A submission key
  // deduplicates a restart, not a different backend that has never seen it.
  const replacement = changesBackend(backendTransitionFor(profile, connectionId)?.kind)

  if (
    !planned ||
    !safeToSendAgain(message, method, params) ||
    (replacement && !NEVER_SENT_RE.test(message) && !READS_SENT_AGAIN.has(method))
  ) {
    return false
  }

  // A later switch can replace a restart while the request waits. Its key
  // belongs to the old authority even if the switch eventually reports success.
  let replaced = replacement

  const off = $backendTransitions.listen(() => {
    replaced ||= changesBackend(backendTransitionFor(profile, connectionId)?.kind)
  })

  try {
    const ended = await waitForBackendTransitionEnd(profile, BACKEND_TRANSITION_MAX_MS, connectionId, signal)
    signal?.throwIfAborted()

    return ended && (!replaced || NEVER_SENT_RE.test(message) || READS_SENT_AGAIN.has(method))
  } finally {
    off()
  }
}

export async function sentAgainAfterReconnect(
  error: unknown,
  owner: BackendRequestOwner,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<boolean> {
  const { connectionId, profile } = owner

  const legacyRemote = !connectionId && owner.mode === 'remote' && !launcherPluginFor(profile)

  const planned =
    !legacyRemote &&
    (backendTransitionFor(profile, connectionId) || (await probeLauncherTransition(profile, undefined, connectionId)))

  if (planned) {
    return waitForPlannedBackendRecovery(error, owner, method, params, signal)
  }

  const message = error instanceof Error ? error.message : String(error)

  return !HEARTBEAT_TIMEOUT_RE.test(message)
}

export function isGatewayTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)

  // A heartbeat timeout invalidated the socket: a transport loss like a close (sentAgainAfterReconnect
  // decides whether its request is sent again).
  if (
    /not connected|connection closed|connection reset|ECONNRESET/i.test(message) ||
    HEARTBEAT_TIMEOUT_RE.test(message)
  ) {
    return true
  }

  const cause = typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : undefined

  return [error, cause].some(value => {
    const code = errorCode(value)

    return code !== null && GATEWAY_TRANSPORT_ERROR_CODES.has(code)
  })
}

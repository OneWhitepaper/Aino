import type { HermesConnection } from '@/global'
import type { HermesGateway } from '@/hermes'

// How long ensureActiveGatewayOpen waits out an in-flight secondary
// activation before reporting the gateway as unavailable.
export const ACTIVE_GATEWAY_OPEN_WAIT_MS = 8_000

/** One secondary (pool) socket the gateway registry (store/gateway.ts) keeps. */
export interface Secondary {
  /** Scope key from registryBackendScopeKey(connectionId, profile). */
  scope: string
  profile: string
  /** Registry connection serving this socket; null = the local/legacy path. */
  connectionId: null | string
  connection: HermesConnection | null
  gateway: HermesGateway
  /**
   * Date.now() of the most recent socket 'open'. The live-work pruner's
   * min-lifetime grace reads this: an idle prune can race an on-demand dial
   * (prune → redial → prune) and close freshly opened sockets before their
   * consumer registers in the keep-set, re-triggering the orphan-reap /
   * remount loop (#94769). 0 = never opened.
   */
  lastOpenedAt: number
  /** Last routed activity, for Aino idle socket eviction. */
  lastActivityAt: number
  /** Date.now() of the CURRENT socket's 'open'; null while not open. Stability
   *  clock for the backoff reset (#83134) — `lastOpenedAt` persists across
   *  closes and would make every failed redial look like a stable session. */
  openedAt: null | number
  activeRequests: number
  connectPromise: Promise<void> | null
  offEvent: () => void
  offRequest: () => void
  offState: () => void
  reconnectTimer: ReturnType<typeof setTimeout> | null
  reconnectAttempt: number
  /**
   * Consecutive unanswered wake-probe pings on this entry's current socket;
   * drives the same streak tolerance the primary's probe applies
   * (decideLivenessForceClose). Reset on every answered probe and on every
   * fresh socket open.
   */
  livenessProbeFailures: number
  /** Pending deferred liveness re-probe after an in-flight-work deferral. */
  livenessReprobeTimer: ReturnType<typeof setTimeout> | null
  /** Consecutive automatic dials that stalled (slot wait / dial timeout)
   *  rather than failing fast; see SECONDARY_STALLED_DIAL_BUDGET. */
  stalledDials: number
  reconnecting: boolean
  /** A material connection edit is waiting for live owners to drain. */
  pendingConnectionRedial: boolean
  /**
   * True when a foreground/prewarmed consumer owns this entry beyond one RPC.
   * Guards ONLY the dispose-at-refcount-0 paths (request/relay leases), never
   * the live-work pruner: it is a one-way latch that every hover pre-warm and
   * profile switch sets and nothing ever clears, so honoring it in
   * pruneSecondaryGateways would pin every socket ever warmed. A foreground
   * surface that must keep its owner socket (a mounted session tile, the
   * primary thread) is represented in the pruner's keep-set instead — see
   * foregroundSessionScopes in store/session-states (#93892).
   */
  retained: boolean
  /**
   * Bot-relay retainers pinning this socket open across drain ticks (#93594).
   * The relay's drain loop RPCs every registered connection on an interval;
   * without retention each tick dialed and tore down a fresh WebSocket per
   * connection (refcount hit 0 → dispose). Counted, not boolean, so relay
   * retention can never clobber (or be clobbered by) the foreground
   * `retained` flag. Only non-local registry routes are ever counted here —
   * see retainGatewayForRelay.
   */
  relayRetainCount: number
  // While true the entry auto-reconnects on drop; pruning flips it off so a
  // deliberate close doesn't trigger the backoff loop.
  wantOpen: boolean
  /**
   * Epoch-ms deadline while an activation (prepare/ensure) is mid-dial. The
   * live-work pruner must not dispose an entry the user is switching to: a
   * switch target is not yet the active key, has no live sessions and holds
   * no request lease, so during a cold pool spawn (~3s) every prune recompute
   * saw it as idle garbage and disposed it mid-dial — the root of the dead
   * profile clicks in #89622. Cleared when the activation settles; bounded so
   * an orphaned lease self-heals.
   */
  activationLeaseUntil: number
}

/** Order a transcript read behind every existing socket that could replay its session. */
export function pendingGatewaySessionReplay(
  primaryGateway: HermesGateway | null,
  secondaries: Iterable<Secondary>,
  runtimeId: string
): Promise<boolean> | undefined {
  const reconnectable = [...secondaries].filter(entry => entry.wantOpen)
  const clients = new Set([primaryGateway, ...reconnectable.map(entry => entry.gateway)])

  // A closed socket's false means only that IT cannot replay yet. When another
  // open socket already serves this runtime, that socket orders the read.
  const servedOpen = [...clients].some(
    client => client?.connectionState === 'open' && client?.getSeqWatermarks?.()[runtimeId] != null
  )

  const pending = [...clients].flatMap(client => {
    if (servedOpen && client?.connectionState !== 'open') {
      return []
    }

    // A dev-HMR survivor can predate the barrier method.
    const barrier = client?.sessionReplayBarrier?.(runtimeId)

    return barrier ? [barrier] : []
  })

  return pending.length ? Promise.all(pending).then(results => results.every(Boolean)) : undefined
}

// A deferred liveness re-probe for one entry: cleared when the probe is
// answered, the socket is redialed (fresh streak), or the entry is disposed.
export function clearSecondaryLivenessReprobe(entry: Secondary): void {
  if (entry.livenessReprobeTimer !== null) {
    clearTimeout(entry.livenessReprobeTimer)
    entry.livenessReprobeTimer = null
  }
}

export function isLegacySecondary(entry: Secondary): boolean {
  // Every v2 registry route is created with an explicit connection id,
  // including the registry's `local` source. A missing id is reserved for the
  // old profile-only pool; the loose null check also retires HMR entries from
  // builds that predate the field instead of leaving an old legacy socket
  // behind during a mode apply.
  return entry.connectionId == null
}

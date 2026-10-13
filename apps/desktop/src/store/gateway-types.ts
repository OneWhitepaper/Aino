import { type GatewayEvent, type ServerRequest } from '@hermes/shared'
import type { atom } from 'nanostores'

import type { HermesConnection } from '@/global'
import type { HermesGateway } from '@/hermes'

// Spawn-slot priority handed to Electron main with every backend dial. A
// user-initiated open is 'foreground' and may take the pool's reserved slot;
// roster hydration, hover prewarm and untagged dials are 'background' — main's
// default, so background dials keep the pre-priority IPC payload shape.
export type SpawnPriority = 'foreground' | 'background'

export interface RegistryConfig {
  /** Electron's published descriptor is authoritative for a primary gateway's
   * registry identity. Kept as a getter so gateway.ts does not own or duplicate
   * the connection store. */
  activeConnectionId?: () => null | string
  onEvent: (event: GatewayEvent) => void
  /** Server→client request (clarify, approval, …) from ANY socket the registry owns; the
   *  request's `respond` already routes to the socket it came from. `profile` /
   *  `connectionId` tag the source the same way events are tagged. */
  onServerRequest?: (request: ScopedServerRequest) => void
  onActiveConnectionInvalidated?: (fallbackProfile: string, activationEpoch: number) => void
  onActiveConnectionChanged?: (connection: HermesConnection) => void
  /**
   * Fires whenever applyActive() moves the active route to a (possibly
   * different) profile — including registry-internal eviction fallbacks
   * (idle reap, connection removal, profile delete) that no renderer call
   * initiated. Consumers mirror this into $activeGatewayProfile so the
   * published profile can never diverge from the socket actually selected
   * (#89206: the stale-profile split-brain that stranded bot wake-ups).
   */
  onActiveRouteChanged?: (profile: string) => void
  /** Drop transient profile-pool runtime routes when local profile teardown
   * permanently retires their owning secondary. Exact registry routes are
   * deliberately outside this callback: a remote source may share the name. */
  onLocalProfileRetired?: (profile: string) => void
  /**
   * Scopes a FOREGROUND surface is bound to right now — every mounted
   * session tile's owner and the primary thread's (foregroundSessionScopes in
   * store/session-states; a config hook because that store imports this
   * one). Consulted by EVERY dispose path — the live-work pruner and the
   * dispose-at-refcount-0 request/relay leases alike (#93892): a tile's
   * resume mints its runtime on its owner's socket, and any path that closes
   * that socket makes the backend orphan-reap the runtime, whose
   * `session.reclaimed` unbinds the tile and re-arms its resume — a spinner
   * loop with no terminal state. Read at decision time, never cached: it
   * follows the tile set, so closing the tile releases the socket.
   */
  foregroundScopes?: () => ReadonlySet<string>
  /**
   * Scopes with a running or needs-input session runtime, in the same key
   * language as `foregroundScopes` (composite registry keys, bare profiles
   * for local/legacy entries). The wake-path liveness probe counts these as
   * in-flight work: prompt.submit returns before the turn ends, so
   * `activeRequests` is 0 during most of a turn.
   */
  liveScopes?: () => ReadonlySet<string>
}

// ── Secondary (pool) backends ──────────────────────────────────────────────
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
   * Main retired this scope's pooled backend for a foreground open elsewhere
   * (electron/pool-retire.ts). A parked-by-stall entry re-arms on the
   * wake/focus nudge; a retired one must not — that nudge would redial into
   * the very slot the retirement freed. Only an explicit open of the scope
   * clears it (rearmSecondary).
   */
  retiredByPool: boolean
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

// ── HMR-stable module state ─────────────────────────────────────────────────
// All mutable singletons (live sockets, active-profile routing, the event
// registry) live in ONE container parked on globalThis, NOT in module-level
// `let`/`const` bindings. Reason: this module is imported widely without an HMR
// boundary that accepts it, so editing it (or anything that fans out to it)
// makes Vite issue a FULL PAGE RELOAD — which would kill every live socket and
// drop the agent session on an unrelated edit. Persisting the state on
// globalThis + self-accepting HMR (bottom of file) turns that full reload into
// an in-place hot update that preserves the sockets. Production strips
// import.meta.hot, and a fresh page realm starts with an empty container, so the
// runtime behavior is identical to plain module state.
export interface GatewayRegistryState {
  config: RegistryConfig | null
  primaryGateway: HermesGateway | null
  /** Registry source currently served by primaryGateway, when known. */
  primaryConnectionId: null | string
  /** Resolved mode of the primary's descriptor: a `local` primary is ONE
   *  `hermes serve --profile <primary>` child and can never stand in for a
   *  pooled profile's own backend. */
  primaryConnectionMode: 'local' | 'remote' | null
  primaryProfile: string
  activeKey: string
  activationEpoch: number
  secondaries: Map<string, Secondary>
  // Auth rejection outlives the disposable socket, including background request leases.
  reauthFailures: Map<string, { connectionId: string | null; error: Error }>
  // Dial failures outlive the disposable socket too: a background request lease disposes its
  // entry on failure, so history kept on the entry reset on every poll (#121865).
  dialFailures: Map<string, { at: number; streak: number; connectionId: string | null }>
  /** Scopes that opened in this renderer generation, even if later pruned. */
  openedSecondaryScopes?: Set<string>
  /** Scopes whose re-activation after a connection redial has not landed yet. */
  reactivatingScopes?: Set<string>
  /** Routed prompt sockets held until their terminal turn event arrives. */
  turnLeases: Map<string, () => void>
  /** Debounced releases so an immediate chained turn can reuse its lease. */
  turnLeaseReleaseTimers: Map<string, ReturnType<typeof setTimeout>>
  $gateway: ReturnType<typeof atom<HermesGateway | null>>
  $activeConnectionId: ReturnType<typeof atom<null | string>>
  $activeProfile: ReturnType<typeof atom<string>>
}

/** A server→client request tagged with the registry source it arrived from (like `GatewayEvent.profile`). */
export interface ScopedServerRequest extends ServerRequest {
  connectionId?: string
  profile: string
}

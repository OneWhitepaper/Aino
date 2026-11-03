import { type ServerRequest } from '@hermes/shared'
import type { atom } from 'nanostores'

import type { HermesGateway } from '@/hermes'

import type { RegistryConfig } from './gateway-registry-config'
import type { Secondary } from './gateway-socket-entry'

// Spawn-slot priority handed to Electron main with every backend dial. A
// user-initiated open is 'foreground' and may take the pool's reserved slot;
// roster hydration, hover prewarm and untagged dials are 'background' — main's
// default, so background dials keep the pre-priority IPC payload shape.
export type SpawnPriority = 'foreground' | 'background'

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
  primaryProfile: string
  activeKey: string
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

import { type ServerRequest } from '@hermes/shared'

// Spawn-slot priority handed to Electron main with every backend dial. A
// user-initiated open is 'foreground' and may take the pool's reserved slot;
// roster hydration, hover prewarm and untagged dials are 'background' — main's
// default, so background dials keep the pre-priority IPC payload shape.
export type SpawnPriority = 'foreground' | 'background'

/** A server→client request tagged with the registry source it arrived from (like `GatewayEvent.profile`). */
export interface ScopedServerRequest extends ServerRequest {
  connectionId?: string
  profile: string
}

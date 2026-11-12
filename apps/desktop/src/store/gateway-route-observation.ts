import type { ConnectionState } from '@hermes/shared'
import { atom } from 'nanostores'

import type { HermesGateway } from '@/hermes'

export interface GatewayRouteState {
  gateway: HermesGateway | null
  socket: HermesGateway | null
  key: string
  open: boolean
  primary: boolean
  state: ConnectionState | null
}

const OBSERVATION_KEY = Symbol.for('hermes.desktop.gatewayRouteObservation')
const container = globalThis as unknown as { [OBSERVATION_KEY]?: ReturnType<typeof atom<number>> }

// Subscribers survive registry HMR along with the sockets they observe.
export const $gatewayRouteRevision = import.meta.hot ? (container[OBSERVATION_KEY] ??= atom(0)) : atom(0)

export function gatewayRouteChanged(): void {
  $gatewayRouteRevision.set($gatewayRouteRevision.get() + 1)
}

export function observedGatewayRouteState(
  socket: HermesGateway | null,
  key: string,
  primary: boolean
): GatewayRouteState {
  const open = socket?.connectionState === 'open'

  return { gateway: open ? socket : null, socket, key, open, primary, state: socket?.connectionState ?? null }
}

import type { HermesGateway } from '@/hermes'
import { translateNow } from '@/i18n'

import { gatewayRouteState, openGatewayForAgent } from './gateway'
import type { GatewayReconnectOptions } from './gateway-reconnect'

export interface GatewayReconnectTarget {
  connectionId: string | null
  profile: string
  isCurrent: () => boolean
}

/** A split's explicit recovery must never activate it or redial an unrelated foreground. */
export async function prepareGatewayReconnect(
  options: GatewayReconnectOptions | undefined,
  primaryGateway: HermesGateway,
  activePrimary: boolean,
  activeProfile: string
): Promise<{ handled: boolean; primary: boolean; profile: string }> {
  const target = options?.target

  if (!target) {
    return { handled: false, primary: activePrimary, profile: activeProfile }
  }

  const unavailable = () => new Error(translateNow('desktop.gatewayReconnectUnavailable'))

  if (!target.isCurrent()) {
    throw unavailable()
  }

  const route = gatewayRouteState(target.connectionId, target.profile)

  if (route.primary && route.socket === primaryGateway) {
    return { handled: false, primary: true, profile: target.profile }
  }

  await openGatewayForAgent(target.connectionId, target.profile, { spawnPriority: 'foreground' })

  if (!target.isCurrent() || !gatewayRouteState(target.connectionId, target.profile).open) {
    throw unavailable()
  }

  return { handled: true, primary: false, profile: target.profile }
}

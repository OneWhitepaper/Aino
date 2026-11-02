import { type ConnectionState, type GatewayEvent, registryBackendScopeKey } from '@hermes/shared'
import { atom } from 'nanostores'

export type ManagedModelRouteCapability = 'supported' | 'unknown' | 'unsupported'

export interface ManagedModelRoute {
  connectionId?: null | string
  profile?: null | string
}

/** Exact socket-ready evidence. An open socket is not capability evidence. */
export const $gatewayManagedCapabilities = atom<Record<string, ManagedModelRouteCapability>>({})
export const $gatewayManagedImageCapabilities = atom<Record<string, ManagedModelRouteCapability>>({})

function routeKey(route: ManagedModelRoute): string {
  return registryBackendScopeKey(route.connectionId, route.profile)
}

export function managedModelRouteCapability(route: ManagedModelRoute): ManagedModelRouteCapability {
  return managedModelRouteCapabilityFrom($gatewayManagedCapabilities.get(), route)
}

export function managedImageRouteCapability(route: ManagedModelRoute): ManagedModelRouteCapability {
  return managedModelRouteCapabilityFrom($gatewayManagedImageCapabilities.get(), route)
}

export function managedModelRouteCapabilityFrom(
  capabilities: Readonly<Record<string, ManagedModelRouteCapability>>,
  route: ManagedModelRoute
): ManagedModelRouteCapability {
  return capabilities[routeKey(route)] ?? 'unknown'
}

export function recordGatewayReadyCapability(route: ManagedModelRoute, event: GatewayEvent): void {
  if (event.type !== 'gateway.ready') {
    return
  }

  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
  const supported = (payload as { managed_model_binding?: unknown }).managed_model_binding === 1
  const key = routeKey(route)

  $gatewayManagedCapabilities.set({
    ...$gatewayManagedCapabilities.get(),
    [key]: supported ? 'supported' : 'unsupported'
  })
  $gatewayManagedImageCapabilities.set({
    ...$gatewayManagedImageCapabilities.get(),
    [key]: (payload as { managed_image_binding?: unknown }).managed_image_binding === 1 ? 'supported' : 'unsupported'
  })
}

export function resetGatewayManagedCapability(route: ManagedModelRoute): void {
  const key = routeKey(route)

  for (const capabilities of [$gatewayManagedCapabilities, $gatewayManagedImageCapabilities]) {
    const current = capabilities.get()

    if (key in current) {
      const next = { ...current }
      delete next[key]
      capabilities.set(next)
    }
  }
}

export function recordGatewayCapabilityState(route: ManagedModelRoute, state: ConnectionState): void {
  if (state !== 'open') {
    resetGatewayManagedCapability(route)
  }
}

export function clearGatewayManagedCapabilities(): void {
  $gatewayManagedCapabilities.set({})
  $gatewayManagedImageCapabilities.set({})
}

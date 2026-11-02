import { afterEach, expect, it } from 'vitest'

import {
  clearGatewayManagedCapabilities,
  managedImageRouteCapability,
  managedModelRouteCapability,
  recordGatewayCapabilityState,
  recordGatewayReadyCapability
} from './gateway-managed-capability'

afterEach(clearGatewayManagedCapabilities)

it('requires separate image capability evidence on the exact route and clears both on disconnect', () => {
  const route = { connectionId: 'remote', profile: 'writer' }
  const other = { ...route, profile: 'default' }
  recordGatewayReadyCapability(route, { type: 'gateway.ready', payload: { managed_model_binding: 1 } } as never)
  expect(managedModelRouteCapability(route)).toBe('supported')
  expect(managedImageRouteCapability(route)).toBe('unsupported')
  recordGatewayReadyCapability(route, { type: 'gateway.ready', payload: { managed_image_binding: 1 } } as never)
  expect(managedModelRouteCapability(route)).toBe('unsupported')
  expect(managedImageRouteCapability(route)).toBe('supported')
  expect(managedImageRouteCapability(other)).toBe('unknown')
  recordGatewayCapabilityState(route, 'closed')
  expect(managedModelRouteCapability(route)).toBe('unknown')
  expect(managedImageRouteCapability(route)).toBe('unknown')
})

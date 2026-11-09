import { describe, expect, it } from 'vitest'

import { primaryRuntimeConnectionId } from './use-gateway-boot'

describe('primaryRuntimeConnectionId', () => {
  it('uses the registry identity when the primary connection has one', () => {
    expect(primaryRuntimeConnectionId({ connectionId: ' tower ', mode: 'remote' })).toBe('tower')
  })

  it('uses the stable local identity for an app-managed backend', () => {
    expect(primaryRuntimeConnectionId({ mode: 'local' })).toBe('local')
  })

  it('returns null for an unknown remote identity so the caller falls back to live-connection scoping', () => {
    expect(primaryRuntimeConnectionId({ mode: 'remote' })).toBeNull()
  })
})

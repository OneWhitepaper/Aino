import { render } from '@testing-library/react'
import type { ComponentType } from 'react'
import { expect, it, vi } from 'vitest'

import { activeGateway, ensureGatewayForAgent, ensureGatewayForProfile } from '@/store/gateway'
import { reconnectGateway } from '@/store/gateway-reconnect'

import { FakeWebSocket } from '../../../test/fake-gateway-socket'

import { coderConn, primaryConn } from './gateway-boot-test-connections'

interface TargetedReconnectFixtures {
  fakeDesktop: () => object
  Harness: ComponentType
  flushAsync: () => Promise<void>
}

/** Cases share the boot suite's real hook lifecycle and network boundary. */
export function targetedGatewayReconnectCases({ fakeDesktop, Harness, flushAsync }: TargetedReconnectFixtures) {
  it.each(['primary', 'secondary'] as const)(
    'reconnects a captured %s owner without selecting it or disturbing the other split',
    async source => {
      const desktop = {
        ...fakeDesktop(),
        getConnectionFor: vi.fn(async () => coderConn),
        getGatewayWsUrlFor: vi.fn(async () => coderConn.wsUrl)
      }

      ;(window as { hermesDesktop?: unknown }).hermesDesktop = desktop
      render(<Harness />)
      await flushAsync()
      vi.useRealTimers()
      await ensureGatewayForAgent('coder-remote', 'coder')
      const primary = FakeWebSocket.instances[0]
      const secondary = FakeWebSocket.instances[1]

      const target =
        source === 'primary'
          ? { connectionId: primaryConn.connectionId, profile: 'default', isCurrent: () => true }
          : { connectionId: 'coder-remote', profile: 'coder', isCurrent: () => true }

      if (source === 'secondary') {
        await ensureGatewayForProfile('default')
      }

      const foreground = activeGateway()

      ;(source === 'primary' ? primary : secondary).drop()
      await reconnectGateway({ target })

      expect(activeGateway()).toBe(foreground)
      expect(source === 'primary' ? secondary.readyState : primary.readyState).toBe(FakeWebSocket.OPEN)
      expect(FakeWebSocket.instances.at(-1)?.url).toBe(source === 'primary' ? primaryConn.wsUrl : coderConn.wsUrl)
    }
  )
}

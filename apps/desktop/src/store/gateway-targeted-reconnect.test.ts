import { beforeEach, expect, it, vi } from 'vitest'

import type { GatewayReconnectTarget } from './gateway-targeted-reconnect'
import { prepareGatewayReconnect } from './gateway-targeted-reconnect'

const mocks = vi.hoisted(() => ({ route: vi.fn(), open: vi.fn() }))
vi.mock('./gateway', () => ({ gatewayRouteState: mocks.route, openGatewayForAgent: mocks.open }))

beforeEach(() => {
  mocks.route.mockReset()
  mocks.open.mockReset().mockResolvedValue(undefined)
})

const target = (): GatewayReconnectTarget => ({ connectionId: 'source-a', profile: 'default', isCurrent: () => true })

it('redials a nonforeground secondary through its own existing source door', async () => {
  const primary = {} as never
  mocks.route.mockReturnValueOnce({ primary: false, socket: {}, open: false }).mockReturnValueOnce({ open: true })
  const result = await prepareGatewayReconnect({ target: target() }, primary, true, 'another-profile')
  expect(result).toEqual({ handled: true, primary: false, profile: 'default' })
  expect(mocks.open).toHaveBeenCalledExactlyOnceWith('source-a', 'default', { spawnPriority: 'foreground' })
  expect(mocks.route).toHaveBeenNthCalledWith(1, 'source-a', 'default')
})

it('uses the owning primary recovery path even when another source is foreground', async () => {
  const primary = {} as never
  mocks.route.mockReturnValue({ primary: true, socket: primary, open: false })
  const result = await prepareGatewayReconnect({ target: target() }, primary, false, 'other-foreground-profile')
  expect(result).toEqual({ handled: false, primary: true, profile: 'default' })
  expect(mocks.open).not.toHaveBeenCalled()
})

it('rejects a stale captured account/source before dialing and after a late dial', async () => {
  const captured = target()
  captured.isCurrent = vi.fn().mockReturnValueOnce(false)
  await expect(prepareGatewayReconnect({ target: captured }, {} as never, true, 'default')).rejects.toThrow()
  expect(mocks.open).not.toHaveBeenCalled()

  captured.isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
  mocks.route.mockReturnValue({ primary: false, open: false })
  await expect(prepareGatewayReconnect({ target: captured }, {} as never, true, 'default')).rejects.toThrow()
  expect(mocks.open).toHaveBeenCalledOnce()
})

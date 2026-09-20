import { JsonRpcGatewayError } from '@hermes/shared'
import { expect, it, vi } from 'vitest'

import type { requestGatewayForAgent } from '@/store/gateway'

import { ordinaryNewKind } from './ordinary-new'

it('falls back only for a confirmed missing or disabled service, and uses the fixed default coordinator', async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new JsonRpcGatewayError('Missing', { code: -32601 }))
    .mockResolvedValueOnce({ protocol_version: 1, enabled: false })
    .mockResolvedValueOnce({ protocol_version: 1, enabled: true })
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValueOnce({})

  expect(await ordinaryNewKind('remote', request as typeof requestGatewayForAgent)).toBe('legacy_session')
  expect(await ordinaryNewKind('remote', request as typeof requestGatewayForAgent)).toBe('legacy_session')
  expect(await ordinaryNewKind('remote', request as typeof requestGatewayForAgent)).toBe('conversation')
  await expect(ordinaryNewKind('remote', request as typeof requestGatewayForAgent)).rejects.toThrow('Connection lost')
  await expect(ordinaryNewKind('remote', request as typeof requestGatewayForAgent)).rejects.toThrow(
    'Invalid conversation capability response'
  )
  expect(
    request.mock.calls.every(
      call => call[0] === 'remote' && call[1] === 'default' && call[2] === 'conversations.capabilities'
    )
  ).toBe(true)
})

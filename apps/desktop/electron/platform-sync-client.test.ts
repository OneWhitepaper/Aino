import { expect, test, vi } from 'vitest'

import { createPlatformClient } from '../shared/platform-client'

const input = { version: 1, device_id: 'device', after: '0', limit: 50, operations: [] } as const
const signal = new AbortController().signal
test('old endpoints are unavailable while quota failures preserve actionable codes', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ reason: 'DESKTOP_SYNC_QUOTA' }), { status: 413 }))

  const client = createPlatformClient({ origin: 'https://api.invalid', fetchImpl: fetchImpl as any })
  await expect(client.syncExchange('native-only', input as any, signal)).rejects.toMatchObject({
    code: 'sync_unavailable',
    authentication: false
  })
  await expect(client.syncExchange('native-only', input as any, signal)).rejects.toMatchObject({
    code: 'DESKTOP_SYNC_QUOTA'
  })
})
test('sync validates revisions and refuses oversized blob bodies before transport', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify({ code: 0, data: { cursor: 1, has_more: false, results: [], changes: [] } }))
  )
  const client = createPlatformClient({ origin: 'https://api.invalid', fetchImpl })
  await expect(client.syncExchange('native-only', input as any, signal)).rejects.toThrow('invalid_sync_response')
  await expect(
    client.syncBlob('native-only', 'a'.repeat(64), new Uint8Array(8 * 1024 * 1024 + 1), signal)
  ).rejects.toMatchObject({ code: 'invalid_sync_blob' })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})

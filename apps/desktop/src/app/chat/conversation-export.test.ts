import { expect, it, vi } from 'vitest'

import { exportConversation } from './conversation-export'

it('downloads the complete public export only after all captured-owner pages succeed', async () => {
  const owner = { connectionId: 'remote', installId: 'host', conversationId: 'room' }
  const cursor = { revision: 5, after_seq: 1 }

  const request = vi
    .fn()
    .mockResolvedValueOnce({ filename: 'public.json', chunk: '{"text":"', cursor })
    .mockResolvedValueOnce({ filename: null, chunk: '完整答案"}', cursor: null })

  const download = vi.fn()
  await exportConversation(owner, request as never, download)
  expect(request.mock.calls).toEqual([
    ['remote', 'default', 'conversations.export', { conversation_id: 'room', cursor: null }],
    ['remote', 'default', 'conversations.export', { conversation_id: 'room', cursor }]
  ])
  expect(download).toHaveBeenCalledWith('public.json', '{"text":"完整答案"}', 'application/json')
  download.mockClear()
  request
    .mockResolvedValueOnce({ filename: 'public.json', chunk: 'partial', cursor })
    .mockRejectedValueOnce(new Error('Snapshot changed'))
  await expect(exportConversation(owner, request as never, download)).rejects.toThrow('Snapshot changed')
  expect(download).not.toHaveBeenCalled()
})

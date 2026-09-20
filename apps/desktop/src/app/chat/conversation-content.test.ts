import { webcrypto } from 'node:crypto'

import { afterEach, expect, it, vi } from 'vitest'

import * as gateway from '@/store/gateway'

import { readConversationContent } from './conversation-content'

const owner = { connectionId: 'content-host', installId: 'install', conversationId: 'conversation' }
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))

async function fixture(text: string) {
  const bytes = new TextEncoder().encode(text)
  const digest = await webcrypto.subtle.digest('SHA-256', bytes)
  const sha256 = Buffer.from(digest).toString('hex')

  return { bytes, ref: { id: 'content', sha256, size_bytes: bytes.length, mime_type: 'text/plain; charset=utf-8' } }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it('assembles split UTF8 bytes before decoding and keeps the captured owner across every authorized page', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const { bytes, ref } = await fixture('A中B🙂C')
  const mutableOwner = { ...owner }

  const rpc = vi
    .spyOn(gateway, 'requestGatewayForAgent')
    .mockImplementation(async (_host, _profile, _method, params) => {
      const offset = params!.offset_bytes as number
      mutableOwner.connectionId = 'other-host'
      mutableOwner.conversationId = 'other-conversation'
      const next = Math.min(offset + 2, bytes.length)

      return {
        data_base64: base64(bytes.slice(offset, next)),
        next_offset: next,
        has_more: next < bytes.length,
        sha256: ref.sha256
      }
    })

  const content = await readConversationContent(mutableOwner, ref)
  expect(new TextDecoder('utf-8', { fatal: true }).decode(content)).toBe('A中B🙂C')
  expect(rpc.mock.calls.length).toBeGreaterThan(1)

  for (const call of rpc.mock.calls) {
    expect(call).toEqual([
      'content-host',
      'default',
      'conversations.content',
      expect.objectContaining({ conversation_id: 'conversation', content_id: 'content' })
    ])
  }
})
it('rejects incomplete size, non-advancing pages and forged matching page hashes before returning any answer', async () => {
  vi.stubGlobal('crypto', webcrypto)
  const { bytes, ref } = await fixture('actual answer')
  const rpc = vi.spyOn(gateway, 'requestGatewayForAgent')

  const invalidPages = [
    { data_base64: base64(bytes.slice(0, 2)), next_offset: 2, has_more: false, sha256: ref.sha256 },
    { data_base64: '', next_offset: 0, has_more: true, sha256: ref.sha256 },
    {
      data_base64: base64(new Uint8Array(bytes.length)),
      next_offset: bytes.length,
      has_more: false,
      sha256: ref.sha256
    }
  ]

  for (const page of invalidPages) {
    rpc.mockResolvedValue(page)
    await expect(readConversationContent(owner, ref)).rejects.toThrow('Content verification failed')
  }

  expect(rpc).toHaveBeenCalledTimes(invalidPages.length)
})

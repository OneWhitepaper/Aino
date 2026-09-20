import { expect, it, vi } from 'vitest'

import type { requestGatewayForAgent } from '@/store/gateway'

import { adoptLegacyConversation, migratedConversation, resolveLegacyMigration } from './conversation-migration'

it('follows completed source aliases without adopting, and never crosses same-name sources', async () => {
  const record = {
    conversation_id: 'public',
    general: { install_id: 'host' },
    migration: {
      status: 'complete',
      source_profile: 'writer',
      source_lineage_id: 'root',
      source_session_ids: ['middle', 'tip']
    }
  }

  const request = vi.fn().mockResolvedValue({ conversations: [record], has_more: false })
  expect(
    await migratedConversation(
      { connectionId: 'remote', profile: 'writer' },
      'middle',
      request as typeof requestGatewayForAgent
    )
  ).toEqual({ connectionId: 'remote', installId: 'host', conversationId: 'public' })
  expect(
    await migratedConversation(
      { connectionId: 'remote', profile: 'other' },
      'middle',
      request as typeof requestGatewayForAgent
    )
  ).toBeNull()
  expect(
    request.mock.calls.every(call => call[0] === 'remote' && call[1] === 'default' && call[2] === 'conversations.list')
  ).toBe(true)
})

it('retries an ambiguous adoption with identical write identities and never creates a second container', async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error('Lost acknowledgement'))
    .mockResolvedValueOnce({ migration: { status: 'complete', conversation_id: 'adopted' } })
    .mockResolvedValueOnce({ conversation: { conversation_id: 'adopted', general: { install_id: 'host' } } })

  const owner = { connectionId: 'captured', profile: 'writer' }
  await expect(adoptLegacyConversation(owner, 'source', request as typeof requestGatewayForAgent)).rejects.toThrow(
    'Lost acknowledgement'
  )
  expect(await adoptLegacyConversation(owner, 'source', request as typeof requestGatewayForAgent)).toEqual({
    connectionId: 'captured',
    installId: 'host',
    conversationId: 'adopted'
  })
  expect(request.mock.calls[1]).toEqual(request.mock.calls[0])
  expect(request.mock.calls[0].slice(0, 3)).toEqual(['captured', 'writer', 'conversations.adopt'])
  expect(request.mock.calls[2].slice(0, 3)).toEqual(['captured', 'default', 'conversations.get'])
  expect(request.mock.calls.some(call => call[2] === 'conversations.create')).toBe(false)
})

it('does not route cron, messaging or canonical bots through ordinary discovery, and preserves legacy reads during outage', async () => {
  const request = vi.fn().mockRejectedValue(new Error('coordinator unavailable'))
  const onError = vi.fn()
  const owner = { connectionId: 'remote', profile: 'writer' }

  for (const session of [
    { source: 'cron', title: null },
    { source: 'telegram', title: null },
    { source: 'desktop', title: 'Bot Chat' }
  ]) {
    expect(
      await resolveLegacyMigration(owner, 'id', session, onError, request as typeof requestGatewayForAgent)
    ).toBeNull()
  }

  expect(request).not.toHaveBeenCalled()
  expect(
    await resolveLegacyMigration(
      owner,
      'id',
      { source: 'desktop', title: 'Story' },
      onError,
      request as typeof requestGatewayForAgent
    )
  ).toBeNull()
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'coordinator unavailable' }))
  expect(request).toHaveBeenCalledWith('remote', 'default', 'conversations.list', expect.anything())
})

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/store/gateway', () => ({ $activeGatewayConnectionId: atom('local'), requestGatewayForAgent: rpc }))
vi.mock('@/store/connection-registry-state', () => ({
  $connectionsRegistry: atom({ connections: [{ id: 'local' }, { id: 'remote' }] })
}))
vi.mock('@/store/conversations', () => ({ $conversationRecords: atom({}) }))
const { useConversationList } = await import('./use-conversation-list')
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const record = (id: string) => ({ conversation_id: id, title: id, general: { install_id: 'host' }, archived: false })
it('retains healthy source history during another source outage, pages fully, and retries without changing ownership', async () => {
  let failed = false
  rpc.mockImplementation(async (connection: string, _profile: string, _method: string, params: { cursor: string }) => {
    if (connection === 'remote' && failed) {
      throw new Error('Offline')
    }

    return params.cursor
      ? { conversations: [record('older'), { ...record('archived'), archived: true }], has_more: false, cursor: null }
      : {
          conversations: [record('same')],
          has_more: connection === 'local',
          cursor: connection === 'local' ? 'next' : null
        }
  })
  const { result } = renderHook(() => useConversationList(false))
  await waitFor(() => expect(result.current.rows.length).toBe(3))
  expect(
    result.current.rows.filter(row => row.record.conversation_id === 'same').map(row => row.owner.connectionId)
  ).toEqual(['local', 'remote'])
  failed = true
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.error).toContain('Offline'))
  expect(result.current.rows.length).toBe(3)
  expect(rpc.mock.calls.every(call => call[1] === 'default')).toBe(true)
  failed = false
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.error).toBeNull())
})

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { $conversationRecords } from '@/store/conversations'
import type * as Gateway from '@/store/gateway'
import { requestGatewayForAgent } from '@/store/gateway'
import { makeSessionInfo } from '@/test/session-info'

import {
  conversationForLegacy,
  ConversationList,
  type ConversationListRow,
  conversationMatchesProject,
  legacyOrdinaryRow,
  openOrdinaryRow,
  ordinaryRowKey
} from './conversation-list'

vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<typeof Gateway>()),
  requestGatewayForAgent: vi.fn()
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  $conversationRecords.set({})
})

const source = {
  install_id: 'host',
  execution_environment_id: 'local',
  registration_profile: 'writer',
  project_id: 'project',
  cwd: '/book'
}

const row: ConversationListRow = {
  kind: 'conversation',
  owner: { connectionId: 'remote', installId: 'host', conversationId: 'same' },
  record: {
    conversation_id: 'same',
    title: 'Shared story',
    general: { participant_id: 'general', profile: 'default', install_id: 'host', display_name: 'Aino' },
    project: source,
    revision: 1,
    archived: false
  }
}

it('keeps discriminated source identities and opens the captured legacy row without reconstruction', () => {
  const session = makeSessionInfo({ id: 'same', profile: 'writer', connection_id: 'remote' })
  const legacy = legacyOrdinaryRow(session)!
  const actions = { conversation: vi.fn(), legacy: vi.fn() }
  expect(ordinaryRowKey(legacy)).not.toBe(ordinaryRowKey(row))
  expect(ordinaryRowKey(row)).not.toBe(ordinaryRowKey({ ...row, owner: { ...row.owner, connectionId: 'local' } }))
  openOrdinaryRow(legacy, actions)
  expect(actions.legacy).toHaveBeenCalledWith(session)
  expect(legacyOrdinaryRow(makeSessionInfo({ id: 'unknown' }))).toBeNull()
  render(<ConversationList onOpen={actions.conversation} rows={[row]} selected={null} />)
  fireEvent.click(screen.getByRole('button', { name: /Shared story/ }))
  expect(actions.conversation).toHaveBeenCalledWith(row.owner)
})
it('filters by exact shared project source and suppresses only a completed matching migration', () => {
  expect(conversationMatchesProject(row, { connectionId: 'remote', source })).toBe(true)
  expect(
    conversationMatchesProject(row, { connectionId: 'remote', source: { ...source, execution_environment_id: 'ssh' } })
  ).toBe(false)

  const migrated = {
    ...row,
    record: {
      ...row.record,
      migration: {
        migration_id: 'm',
        conversation_id: 'same',
        source_profile: 'writer',
        source_lineage_id: 'root',
        source_session_ids: ['tip'],
        source_cutoff_row_id: 2,
        status: 'complete' as const
      }
    }
  }

  expect(
    conversationForLegacy([migrated], makeSessionInfo({ id: 'tip', profile: 'writer', connection_id: 'remote' }))
  ).toBe(migrated)
  expect(
    conversationForLegacy([migrated], makeSessionInfo({ id: 'tip', profile: 'writer', connection_id: 'local' }))
  ).toBeUndefined()
})

it('uses the original rename dialog and archive menu with captured owner/revision, retaining edits on rejection', async () => {
  const request = vi.mocked(requestGatewayForAgent)
  request.mockRejectedValueOnce(new Error('Revision changed'))
  const onRefresh = vi.fn()

  const view = (value: ConversationListRow) => (
    <ConversationList onOpen={vi.fn()} onRefresh={onRefresh} rows={[value]} selected={null} />
  )

  const { rerender } = render(view(row))
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Session actions' }), { button: 0, pointerType: 'mouse' })
  expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
  fireEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Owned title' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  expect((within(dialog).getByRole('textbox') as HTMLInputElement).value).toBe('Owned title')
  expect(request).toHaveBeenLastCalledWith('remote', 'default', 'conversations.rename', {
    conversation_id: 'same',
    expected_revision: 1,
    title: 'Owned title'
  })
  const fresh = { ...row, record: { ...row.record, revision: 2 } }
  rerender(view(fresh))
  request.mockResolvedValueOnce({ conversation: { ...fresh.record, revision: 3, title: 'Owned title' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(request).toHaveBeenLastCalledWith('remote', 'default', 'conversations.rename', {
    conversation_id: 'same',
    expected_revision: 2,
    title: 'Owned title'
  })
  const renamed = { ...fresh, record: { ...fresh.record, revision: 3, title: 'Owned title' } }
  rerender(view(renamed))
  request.mockResolvedValueOnce({ conversation: { ...renamed.record, revision: 4, archived: true } })
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Session actions' }), { button: 0, pointerType: 'mouse' })
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }))
  await waitFor(() =>
    expect(request).toHaveBeenLastCalledWith('remote', 'default', 'conversations.archive', {
      conversation_id: 'same',
      expected_revision: 3
    })
  )
  expect(request.mock.calls.every(call => call[0] === 'remote' && call[1] === 'default')).toBe(true)
})

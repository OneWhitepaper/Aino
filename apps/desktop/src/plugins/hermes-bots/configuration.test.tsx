import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const edits = vi.hoisted(() => vi.fn())

const rows = vi.hoisted(() => [
  { name: 'writer', targetProfile: 'default', connectionId: 'remote-a', connectionLabel: 'Machine A' },
  { name: 'writer', targetProfile: 'writer', connectionId: 'remote-b', connectionLabel: 'Machine B' }
])

vi.mock('./data', () => ({
  useRoster: () => ({ data: { profiles: rows }, refetch: vi.fn() }),
  annotateBotSource: (row: unknown) => row,
  botRosterKey: (row: (typeof rows)[number]) => `${row.connectionId}:${row.name}`,
  botSourceStatus: () => ({ available: true })
}))
vi.mock('./edit-profile-dialog', () => ({
  EditProfileDialog: (props: unknown) => {
    edits(props)

    return null
  }
}))
vi.mock('./create-dialog', () => ({ CreateAgentDialog: () => null }))
import { AgentHubConfiguration } from './configuration'
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
it('opens the existing editor with the exact clicked expert source without opening its chat', () => {
  render(<AgentHubConfiguration />)
  fireEvent.click(screen.getByRole('button', { name: /Machine A/ }))
  expect(edits.mock.calls.at(-1)?.[0]).toMatchObject({ open: true, bot: rows[0] })
  fireEvent.click(screen.getByRole('button', { name: /Machine B/ }))
  expect(edits.mock.calls.at(-1)?.[0]).toMatchObject({ open: true, bot: rows[1] })
})

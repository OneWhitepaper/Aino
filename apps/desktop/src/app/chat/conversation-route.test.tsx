// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

const rpc = vi.hoisted(() => vi.fn())
const create = vi.hoisted(() => vi.fn())
const createOwners = vi.hoisted(() => vi.fn())
vi.mock('@/store/gateway', () => ({ $activeGatewayConnectionId: atom('remote'), requestGatewayForAgent: rpc }))
vi.mock('./conversation-view', () => ({
  ConversationView: ({ owner }: { owner: { conversationId: string } }) => <div>Readable {owner.conversationId}</div>
}))
vi.mock('./conversation-actions', () => ({
  createConversationActions: (owner: unknown) => {
    createOwners(owner)
    return { create }
  }
}))
const { ConversationRoute } = await import('./conversation-route')
const general = {
  participant_id: 'general',
  install_id: 'install',
  profile: 'default',
  display_name: 'Aino',
  is_general: true
}

function NewEntry() {
  const navigate = useNavigate()
  return <button onClick={() => navigate('/conversations/new')}>New conversation</button>
}
function renderPath(path: string) {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <MemoryRouter initialEntries={[path]}>
        <NewEntry />
        <Routes>
          <Route element={<ConversationRoute />} path="/conversations/:conversationId" />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
it('disabling creation preserves existing conversation reads while keeping the new entry gated', async () => {
  rpc.mockImplementation(async (_connection, _profile, method) =>
    method === 'conversations.capabilities'
      ? { protocol_version: 1, enabled: false, reason: 'Creation disabled' }
      : { participants: [{ participant: general, available: true }] }
  )
  const existing = renderPath('/conversations/existing')
  expect(await screen.findByText('Readable existing')).toBeTruthy()
  expect(rpc).toHaveBeenCalledWith('remote', 'default', 'conversations.participants', {})
  existing.unmount()
  rpc.mockClear()
  renderPath('/conversations/new')
  expect((await screen.findByRole('alert')).textContent).toContain('Creation disabled')
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('button', { name: 'Create conversation' })).toBeNull()
})
it('does not interpret an unknown conversation protocol as version one', async () => {
  rpc.mockResolvedValue({ protocol_version: 2, enabled: true })
  renderPath('/conversations/existing')
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Readable existing')).toBeNull()
})

it('creates once per new entry and retries failed creation without reusing an earlier conversation', async () => {
  rpc.mockImplementation(async (_connection, _profile, method) =>
    method === 'conversations.capabilities'
      ? { protocol_version: 1, enabled: true }
      : { participants: [{ participant: general, available: true }] }
  )
  create.mockResolvedValue({})
  renderPath('/conversations/new')
  const first = (await screen.findByText(/^Readable /)).textContent
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  await waitFor(() => expect(screen.getByText(/^Readable /).textContent).not.toBe(first))
  expect(create).toHaveBeenCalledTimes(2)
  create.mockRejectedValueOnce(new Error('creation interrupted'))
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  expect((await screen.findByRole('alert')).textContent).toContain('creation interrupted')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText(/^Readable /)
  expect(create).toHaveBeenCalledTimes(4)
  expect(createOwners.mock.calls[2][0]).toEqual(createOwners.mock.calls[3][0])
  expect(createOwners.mock.calls[0][0]).not.toEqual(createOwners.mock.calls[1][0])
})

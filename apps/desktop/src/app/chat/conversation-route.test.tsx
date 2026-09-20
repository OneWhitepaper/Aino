// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { type OpenSharedProject, sharedOpenKey, sharedProjectWindow } from '@/store/shared-project-windows'

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

function renderPath(path: string, state?: unknown) {
  return render(
    <I18nProvider configClient={null} initialLocale="en">
      <MemoryRouter
        initialEntries={[
          { pathname: path.split('?')[0], search: path.includes('?') ? '?' + path.split('?')[1] : '', state }
        ]}
      >
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
  sharedProjectWindow.opened.set([])
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
  expect(create.mock.calls.every(([params]) => params.auto_title === true)).toBe(true)
  create.mockRejectedValueOnce(new Error('creation interrupted'))
  fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
  expect((await screen.findByRole('alert')).textContent).toContain('creation interrupted')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText(/^Readable /)
  expect(create).toHaveBeenCalledTimes(4)
  expect(createOwners.mock.calls[2][0]).toEqual(createOwners.mock.calls[3][0])
  expect(createOwners.mock.calls[0][0]).not.toEqual(createOwners.mock.calls[1][0])
})

it('opens a captured nonactive source and rejects a replaced installation without retargeting', async () => {
  rpc.mockImplementation(async (_connection, _profile, method) =>
    method === 'conversations.capabilities'
      ? { protocol_version: 1, enabled: false }
      : { participants: [{ participant: general, available: true }] }
  )
  const view = renderPath('/conversations/existing?connection=other-machine&installation=install')
  expect(await screen.findByText('Readable existing')).toBeTruthy()
  expect(rpc).toHaveBeenCalledWith('other-machine', 'default', 'conversations.participants', {})
  view.unmount()
  renderPath('/conversations/existing?connection=other-machine&installation=replaced')
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('Readable existing')).toBeNull()
})

it.each([false, true])(
  'keeps the exact project registration across catalog delays and retry (handoff=%s)',
  async handedOff => {
    const source = {
      install_id: 'install',
      registration_profile: 'writer',
      project_id: 'project',
      execution_environment_id: 'environment',
      cwd: '/same/path'
    }

    const project = {
      connectionId: 'remote',
      source,
      project: {
        id: 'project',
        install_id: 'install',
        environment_id: 'environment',
        canonical_path: '/same/path',
        sources: [source]
      }
    } as OpenSharedProject

    sharedProjectWindow.opened.set([project])
    let catalog!: (value: unknown) => void
    rpc.mockImplementation(async (_connection, _profile, method) =>
      method === 'conversations.capabilities'
        ? { protocol_version: 1, enabled: true }
        : new Promise(resolve => {
            catalog = resolve
          })
    )
    create.mockRejectedValueOnce(new Error('interrupted')).mockResolvedValue({})

    if (handedOff) {
      sharedProjectWindow.opened.set([])
    }
    renderPath(
      `/conversations/new?project=${encodeURIComponent(sharedOpenKey(project))}`,
      handedOff ? { projectSelection: project } : undefined
    )
    await waitFor(() => expect(catalog).toBeDefined())
    sharedProjectWindow.opened.set([{ ...project, source: { ...source, registration_profile: 'reviewer' } }])
    await act(async () => catalog({ participants: [{ participant: general, available: true }] }))
    expect((await screen.findByRole('alert')).textContent).toContain('interrupted')
    expect(create.mock.calls[0][0].project_ref).toEqual(source)
    rpc.mockImplementation(async (_connection, _profile, method) =>
      method === 'conversations.capabilities'
        ? { protocol_version: 1, enabled: true }
        : { participants: [{ participant: general, available: true }] }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText(/^Readable /)
    expect(create.mock.calls[1][0].project_ref).toEqual(source)
    expect(createOwners.mock.calls[0][0]).toEqual(createOwners.mock.calls[1][0])
  }
)

it('does not create after the new route is left during catalog discovery', async () => {
  let catalog!: (value: unknown) => void
  rpc.mockImplementation(async (_connection, _profile, method) =>
    method === 'conversations.capabilities'
      ? { protocol_version: 1, enabled: true }
      : new Promise(resolve => {
          catalog = resolve
        })
  )
  const view = renderPath('/conversations/new')
  await waitFor(() => expect(catalog).toBeDefined())
  view.unmount()
  await act(async () => catalog({ participants: [{ participant: general, available: true }] }))
  expect(create).not.toHaveBeenCalled()
})

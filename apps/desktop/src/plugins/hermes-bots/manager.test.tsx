import type * as HermesSdk from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $selectedBot, $selectedRosterKey } from './bot-state'
import type * as Data from './data'
import { translateBots } from './i18n-test-helper'
import { BotManager, cycleManagedBot, openManagedBot, requestCreateManagedBot } from './manager'
import { MANAGER_DETAILS_KEY } from './manager-details'
import type { ProfileDescribeResponse } from './profile-config'
import type * as Recent from './recent-session'
import type * as Routing from './routing'
import type { RosterRow } from './types'

const mocks = vi.hoisted(() => ({
  useRoster: vi.fn(),
  refetch: vi.fn(async () => ({ data: { profiles: [] } })),
  openBot: vi.fn(async (_bot: RosterRow) => true),
  deleteBot: vi.fn(async () => undefined),
  requestBot: vi.fn(async (): Promise<ProfileDescribeResponse> => ({
    model: { default: '', provider: '' },
    skills: []
  })),
  effectiveModel: vi.fn(async (_profile: string, _route?: { connectionId: string }) => ({
    label: 'GLM-5.3-Flash',
    model: 'catalog-glm',
    provider: 'aino'
  })),
  cachedRoster: vi.fn(),
  importBot: vi.fn(async (): Promise<string | null> => 'imported'),
  exportBot: vi.fn(async (): Promise<string | null> => '/archive.tar.gz'),
  recent: vi.fn(async () => true),
  notifyError: vi.fn(),
  notify: vi.fn()
}))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: {
      ...sdk.host,
      profiles: {
        ...sdk.host.profiles,
        effectiveModel: mocks.effectiveModel,
        import: mocks.importBot,
        export: mocks.exportBot
      },
      notify: mocks.notify,
      notifyError: mocks.notifyError
    },
    usePluginI18n: () => translateBots
  }
})
vi.mock('./data', async importOriginal => ({
  ...(await importOriginal<typeof Data>()),
  useRoster: mocks.useRoster,
  cachedUnionRoster: mocks.cachedRoster
}))
vi.mock('./routing', async importOriginal => ({
  ...(await importOriginal<typeof Routing>()),
  requestForBot: mocks.requestBot
}))
vi.mock('./recent-session', async importOriginal => ({
  ...(await importOriginal<typeof Recent>()),
  openBotRecentSession: mocks.recent
}))
vi.mock('./roster-actions', () => ({ openRosterBot: mocks.openBot }))
vi.mock('./profile-ops', () => ({ deleteBot: mocks.deleteBot }))
vi.mock('./roster-pane-lifecycle', () => ({ usePublishRosterSnapshot: vi.fn() }))
vi.mock('./create-dialog', () => ({
  CreateGroupChatDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div aria-label="Create group" role="dialog">
        <button onClick={onClose}>Close group</button>
      </div>
    ) : null,
  CreateAgentDialog: (props: { open: boolean; openAfterCreate?: boolean; onClose: () => void }) =>
    props.open ? (
      <div aria-label="Create Bot" role="dialog">
        <span>{String(props.openAfterCreate)}</span>
        <button onClick={props.onClose}>Finish creating</button>
      </div>
    ) : null
}))
vi.mock('./edit-profile-dialog', () => ({
  EditProfileDialog: ({ bot, open, onClose }: { bot: RosterRow | null; open: boolean; onClose: () => void }) =>
    open ? (
      <div aria-label="Edit Bot" role="dialog">
        <span>{bot?.connectionId}</span>
        <button onClick={onClose}>Finish editing</button>
      </div>
    ) : null
}))

const assistant: RosterRow = { name: 'default', connectionId: 'local', connectionLabel: 'This computer' }

const local: RosterRow = {
  name: 'research',
  title: 'Research',
  connectionId: 'local',
  connectionLabel: 'This computer',
  sourceScoped: true,
  route: { connectionId: 'local', mode: 'local', profile: 'research', targetProfile: 'research' }
}

const remote: RosterRow = {
  ...local,
  connectionId: 'studio',
  connectionLabel: 'Studio',
  remoteSource: true,
  route: { ...local.route!, connectionId: 'studio', mode: 'remote' }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useRoster.mockReturnValue({
    data: { profiles: [remote, assistant, local], sources: [] },
    isLoading: false,
    error: null,
    refetch: mocks.refetch
  })
  mocks.deleteBot.mockResolvedValue(undefined)
  mocks.effectiveModel.mockResolvedValue({ label: 'GLM-5.3-Flash', model: 'catalog-glm', provider: 'aino' })
  mocks.cachedRoster.mockReturnValue({ profiles: [remote, assistant, local] })
  $selectedRosterKey.set('')
  $selectedBot.set('default')
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})
afterEach(cleanup)

const renderManager = (client = new QueryClient()) =>
  render(
    <QueryClientProvider client={client}>
      <BotManager />
    </QueryClientProvider>
  )

it('keeps the main assistant separate and selects exact source-qualified bots without opening a chat', async () => {
  renderManager()
  const rows = screen.getAllByRole('button', { name: /Aino|Research ·/ })
  expect(rows[0].textContent).toContain('Aino')
  fireEvent.click(screen.getByRole('button', { name: 'Research · Studio' }))
  expect(mocks.openBot).not.toHaveBeenCalled()
  const detail = screen.getByRole('complementary', { name: 'Research · Studio' })
  expect(await within(detail).findByText('GLM-5.3-Flash')).toBeTruthy()
  expect(mocks.requestBot).toHaveBeenCalledWith(
    remote,
    'profiles.describe',
    { name: 'research' },
    { spawnPriority: 'foreground' }
  )
  fireEvent.click(within(detail).getByRole('button', { name: 'Edit Bot' }))
  expect(screen.getByRole('dialog', { name: 'Edit Bot' }).textContent).toContain('studio')
  fireEvent.click(screen.getByRole('button', { name: 'Finish editing' }))
  expect(mocks.refetch).toHaveBeenCalled()
})

it('shows the effective built-in default when the profile config intentionally has no provider pin', async () => {
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: 'Research · This computer' }))
  const detail = screen.getByRole('complementary', { name: 'Research · This computer' })

  expect(await within(detail).findByText('GLM-5.3-Flash')).toBeTruthy()
  expect(within(detail).queryByText('Not set')).toBeNull()
  expect(mocks.effectiveModel).toHaveBeenCalledWith('research', local.route)
})

it('keeps effective models isolated when the same bot name exists on different sources', async () => {
  mocks.effectiveModel.mockImplementation(async (_profile, route) =>
    route?.connectionId === 'studio'
      ? { label: 'Custom studio model', model: 'studio-model', provider: 'custom:studio' }
      : { label: 'GLM-5.3-Flash', model: 'catalog-glm', provider: 'aino' }
  )
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: 'Research · Studio' }))
  expect(await screen.findByText('Custom studio model')).toBeTruthy()
  expect(mocks.effectiveModel).toHaveBeenCalledWith('research', remote.route)

  fireEvent.click(screen.getByRole('button', { name: 'Research · This computer' }))
  const detail = screen.getByRole('complementary', { name: 'Research · This computer' })
  expect(await within(detail).findByText('GLM-5.3-Flash')).toBeTruthy()
  expect(within(detail).queryByText('Custom studio model')).toBeNull()
})

it('shows a model lookup failure with retry instead of claiming the bot has no model', async () => {
  mocks.effectiveModel.mockRejectedValueOnce(new Error('Model route unavailable'))
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: 'Research · This computer' }))
  const detail = screen.getByRole('complementary', { name: 'Research · This computer' })

  expect(await within(detail).findByText('Failed to load bots')).toBeTruthy()
  expect(within(detail).queryByText('Not set')).toBeNull()
  fireEvent.click(within(detail).getByRole('button', { name: 'Retry' }))
  expect(await within(detail).findByText('GLM-5.3-Flash')).toBeTruthy()
})

it('retires detail caches on workspace unmount so another account cannot reuse the previous model', async () => {
  const client = new QueryClient()
  const view = renderManager(client)
  fireEvent.click(screen.getByRole('button', { name: 'Research · This computer' }))
  expect(await screen.findByText('GLM-5.3-Flash')).toBeTruthy()
  view.unmount()
  await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: MANAGER_DETAILS_KEY })).toHaveLength(0))

  mocks.effectiveModel.mockResolvedValue({ label: 'New account model', model: 'new-account', provider: 'aino' })
  renderManager(client)
  fireEvent.click(screen.getByRole('button', { name: 'Research · This computer' }))
  expect(screen.queryByText('GLM-5.3-Flash')).toBeNull()
  expect(await screen.findByText('New account model')).toBeTruthy()
})

it('opens the selected bot through its canonical chat operation and never deletes the main assistant', async () => {
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: /Aino/ }))
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Research · Studio' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open Bot Chat' }))
  await waitFor(() => expect(mocks.openBot).toHaveBeenCalledWith(remote))
})

it('uses the existing creator without opening a chat, including a request received before mounting', async () => {
  requestCreateManagedBot()
  renderManager()
  const create = await screen.findByRole('dialog', { name: 'Create Bot' })
  expect(create.textContent).toContain('false')
  fireEvent.click(screen.getByRole('button', { name: 'Finish creating' }))
  expect(mocks.refetch).toHaveBeenCalled()
  expect(mocks.openBot).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'New bot' }))
  expect(screen.getByRole('dialog', { name: 'Create Bot' })).toBeTruthy()
})

it('keeps a refused deletion available for retry and deletes only the confirmed source owner', async () => {
  mocks.deleteBot.mockRejectedValueOnce(new Error('Machine is unavailable'))
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: 'Research · Studio' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await screen.findByText('Machine is unavailable')
  expect(mocks.deleteBot).toHaveBeenLastCalledWith(remote)
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(mocks.deleteBot).toHaveBeenCalledTimes(2)
})

it('routes archive actions through the SDK and preserves access to an existing ordinary Bot session', async () => {
  const withHistory = { ...local, last_session: { id: 'legacy-history', title: 'Previous research' } }
  mocks.useRoster.mockReturnValue({ data: { profiles: [withHistory] }, isLoading: false, refetch: mocks.refetch })
  renderManager()
  fireEvent.click(screen.getByRole('button', { name: 'Research · This computer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Previous research' }))
  await waitFor(() => expect(mocks.recent).toHaveBeenCalledWith(withHistory))
  fireEvent.click(screen.getByRole('button', { name: /Export bot…/i }))
  await waitFor(() =>
    expect(mocks.exportBot).toHaveBeenCalledWith(
      'research',
      expect.objectContaining({ connectionId: 'local', profile: 'research' })
    )
  )
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: /Import bot…/i }))
  await waitFor(() => expect(mocks.importBot).toHaveBeenCalledOnce())
  expect(mocks.openBot).not.toHaveBeenCalled()
})

it('opens and cycles exact owners from the current source even before the management page mounts', async () => {
  await openManagedBot('research')
  expect(mocks.openBot).toHaveBeenLastCalledWith(local)
  $selectedRosterKey.set('local::research')
  await cycleManagedBot(1)
  expect(mocks.openBot).toHaveBeenLastCalledWith(assistant)
  $selectedRosterKey.set('local::default')
  await cycleManagedBot(-1)
  expect(mocks.openBot).toHaveBeenLastCalledWith(local)
  expect(mocks.openBot.mock.calls.some(([bot]) => bot === remote)).toBe(false)
  $selectedRosterKey.set('')
  $selectedBot.set('local::research')
  await cycleManagedBot(1)
  expect(mocks.openBot).toHaveBeenLastCalledWith(assistant)
})

it('reports an archive failure and makes the action available for retry', async () => {
  mocks.importBot.mockRejectedValueOnce(new Error('Could not read archive'))
  renderManager()
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'Enter' })
  const action = await screen.findByRole('menuitem', { name: /Import bot…/i })
  fireEvent.click(action)
  await waitFor(() =>
    expect(mocks.notifyError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Could not read archive' }),
      expect.any(String)
    )
  )
  fireEvent.keyDown(screen.getByRole('button', { name: 'Actions' }), { key: 'Enter' })
  expect((await screen.findByRole('menuitem', { name: /Import bot…/i })).hasAttribute('data-disabled')).toBe(false)
  expect(mocks.openBot).not.toHaveBeenCalled()
})

it('shows actual descriptions and scope, and keeps both collaboration entries usable', async () => {
  mocks.useRoster.mockReturnValue({
    data: { profiles: [{ ...local, description: 'Research source material' }, assistant] },
    isLoading: false,
    refetch: mocks.refetch
  })
  renderManager()
  expect(screen.getByText('Research source material')).toBeTruthy()
  expect(screen.getByText('Independent settings')).toBeTruthy()
  expect(screen.getByText('Default bot')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Create group chat' }))
  expect(screen.getByRole('dialog', { name: 'Create group' })).toBeTruthy()
})

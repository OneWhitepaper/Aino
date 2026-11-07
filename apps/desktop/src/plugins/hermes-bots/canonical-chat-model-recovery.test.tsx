import type * as HermesSdk from '@hermes/plugin-sdk'
import { useValue } from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Exercise the real notification button and editor across the plugin boundary.
// eslint-disable-next-line no-restricted-imports
import { NotificationStack } from '@/components/notifications'
// eslint-disable-next-line no-restricted-imports
import { clearNotifications } from '@/store/notifications'

import { $editingBot } from './bot-state'
import { notifyBotOpenFailure } from './canonical-chat'
import { $botMeta } from './data'
import { EditProfileDialog } from './edit-profile-dialog'
import { translateBots } from './i18n-test-helper'
import type { RosterRow } from './types'

const mocks = vi.hoisted(() => ({ request: vi.fn(), requestProfile: vi.fn(), revealPane: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: {
      ...sdk.host,
      request: mocks.request,
      requestProfile: mocks.requestProfile,
      revealPane: mocks.revealPane
    },
    usePluginI18n: () => translateBots,
    CapabilitiesView: Object.assign(() => null, { supportsFixedConnection: true })
  }
})

vi.mock('./avatar-picker', () => ({ AvatarPicker: () => null }))

const $paneVisible = atom(false)

function RecoveryEditor() {
  const visible = useValue($paneVisible)
  const bot = useValue($editingBot)

  return visible ? <EditProfileDialog bot={bot} onClose={() => $editingBot.set(null)} open={Boolean(bot)} /> : null
}

beforeEach(() => {
  vi.clearAllMocks()
  clearNotifications()
  $botMeta.set({})
  $editingBot.set(null)
  $paneVisible.set(false)
  mocks.revealPane.mockImplementation(() => $paneVisible.set(true))
  mocks.request.mockRejectedValue(new Error('The foreground profile must not receive bot configuration'))
  mocks.requestProfile.mockImplementation(async (_route, method) => {
    if (method === 'profiles.describe') {
      return { model: { provider: 'old-provider', default: 'old-model' }, skills: [], toolsets: [], mcp_servers: [] }
    }

    if (method === 'profiles.configure') {
      return { applied: { model: true } }
    }

    return {}
  })
})

afterEach(() => {
  cleanup()
  clearNotifications()
  $editingBot.set(null)
})

it.each(['local', 'remote'] as const)(
  'opens a hidden editor and saves the failed %s bot model on its captured owner',
  async mode => {
    const bot: RosterRow = {
      name: 'ops-alias',
      connectionId: 'other-connection',
      sourceScoped: true,
      remoteSource: mode === 'remote',
      route: { connectionId: 'other-connection', mode, profile: 'ops-alias', targetProfile: 'ops' }
    }

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NotificationStack />
        <RecoveryEditor />
      </QueryClientProvider>
    )
    act(() => notifyBotOpenFailure(new Error('model_unavailable'), bot, 'open'))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Configure model' }))

    expect(await screen.findByRole('dialog')).not.toBeNull()
    expect(mocks.revealPane).toHaveBeenCalledWith('hermes-bots:pane')
    fireEvent.click(screen.getByRole('button', { name: /^Advanced/ }))
    const provider = await screen.findByDisplayValue('old-provider')
    const model = await screen.findByDisplayValue('old-model')

    fireEvent.change(provider, { target: { value: 'new-provider' } })
    fireEvent.change(model, { target: { value: 'new-model' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.requestProfile).toHaveBeenCalledWith(
      bot.route,
      'profiles.configure',
      { name: 'ops', provider: 'new-provider', model: 'new-model' },
      undefined,
      { spawnPriority: 'foreground' }
    )
    expect(mocks.requestProfile.mock.calls.every(([route]) => route.connectionId === bot.connectionId)).toBe(true)
    expect(mocks.request).not.toHaveBeenCalled()
  }
)

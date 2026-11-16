import type * as HermesSdk from '@hermes/plugin-sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { CreateAgentDialog } from './create-dialog'
import type * as Data from './data'
import { translateBots } from './i18n-test-helper'

const mocks = vi.hoisted(() => ({ request: vi.fn(), openBot: vi.fn(async () => true), saveMeta: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, request: mocks.request, connections: async () => [], notify: vi.fn() },
    usePluginI18n: () => translateBots
  }
})
vi.mock('./data', async importOriginal => ({ ...(await importOriginal<typeof Data>()), saveBotMeta: mocks.saveMeta }))
vi.mock('./roster-actions', () => ({ openRosterBot: mocks.openBot }))
vi.mock('./avatar-picker', () => ({ AvatarPicker: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.request.mockImplementation(async (method: string) =>
    method === 'setup.runtime_check' ? { ok: true } : { mcp_servers: [], skills: [], toolsets: [] }
  )
})
afterEach(cleanup)

it.each([false, undefined])('creates once and only opens the chat when requested (%s)', async openAfterCreate => {
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CreateAgentDialog
        onClose={onClose}
        open
        openAfterCreate={openAfterCreate}
        roster={[{ name: 'default', connectionId: 'local' }]}
      />
    </QueryClientProvider>
  )
  fireEvent.change(screen.getByPlaceholderText('inbox-triage'), { target: { value: 'research' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create Bot' }))
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  expect(mocks.request.mock.calls.filter(([method]) => method === 'profiles.create')).toHaveLength(1)
  expect(mocks.request).toHaveBeenCalledWith('setup.runtime_check', { profile: 'research' })

  if (openAfterCreate === false) {
    expect(mocks.openBot).not.toHaveBeenCalled()
  } else {
    await waitFor(() => expect(mocks.openBot).toHaveBeenCalledOnce())
  }
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

import { getCustomEndpoints } from '@/api/config'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { $routeRequest } from '@/store/recovery-requests'
import { $activeSessionId, $currentModel, $currentProvider } from '@/store/session'
import { deferred } from '@/test/deferred'
import { stubResizeObserver } from '@/test/jsdom'
import type { CustomEndpointsResponse } from '@/types/hermes'

import { ModelMenuPanel } from './model-menu-panel'

vi.mock('@/api/config', () => ({ getCustomEndpoints: vi.fn() }))
vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(async () => ({ capabilities: [] })),
  requestGatewayForProfile: vi.fn(async () => ({ capabilities: [] }))
}))

const providers = [{ slug: 'custom:lab', name: 'Lab', models: ['m1'], is_user_defined: true }]
const request = vi.fn(async () => ({ providers }))
const select = vi.fn()

const data = (api_mode: 'codex_responses' | 'chat_completions'): CustomEndpointsResponse => ({
  current: { provider: 'custom:lab', model: 'm1', base_url: 'https://example.invalid' },
  endpoints: [
    {
      id: 'lab',
      name: 'Lab',
      model: 'm1',
      models: ['m1'],
      base_url: 'https://example.invalid',
      api_mode,
      discover_models: false,
      has_api_key: false
    }
  ]
})

beforeAll(() => {
  stubResizeObserver()
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})
beforeEach(() => {
  $activeSessionId.set(null)
  $currentModel.set('m1')
  $currentProvider.set('custom:lab')
  select.mockClear()
})
afterEach(async () => {
  cleanup()
  await act(async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  })
})

function menu(client: QueryClient, owner: string) {
  return (
    <QueryClientProvider client={client}>
      <DropdownMenu open>
        <DropdownMenuContent>
          <ModelMenuPanel
            onSelectModel={select}
            ownerConnectionId={owner}
            profile="writer"
            requestGateway={request as never}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </QueryClientProvider>
  )
}

it('reads saved custom protocols on the menu owner, keeps stale source answers out and opens settings without selecting', async () => {
  const sourceA = deferred<CustomEndpointsResponse>()
  vi.mocked(getCustomEndpoints).mockImplementation(scope =>
    typeof scope === 'object' && scope?.connectionId === 'source-a'
      ? sourceA.promise
      : Promise.resolve(data('chat_completions'))
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(menu(client, 'source-a'))
  await waitFor(() =>
    expect(getCustomEndpoints).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'source-a', profile: 'writer' })
    )
  )
  expect((await screen.findAllByText('Code unverified')).length).toBeGreaterThan(0)
  view.rerender(menu(client, 'source-b'))
  await screen.findAllByText('Work only')
  await act(async () => sourceA.resolve(data('codex_responses')))
  expect(screen.queryByText('Code compatible')).toBeNull()
  const details = screen.getByRole('complementary', { name: 'Model details' })
  expect(within(details).getByText('Work only')).toBeDefined()
  fireEvent.click(within(details).getByRole('button', { name: 'Model settings' }))
  expect($routeRequest.get()?.path).toContain('tab=providers')
  expect($routeRequest.get()?.path).toContain('owner=source-b')
  expect($routeRequest.get()?.path).toContain('profile=writer')
  expect(select).not.toHaveBeenCalled()
})

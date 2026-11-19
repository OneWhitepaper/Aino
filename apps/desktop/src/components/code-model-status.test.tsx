import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { queryClient } from '@/lib/query-client'
import { requestGatewayForAgent } from '@/store/gateway'
import { gatewayRouteChanged } from '@/store/gateway-route-observation'
import { $routeRequest } from '@/store/recovery-requests'
import { deferred } from '@/test/deferred'

import type { PlatformModel } from '../../shared/platform-contract'

import { CodeModelEndpointsContext, CodeModelStatus } from './code-model-status'

vi.mock('@/store/gateway', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestGatewayForAgent: vi.fn(),
  requestGatewayForProfile: vi.fn()
}))

beforeEach(() => {
  vi.mocked(requestGatewayForAgent).mockReset()
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: [] })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
})

function status(owner = 'source-a', api_mode: PlatformModel['api_mode'] = 'chat_completions') {
  return (
    <CodeModelEndpointsContext.Provider value={{ scope: { connectionId: owner, profile: 'writer' } }}>
      <CodeModelStatus details model="m1" platformModel={{ id: 'm1', api_mode }} provider="aino" />
    </CodeModelEndpointsContext.Provider>
  )
}

it('shows native and automatically adapted routes separately without certifying tool quality', async () => {
  const view = render(status('source-a', 'responses'))
  expect(screen.getByRole('status').dataset.codeModelCapability).toBe('compatible')
  expect(requestGatewayForAgent).not.toHaveBeenCalled()
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: ['code-model-protocol-bridge-v1'] })
  view.rerender(status())
  await waitFor(() => expect(screen.getByRole('status').dataset.codeModelCapability).toBe('adapted'))
  expect(screen.getByText('Code auto-adapted')).toBeDefined()
  expect(screen.getByRole('status').textContent).toMatch(/not verified/)
  fireEvent.click(screen.getByRole('button', { name: 'Model settings' }))
  expect($routeRequest.get()?.path).toContain('owner=source-a')
  expect($routeRequest.get()?.path).toContain('profile=writer')
})

it('discards an old owner response and clears bridge eligibility when the gateway reconnects', async () => {
  const pending = deferred<{ capabilities: string[] }>()
  vi.mocked(requestGatewayForAgent).mockImplementation(connection =>
    connection === 'source-a' ? pending.promise : Promise.resolve({ capabilities: [] })
  )
  const view = render(status())
  await waitFor(() => expect(requestGatewayForAgent).toHaveBeenCalled())
  expect(screen.getByRole('status').dataset.codeModelCapability).toBe('unverified')
  view.rerender(status('source-b'))
  await waitFor(() => expect(screen.getByRole('status').dataset.codeModelCapability).toBe('work-only'))
  await act(async () => pending.resolve({ capabilities: ['code-model-protocol-bridge-v1'] }))
  expect(screen.getByRole('status').dataset.codeModelCapability).toBe('work-only')

  vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: ['code-model-protocol-bridge-v1'] })
  act(() => gatewayRouteChanged())
  await waitFor(() => expect(screen.getByRole('status').dataset.codeModelCapability).toBe('adapted'))
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: [] })
  act(() => gatewayRouteChanged())
  await waitFor(() => expect(screen.getByRole('status').dataset.codeModelCapability).toBe('work-only'))
})

it('leaves a failed capability read unverified rather than offering automatic adaptation', async () => {
  vi.mocked(requestGatewayForAgent).mockRejectedValue(new Error('offline'))
  render(status())
  await waitFor(() => expect(requestGatewayForAgent).toHaveBeenCalled())
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  expect(screen.getByRole('status').dataset.codeModelCapability).toBe('unverified')
})

it('withdraws earlier bridge evidence while a refresh is pending or fails', async () => {
  vi.mocked(requestGatewayForAgent).mockResolvedValue({ capabilities: ['code-model-protocol-bridge-v1'] })
  render(status())
  await waitFor(() => expect(screen.getByRole('status').dataset.codeModelCapability).toBe('adapted'))
  const refresh = deferred<never>()
  vi.mocked(requestGatewayForAgent).mockReturnValue(refresh.promise)
  act(() => {
    void queryClient.invalidateQueries({ queryKey: ['code-model-runtime'] })
  })
  await waitFor(() => expect(screen.getByRole('status').dataset.codeModelCapability).toBe('unverified'))
  await act(async () => refresh.reject(new Error('offline')))
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  expect(screen.getByRole('status').dataset.codeModelCapability).toBe('unverified')
})

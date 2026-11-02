import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { queryClient } from '@/lib/query-client'
import { setPrimaryGateway, setPrimaryGatewayConnectionId } from '@/store/gateway'

import { ConnectorsTab } from './connectors-tab'

const localController = vi.hoisted(() => ({
  config: {},
  availableCatalog: [{ name: 'bundled-weather', auth_type: 'none', required_env: [] }],
  catalog: [],
  catalogLoading: false,
  configLoading: false,
  profilePending: false,
  servers: { 'my-documents': { command: 'npx', args: ['@example/documents'] } },
  statuses: { 'my-documents': 'ok' },
  toolCounts: { 'my-documents': { on: 2, total: 2 } },
  usageByServer: {}
}))

vi.mock('../mcp/use-mcp-servers', () => ({ useMcpServers: () => localController }))

afterEach(() => {
  cleanup()
  queryClient.clear()
  setPrimaryGateway(null)
  vi.clearAllMocks()
})

describe('the local MCP directory', () => {
  it('loads the hosted directory by default while keeping custom, bundled and plugin servers usable', async () => {
    const rpc = vi.fn(async (method: string) => {
      if (method === 'connectors.list') {
        return { available: true, connectors: [] }
      }

      if (method === 'connectors.catalog') {
        return { connectors: [] }
      }

      if (method === 'connectors.accounts') {
        return { accounts: [] }
      }

      if (method === 'mcp.servers.list') {
        return {
          servers: [
            {
              name: 'notes__search',
              command: 'notes-server',
              args: [],
              enabled: true,
              source: 'plugin',
              plugin: 'notes'
            }
          ]
        }
      }

      if (method === 'mcp.servers.status') {
        return { servers: [{ name: 'notes__search', status: 'connected', tools: 1 }] }
      }

      throw new Error(`Unexpected request: ${method}`)
    })

    // SAFETY: directory queries use only the gateway request seam.
    setPrimaryGateway({ request: rpc } as never)
    setPrimaryGatewayConnectionId('connection-local')
    const openExternal = vi.fn()
    // SAFETY: the browser is an explicit action; it should not be used by opening the local page.
    window.hermesDesktop = { openExternal } as never

    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider configClient={null} initialLocale="en">
          <MemoryRouter>
            <ConnectorsTab gateway={null} profile="default" />
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByText('MCP · Plugin notes')).toBeTruthy())
    expect(screen.getByRole('button', { name: /My Documents/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Bundled Weather/ })).toBeTruthy()
    expect(rpc.mock.calls.map(([method]) => method).sort()).toEqual([
      'connectors.accounts',
      'connectors.catalog',
      'connectors.list',
      'mcp.servers.list',
      'mcp.servers.status'
    ])
    expect(screen.queryByText(/Nous/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(openExternal).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add your own' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Connect to a custom MCP')).toBeTruthy()
    expect(screen.getByLabelText('Command to launch')).toBeTruthy()
  })
})

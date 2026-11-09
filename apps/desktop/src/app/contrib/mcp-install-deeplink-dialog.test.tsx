import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { en } from '@/i18n/en'
import { $mcpInstallRequest } from '@/store/mcp-deeplink-install'

import { McpInstallDeepLinkDialog } from './mcp-install-deeplink-dialog'

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }))
vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getHermesConfigRecord: (...args: unknown[]) => api.read(...args),
  saveMcpServers: (...args: unknown[]) => api.save(...args)
}))
vi.mock('@/app/hooks/use-config-record', () => ({ setHermesConfigCache: vi.fn() }))

const config = { command: `/review/${'unbroken-resource-'.repeat(15)}`, args: ['--review-only'] }
const copy = en.settings.mcp

beforeEach(() => {
  api.read.mockResolvedValue({ mcp_servers: { existing: { url: 'https://existing.example.test' } } })
  $mcpInstallRequest.set({ name: 'review-local', transport: 'stdio', config })
})

afterEach(() => {
  cleanup()
  $mcpInstallRequest.set(null)
  vi.resetAllMocks()
})

function renderRequest() {
  render(
    <MemoryRouter>
      <I18nProvider configClient={null} initialLocale="en">
        <McpInstallDeepLinkDialog />
      </I18nProvider>
    </MemoryRouter>
  )
}

it('shows the full requested config and treats Escape as cancellation without writing it', async () => {
  renderRequest()
  const dialog = await screen.findByRole('dialog')
  expect(dialog.textContent).toContain(config.command)
  expect(dialog.textContent).toContain(copy.deepLinkStdioWarning)

  fireEvent.keyDown(dialog, { key: 'Escape' })

  expect($mcpInstallRequest.get()).toBeNull()
  expect(api.save).not.toHaveBeenCalled()
})

it('keeps a failed install visible and retries over the latest server configuration', async () => {
  api.save.mockRejectedValueOnce(new Error('Cannot write while offline')).mockResolvedValueOnce({})
  renderRequest()
  const confirm = await screen.findByRole('button', { name: copy.deepLinkConfirm })
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(confirm)

  expect((await screen.findByRole('alert')).textContent).toContain('Cannot write while offline')
  expect(screen.getByRole('dialog').textContent).toContain(config.command)
  expect($mcpInstallRequest.get()?.config).toBe(config)

  const external = { url: 'https://added-elsewhere.example.test' }
  api.read.mockResolvedValue({ mcp_servers: { external } })
  fireEvent.click(screen.getByRole('button', { name: copy.deepLinkConfirm }))

  await waitFor(() => expect($mcpInstallRequest.get()).toBeNull())
  expect(api.save).toHaveBeenLastCalledWith({ external, 'review-local': config })
  expect(api.save).toHaveBeenCalledTimes(2)
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type * as PreviewModule from '@/store/preview'
import type { ToolSession } from '@/store/tool-session'

const mocks = vi.hoisted(() => ({ openPreview: vi.fn(), current: vi.fn(() => true) }))

vi.mock('@/store/preview', async original => ({
  ...(await original<typeof PreviewModule>()),
  openPreview: mocks.openPreview
}))
vi.mock('./use-summary-session', () => ({ summarySessionIsCurrent: mocks.current }))

import { SummaryResourceList } from './resource-list'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('opens a summary resource for its captured Bot chat owner after tool focus moves', async () => {
  const session: ToolSession = {
    busy: false,
    cwd: '/bot-project',
    owner: { connectionId: 'local', profile: 'research' },
    runtimeId: 'bot-runtime',
    scope: { connectionId: 'local', profile: 'research' },
    storedId: 'bot-chat',
    sourceKey: 'bot-source',
    target: 'tile:bot-chat'
  }

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <I18nProvider configClient={null} initialLocale="en">
      <QueryClientProvider client={client}>
        <SummaryResourceList
          items={[{ id: 'reference', kind: 'url', label: 'Reference', target: 'https://example.com/reference' }]}
          session={session}
        />
      </QueryClientProvider>
    </I18nProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: /Reference/ }))
  await waitFor(() =>
    expect(mocks.openPreview).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'url', url: 'https://example.com/reference' }),
      'bot-chat',
      'bot-runtime',
      'research',
      { browser: 'matching-url' }
    )
  )
})

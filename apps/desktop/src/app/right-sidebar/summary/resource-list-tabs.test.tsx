import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $rightRailActiveTabId } from '@/store/layout'
import { $browserPages, $previewTabs, closeRightRail, noteBrowserPage, openPreview } from '@/store/preview'
import { $activeSessionId, $selectedStoredSessionId } from '@/store/session'
import type { ToolSession } from '@/store/tool-session'

vi.mock('./use-summary-session', () => ({ summarySessionIsCurrent: () => true }))

import { SummaryResourceList } from './resource-list'

const owner: ToolSession = {
  busy: false,
  cwd: '/work',
  owner: { connectionId: 'local', profile: 'default' },
  runtimeId: 'runtime',
  scope: { connectionId: 'local', profile: 'default' },
  storedId: 'chat',
  sourceKey: 'source',
  target: 'primary'
}

beforeEach(() => {
  closeRightRail()
  $browserPages.set({})
  $activeSessionId.set('runtime')
  $selectedStoredSessionId.set('chat')
})

afterEach(() => {
  cleanup()
  closeRightRail()
  $activeSessionId.set(null)
  $selectedStoredSessionId.set(null)
})

it('keeps existing files and browser pages while each summary resource opens its own reusable tab', async () => {
  openPreview({
    kind: 'url',
    label: 'Working page',
    source: 'https://example.com/work',
    url: 'https://example.com/work'
  })
  openPreview({ kind: 'file', label: 'notes.md', source: '/work/notes.md', url: 'file:///work/notes.md' })
  const original = $previewTabs.get()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  render(
    <I18nProvider configClient={null} initialLocale="en">
      <QueryClientProvider client={client}>
        <SummaryResourceList
          items={[
            { id: 'first', kind: 'url', label: 'First output', target: 'https://example.com/first' },
            { id: 'second', kind: 'url', label: 'Second output', target: 'https://example.com/second' }
          ]}
          session={owner}
        />
      </QueryClientProvider>
    </I18nProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: /First output/ }))
  await waitFor(() => expect($previewTabs.get()).toHaveLength(3))
  const firstId = $rightRailActiveTabId.get()

  fireEvent.click(screen.getByRole('button', { name: /Second output/ }))
  await waitFor(() => expect($previewTabs.get()).toHaveLength(4))
  expect($previewTabs.get().slice(0, 2)).toEqual(original)
  expect($rightRailActiveTabId.get()).not.toBe(firstId)

  fireEvent.click(screen.getByRole('button', { name: /First output/ }))
  await waitFor(() => expect($rightRailActiveTabId.get()).toBe(firstId))
  expect($previewTabs.get()).toHaveLength(4)
  expect($previewTabs.get().every(tab => !tab.temporary)).toBe(true)

  noteBrowserPage(firstId!, { url: 'https://example.com/navigated', title: 'Navigated away' })
  fireEvent.click(screen.getByRole('button', { name: /First output/ }))
  await waitFor(() => expect($previewTabs.get()).toHaveLength(5))
  expect($rightRailActiveTabId.get()).not.toBe(firstId)
  expect($browserPages.get()[firstId!]?.url).toBe('https://example.com/navigated')

  noteBrowserPage(firstId!, { url: 'https://example.com/second', title: 'Second output' })
  fireEvent.click(screen.getByRole('button', { name: /Second output/ }))
  await waitFor(() => expect($rightRailActiveTabId.get()).toBe(firstId))
  expect($previewTabs.get().find(tab => tab.id === firstId)?.target.url).toBe('https://example.com/first')
  expect($previewTabs.get()).toHaveLength(5)
})

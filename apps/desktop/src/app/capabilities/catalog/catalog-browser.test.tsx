import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { queryClient } from '@/lib/query-client'

import { PageSearchShell } from '../../page-search-shell'

import { CatalogBrowser } from './catalog-browser'
import { type CatalogKind, parseCatalog } from './catalog-data'
import { $catalogCardView } from './store'

beforeEach(() => {
  $catalogCardView.set(true)
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  $catalogCardView.set(true)
})

function setup(kind: CatalogKind, onToggle?: () => void) {
  const entries = parseCatalog(
    kind,
    ['alpha', 'beta'].map(name => ({
      name,
      identifier: `official/${name}`,
      installIdentifier: `official/${name}`,
      source: 'official',
      tier: 'official',
      category: name === 'alpha' ? 'memory' : 'voice',
      description: `${name} workflow`,
      repo: `https://github.com/example/${name}`,
      sourceUrl: `https://github.com/example/${name}`,
      docsUrl: `https://example.com/${name}`
    }))
  )

  queryClient.setQueryData(['public-catalog', kind], entries)
  const onInstall = vi.fn()

  function Harness() {
    const [query, setQuery] = useState('')

    return (
      <QueryClientProvider client={queryClient}>
        <PageSearchShell onSearchChange={setQuery} searchPlaceholder="Search catalog" searchValue={query}>
          <CatalogBrowser
            isInstalled={entry => entry.name === 'beta'}
            kind={kind}
            onInstall={onInstall}
            onQueryChange={setQuery}
            query={query}
            renderInstalledAction={entry =>
              onToggle && entry.name === 'beta' ? (
                <button aria-checked="true" aria-label="Enable beta" onClick={onToggle} role="switch" />
              ) : null
            }
          />
        </PageSearchShell>
      </QueryClientProvider>
    )
  }

  return { entries, onInstall, ...render(<Harness />) }
}

const card = (name: string) =>
  screen.getAllByRole('article').find(article => within(article).queryByRole('button', { name }))!

describe.each(['skills', 'plugins'] as const)('%s catalog layouts', kind => {
  it('replaces the previous category and clears the current category when clicked again', () => {
    setup(kind)
    const memory = screen.getByRole('button', { name: 'Memory' })
    const voice = screen.getByRole('button', { name: 'Voice' })
    const all = screen.getByRole('button', { name: 'All categories' })

    fireEvent.click(memory)
    expect(memory.getAttribute('aria-pressed')).toBe('true')
    expect(voice.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(card('alpha')).toBeTruthy()

    fireEvent.click(voice)
    expect(voice.getAttribute('aria-pressed')).toBe('true')
    expect(memory.getAttribute('aria-pressed')).toBe('false')
    expect(all.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(card('beta')).toBeTruthy()

    fireEvent.click(voice)
    expect(voice.getAttribute('aria-pressed')).toBe('false')
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('article')).toHaveLength(2)

    fireEvent.click(memory)
    fireEvent.click(all)
    expect(memory.getAttribute('aria-pressed')).toBe('false')
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it('lets the installed list toggle a capability without opening its details', () => {
    const onToggle = vi.fn()
    const { container, onInstall } = setup(kind, onToggle)
    fireEvent.click(screen.getByRole('button', { name: 'Installed 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    const row = container.querySelector('[data-catalog-list] [data-entry-id]')!
    fireEvent.click(within(row as HTMLElement).getByRole('switch', { name: 'Enable beta' }))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onInstall).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  if (kind === 'skills') {
    it('opens list details only on request and keeps installation separate', () => {
      const { entries, onInstall } = setup(kind)
      fireEvent.click(screen.getByRole('button', { name: 'List view' }))
      expect(screen.queryByRole('heading', { name: 'alpha' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Add alpha' }))
      expect(onInstall).toHaveBeenCalledExactlyOnceWith(entries[0])
      expect(screen.queryByRole('dialog')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'alpha' }))
      expect(screen.getByRole('dialog', { name: 'alpha' })).toBeTruthy()
    })
  }

  it('browses installed entries without installing or changing their state', async () => {
    const { onInstall } = setup(kind)
    fireEvent.click(screen.getByRole('button', { name: 'Installed 1' }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
    expect(within(card('beta')).getByRole('button', { name: 'beta' })).toBeTruthy()
    expect(onInstall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: kind === 'skills' ? 'Discover Skills' : 'Discover Plugins' }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2))
    expect(onInstall).not.toHaveBeenCalled()
  })

  it('defaults to cards, with installed entries marked added', () => {
    const { container } = setup(kind)

    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(container.querySelector('[data-catalog-list]')).toBeNull()
    expect(screen.getByRole('button', { name: 'List view' })).toBeTruthy()
    expect(within(card('beta')).getByRole<HTMLButtonElement>('button', { name: 'Added beta' }).disabled).toBe(true)
  })

  it('installs from the card + without opening its details', () => {
    const { entries, onInstall } = setup(kind)

    fireEvent.click(within(card('alpha')).getByRole('button', { name: 'Install alpha' }))

    expect(onInstall).toHaveBeenCalledExactlyOnceWith(entries[0])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the shared detail dialog with source links and the same install target', async () => {
    const { entries, onInstall } = setup(kind)
    fireEvent.click(screen.getByRole('button', { name: 'alpha' }))
    const dialog = screen.getByRole('dialog', { name: 'alpha' })

    expect(within(dialog).getByRole('link', { name: 'Repository' }).getAttribute('href')).toBe(entries[0].sourceUrl)
    expect(within(dialog).getByRole('link', { name: 'Documentation' }).getAttribute('href')).toBe(entries[0].docsUrl)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install alpha' }))
    expect(onInstall).toHaveBeenCalledExactlyOnceWith(entries[0])

    if (kind === 'plugins') {
      // Release the inspector before the existing plugin installation dialog opens.
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    } else {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
  })

  it('preserves the parent search and filter when switching to list and back', async () => {
    const { container } = setup(kind)
    const search = screen.getByRole<HTMLInputElement>('textbox', { name: 'Search catalog' })
    fireEvent.change(search, { target: { value: 'workflow' } })
    fireEvent.click(screen.getByRole('button', { name: /^Memory/, pressed: false }))
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    expect(container.querySelector(`[data-catalog-list="${kind}"]`)).not.toBeNull()
    expect(screen.queryByRole('article')).toBeNull()

    if (kind === 'plugins') {
      expect(screen.getByRole('heading', { name: 'alpha' })).toBeTruthy()
    } else {
      expect(screen.queryByRole('heading', { name: 'alpha' })).toBeNull()
    }

    expect(screen.getByRole('button', { name: 'alpha' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'beta' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Memory/, pressed: true })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Search catalog' })).toBe(search)
    expect(search.value).toBe('workflow')

    fireEvent.click(screen.getByRole('button', { name: 'Card view' }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /^Memory/, pressed: true })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

it('shares the saved layout choice when moving between Skills and Plugins', () => {
  setup('skills')
  fireEvent.click(screen.getByRole('button', { name: 'List view' }))
  expect($catalogCardView.get()).toBe(false)
  cleanup()

  const { container } = setup('plugins')
  expect(container.querySelector('[data-catalog-list="plugins"]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Card view' }))
  expect($catalogCardView.get()).toBe(true)
})

describe('Chinese catalog presentation', () => {
  it('searches Chinese descriptions while preserving names and installation targets', async () => {
    const [entry] = parseCatalog('skills', [
      {
        name: 'Apple Notes',
        identifier: 'apple-notes',
        installIdentifier: 'official/apple-notes',
        source: 'built-in',
        category: 'apple',
        categoryLabel: 'Apple',
        description: 'Manage Apple Notes via memo CLI: create, search, edit.'
      }
    ])

    queryClient.setQueryData(['public-catalog', 'skills'], [entry])
    const onInstall = vi.fn()

    function Harness() {
      const [query, setQuery] = useState('')

      return (
        <I18nProvider configClient={null} initialLocale="zh">
          <QueryClientProvider client={queryClient}>
            <PageSearchShell onSearchChange={setQuery} searchPlaceholder="搜索技能" searchValue={query}>
              <CatalogBrowser
                isInstalled={() => false}
                kind="skills"
                onInstall={onInstall}
                onQueryChange={setQuery}
                query={query}
              />
            </PageSearchShell>
          </QueryClientProvider>
        </I18nProvider>
      )
    }

    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Apple Notes' })).toBeTruthy()
    expect(screen.getByText(/创建、搜索和编辑/)).toBeTruthy()
    expect(screen.getByText('内置')).toBeTruthy()
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: '备忘录' } })
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '添加 Apple Notes' }))
    expect(onInstall).toHaveBeenCalledExactlyOnceWith(entry)
    fireEvent.click(screen.getByRole('button', { name: 'Apple Notes' }))
    expect(within(screen.getByRole('dialog')).getByText(/创建、搜索和编辑/)).toBeTruthy()
    expect(entry.description).toBe('Manage Apple Notes via memo CLI: create, search, edit.')
    expect(entry.installIdentifier).toBe('official/apple-notes')
  })
})

it('shows the built-in agent under the Aino brand without changing its installation identity', async () => {
  const entries = parseCatalog('skills', [
    {
      name: 'hermes-agent',
      source: 'built-in',
      installIdentifier: 'official/hermes-agent',
      category: 'autonomous-ai-agents'
    },
    { name: 'hermes-agent', source: 'GitHub', identifier: 'someone/hermes-agent', category: 'research' }
  ])

  queryClient.setQueryData(['public-catalog', 'skills'], entries)
  const onInstall = vi.fn()

  function Harness() {
    const [query, setQuery] = useState('')

    return (
      <QueryClientProvider client={queryClient}>
        <PageSearchShell onSearchChange={setQuery} searchPlaceholder="Search" searchValue={query}>
          <CatalogBrowser
            isInstalled={() => false}
            kind="skills"
            onInstall={onInstall}
            onQueryChange={setQuery}
            query={query}
          />
        </PageSearchShell>
      </QueryClientProvider>
    )
  }

  render(<Harness />)
  expect(screen.getByRole('button', { name: 'Aino Agent' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'hermes-agent' })).toBeTruthy()
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Aino Agent' } })
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'Add Aino Agent' }))
  expect(onInstall).toHaveBeenCalledExactlyOnceWith(entries[0])
  fireEvent.click(screen.getByRole('button', { name: 'Aino Agent' }))
  expect(screen.getByRole('dialog', { name: 'Aino Agent' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'List view' }))
  expect(screen.getByRole('button', { name: 'Aino Agent' })).toBeTruthy()
  expect(entries[0].name).toBe('hermes-agent')
  expect(entries[0].installIdentifier).toBe('official/hermes-agent')
})

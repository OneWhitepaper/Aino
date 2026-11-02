import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { stubMenuDomApis } from '@/test/jsdom'
import type { ConfigFieldSchema, HermesConfigRecord } from '@/types/hermes'

import { WorkspaceSettings } from './workspace-settings'

const fields: [string, ConfigFieldSchema][] = [
  ['terminal.cwd', { type: 'string' }],
  ['desktop.repo_scan_enabled', { type: 'boolean' }],
  ['desktop.repo_scan_roots', { type: 'list' }],
  ['desktop.repo_scan_exclude_paths', { type: 'list' }],
  ['terminal.persistent_shell', { type: 'boolean' }],
  ['terminal.env_passthrough', { type: 'list' }],
  ['code_execution.mode', { type: 'select', options: ['project', 'strict'] }],
  ['file_read_max_chars', { type: 'number' }]
]

const initialConfig: HermesConfigRecord = {
  terminal: { cwd: '.', persistent_shell: true, env_passthrough: ['NODE_ENV'] },
  desktop: { repo_scan_enabled: true, repo_scan_roots: ['/work'], repo_scan_exclude_paths: ['/work/vendor'] },
  code_execution: { mode: 'project' },
  file_read_max_chars: 100000
}

const onChange = vi.fn()
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')

beforeEach(() => {
  stubMenuDomApis()
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()

  if (originalScroll) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', originalScroll)
  } else {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  }
})

function Harness({ config: initial, subpage }: { config: HermesConfigRecord; subpage?: string }) {
  const [config, setConfig] = useState(initial)

  return (
    <WorkspaceSettings
      config={config}
      fields={fields}
      onConfigChange={next => {
        onChange(next)
        setConfig(next)
      }}
      subpage={subpage}
    />
  )
}

function renderPage({
  config = initialConfig,
  path = '/settings?tab=config:workspace',
  subpage
}: { config?: HermesConfigRecord; path?: string; subpage?: string } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider configClient={null} initialLocale="zh">
        <Harness config={structuredClone(config)} subpage={subpage} />
      </I18nProvider>
    </MemoryRouter>
  )
}

function row(key: string) {
  const element = window.document.getElementById(`setting-field-${key}`)
  expect(element).toBeTruthy()

  return element!
}

function openTab(index: number) {
  const tab = screen.getAllByRole('tab')[index]
  fireEvent.mouseDown(tab, { button: 0 })
  expect(tab.getAttribute('aria-selected')).toBe('true')
}

function draftList(key: string, value: string) {
  const input = within(row(key)).getByRole('textbox')
  fireEvent.change(input, { target: { value } })

  return input
}

describe('WorkspaceSettings', () => {
  it('keeps all eight existing settings available across the three categories', () => {
    renderPage()
    expect(screen.getAllByRole('tab')).toHaveLength(3)

    for (const key of [
      'terminal.cwd',
      'desktop.repo_scan_enabled',
      'desktop.repo_scan_roots',
      'desktop.repo_scan_exclude_paths'
    ]) {
      expect(row(key).hidden).toBe(false)
    }

    openTab(1)
    expect(within(row('terminal.persistent_shell')).getByRole('switch').getAttribute('aria-checked')).toBe('true')
    expect((within(row('terminal.env_passthrough')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('NODE_ENV')
    openTab(2)
    expect(within(row('code_execution.mode')).getAllByRole('radio')).toHaveLength(2)
    expect((within(row('file_read_max_chars')).getByRole('spinbutton') as HTMLInputElement).value).toBe('100000')
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['field=terminal.env_passthrough', 1, 'terminal.env_passthrough'],
    ['page=files', 2, 'code_execution.mode'],
    ['field=file_read_max_chars', 2, 'file_read_max_chars']
  ])('selects the category for an existing route %s', async (query, index, key) => {
    renderPage({ path: `/settings?tab=config:workspace&${query}` })
    await waitFor(() => expect(screen.getAllByRole('tab')[Number(index)].getAttribute('aria-selected')).toBe('true'))
    expect(
      within(row(String(key))).getByRole(
        key === 'code_execution.mode' ? 'radiogroup' : key === 'file_read_max_chars' ? 'spinbutton' : 'textbox'
      )
    ).toBeTruthy()
  })

  it('reveals a searched discovery field even when automatic discovery is disabled', async () => {
    renderPage({
      config: { ...initialConfig, desktop: { ...(initialConfig.desktop as object), repo_scan_enabled: false } },
      path: '/settings?tab=config:workspace&field=desktop.repo_scan_roots'
    })

    expect(await screen.findByRole('textbox', { name: /扫描|scan/i })).toBeTruthy()
    await waitFor(() => expect(window.document.activeElement).toBe(row('desktop.repo_scan_roots')))
    expect(within(row('desktop.repo_scan_enabled')).getByRole('switch').getAttribute('aria-checked')).toBe('false')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('commits newline or comma separated paths and preserves arrays while toggling discovery', () => {
    renderPage()
    const roots = draftList('desktop.repo_scan_roots', ' /work/one\n/work/two, /work/three, ')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.blur(roots)
    expect(onChange.mock.lastCall?.[0].desktop.repo_scan_roots).toEqual(['/work/one', '/work/two', '/work/three'])

    fireEvent.click(within(row('desktop.repo_scan_enabled')).getByRole('switch'))
    expect(onChange.mock.lastCall?.[0].desktop).toEqual({
      repo_scan_enabled: false,
      repo_scan_roots: ['/work/one', '/work/two', '/work/three'],
      repo_scan_exclude_paths: ['/work/vendor']
    })
    fireEvent.click(within(row('desktop.repo_scan_enabled')).getByRole('switch'))
    expect((within(row('desktop.repo_scan_roots')).getByRole('textbox') as HTMLTextAreaElement).value).toContain(
      '/work/two'
    )
  })

  it('retains an unfinished list draft while visiting another category', () => {
    renderPage()
    const input = draftList('desktop.repo_scan_roots', '/work/one,')
    openTab(1)
    openTab(0)
    const restored = within(row('desktop.repo_scan_roots')).getByRole('textbox') as HTMLTextAreaElement
    expect(restored.value).toBe('/work/one,')
    expect(restored).toBe(input)
  })

  it('does not save unchanged list values on blur', () => {
    renderPage()
    fireEvent.blur(within(row('desktop.repo_scan_roots')).getByRole('textbox'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('writes variable names as a list and preserves unrelated configuration', () => {
    renderPage()
    openTab(1)
    fireEvent.blur(draftList('terminal.env_passthrough', 'NODE_ENV\nCI, LANG'))
    expect(onChange.mock.lastCall?.[0].terminal.env_passthrough).toEqual(['NODE_ENV', 'CI', 'LANG'])
    expect(onChange.mock.lastCall?.[0].desktop).toEqual(initialConfig.desktop)
  })

  it('writes the original execution enum values when changing mode', () => {
    renderPage()
    openTab(2)
    const radios = within(row('code_execution.mode')).getAllByRole('radio') as HTMLInputElement[]
    fireEvent.click(radios.find(input => input.value === 'strict')!)
    expect(onChange.mock.lastCall?.[0].code_execution.mode).toBe('strict')
    fireEvent.click(radios.find(input => input.value === 'project')!)
    expect(onChange.mock.lastCall?.[0].code_execution.mode).toBe('project')
  })

  it.each(['', '0', '-1', '1.5'])('does not save invalid read limit %j and can recover to a valid number', value => {
    renderPage()
    openTab(2)
    const input = within(row('file_read_max_chars')).getByRole('spinbutton')
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '200000' } })
    fireEvent.blur(input)
    expect(onChange.mock.lastCall?.[0].file_read_max_chars).toBe(200000)
  })

  it('supports embedded explicit subpages without a second category navigation', () => {
    renderPage({ subpage: 'shell' })
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(within(row('terminal.env_passthrough')).getByRole('textbox')).toBeTruthy()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('preserves an existing legacy read limit until the user makes a valid edit', () => {
    renderPage({ config: { ...initialConfig, file_read_max_chars: 0 }, subpage: 'files' })
    expect((within(row('file_read_max_chars')).getByRole('spinbutton') as HTMLInputElement).value).toBe('0')
    expect(onChange).not.toHaveBeenCalled()
  })
})

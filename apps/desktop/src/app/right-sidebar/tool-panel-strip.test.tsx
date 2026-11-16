import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $previewTabs, type PreviewTab } from '@/store/preview'
import { stubMenuDomApis } from '@/test/jsdom'

import { openToolPanelChooser, openToolPanelResource } from './tool-panel-actions'
import { ToolPanelStrip } from './tool-panel-strip'

vi.mock('./tool-panel-actions', () => ({ openToolPanelChooser: vi.fn(), openToolPanelResource: vi.fn() }))

const previews: PreviewTab[] = [
  {
    id: 'url:browser',
    target: { kind: 'url', label: 'Website', source: 'https://example.com', url: 'https://example.com' }
  },
  {
    id: 'file:document',
    target: { kind: 'file', label: 'report.md', source: '/work/report.md', url: '/work/report.md', previewKind: 'text' }
  }
]

const previousTabs = $previewTabs.get()

beforeEach(() => {
  vi.clearAllMocks()
  stubMenuDomApis()
  $previewTabs.set(previews)
})
afterEach(() => {
  cleanup()
  $previewTabs.set(previousTabs)
})

function renderStrip(panes: string[], activeId = panes[0]) {
  const activate = vi.fn()
  render(
    <I18nProvider configClient={null} initialLocale="en">
      <ToolPanelStrip
        activate={activate}
        activeId={activeId}
        groupId="bot-tools"
        panes={panes}
        title={id => (id === 'schedule-tool' ? 'Schedules' : id)}
      />
    </I18nProvider>
  )

  return activate
}

it('keeps five stable destinations while selecting retained browser and file bodies', () => {
  const activate = renderStrip(['preview-tile:url:browser', 'preview-tile:file:document', 'review'])
  expect(screen.getAllByRole('tab')).toHaveLength(5)
  fireEvent.click(screen.getByRole('tab', { name: 'Browser' }))
  expect(activate).toHaveBeenLastCalledWith('preview-tile:url:browser')
  fireEvent.click(screen.getByRole('tab', { name: 'Files' }))
  expect(activate).toHaveBeenLastCalledWith('preview-tile:file:document')
  expect(openToolPanelResource).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('tab', { name: 'Terminal' }))
  expect(openToolPanelResource).toHaveBeenCalledExactlyOnceWith('terminal')
})

it('does not borrow a preview from another group and preserves keyboard activation', () => {
  const activate = renderStrip(['review'])
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Browser' }), { key: 'Enter' })
  expect(openToolPanelResource).toHaveBeenCalledExactlyOnceWith('browser')
  expect(activate).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Files' }), { key: 'ArrowRight' })
  expect(window.document.activeElement).toBe(screen.getByRole('tab', { name: 'Terminal' }))
})

it('keeps contributed tabs and the existing new-tab chooser reachable through plus', () => {
  const activate = renderStrip(['review', 'schedule-tool'])
  fireEvent.pointerDown(screen.getByRole('button', { name: 'List tabs' }), { button: 0, ctrlKey: false })
  fireEvent.click(screen.getByRole('menuitem', { name: 'Schedules' }))
  expect(activate).toHaveBeenCalledExactlyOnceWith('schedule-tool')
  fireEvent.pointerDown(screen.getByRole('button', { name: 'List tabs' }), { button: 0, ctrlKey: false })
  fireEvent.click(screen.getByRole('menuitem', { name: /New tab/ }))
  expect(openToolPanelChooser).toHaveBeenCalledExactlyOnceWith('bot-tools')
})

import { expect, it, vi } from 'vitest'

import { allPaneIds, findGroupOfPane } from '@/components/pane-shell/tree/model'
import { $layoutTree, activateTreePane, closeTabPane, restoreTreePane } from '@/components/pane-shell/tree/store'
import { isToolPanelGroup } from '@/components/pane-shell/tree/tool-panel-policy'
import { registry } from '@/contrib/registry'
import { LAYOUT_KEYS } from '@/lib/layout-persistence'
import { readKey } from '@/lib/storage'
import { setInterfaceMode } from '@/store/interface-mode'

vi.mock('@/contrib/plugins', () => ({ discoverBundledPlugins: () => undefined }))
vi.mock('@/contrib/runtime-loader', () => ({ discoverRuntimePlugins: () => undefined }))
vi.mock('./wiring', () => ({ ContribWiring: () => null, WiredPane: () => null }))

it('restores live Logs without stealing focus and removes closed Logs from another mode', async () => {
  await import('./controller')
  const paneFor = (id: string) => registry.getArea('panes').find(pane => pane.id === id)

  restoreTreePane('logs')
  activateTreePane(findGroupOfPane($layoutTree.get()!, 'files')!.id, 'files')
  setInterfaceMode('simple')
  await Promise.resolve()
  setInterfaceMode('advanced')
  await Promise.resolve()

  expect(paneFor('logs')).toBeTruthy()
  expect(findGroupOfPane($layoutTree.get()!, 'logs')?.active).toBe('files')

  setInterfaceMode('simple')
  await Promise.resolve()
  closeTabPane('logs')
  expect(paneFor('logs')).toBeUndefined()
  setInterfaceMode('advanced')
  await Promise.resolve()

  expect(allPaneIds($layoutTree.get()!)).not.toContain('logs')
  const tools = findGroupOfPane($layoutTree.get()!, 'files')!
  expect(tools.panes).toEqual(expect.arrayContaining(['files', 'review', 'terminal']))
  expect(isToolPanelGroup(tools, paneFor)).toBe(true)
  expect(allPaneIds(JSON.parse(readKey(LAYOUT_KEYS.tree)!))).not.toContain('logs')
}, 30_000)

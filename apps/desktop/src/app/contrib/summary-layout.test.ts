import { expect, it, vi } from 'vitest'

import { $activeTerminalId, $terminals } from '@/app/right-sidebar/terminal/terminals'
import { allPaneIds, findGroupOfPane, group, split } from '@/components/pane-shell/tree/model'
import { $layoutTree, markActivePreset } from '@/components/pane-shell/tree/store'
import { registry } from '@/contrib/registry'

vi.mock('@/contrib/plugins', () => ({ discoverBundledPlugins: () => undefined }))
vi.mock('@/contrib/runtime-loader', () => ({ discoverRuntimePlugins: () => undefined }))
vi.mock('./wiring', () => ({ ContribWiring: () => null, WiredPane: () => null }))

it('retires only the persisted summary pane while retaining custom workspace and terminal state', async () => {
  markActivePreset('custom')
  const chat = group(['workspace'], { id: 'saved-chat' })
  const terminal = group(['terminal'], { id: 'saved-terminal', tabStrip: 'never' })
  const files = group(['files', 'summary'], { active: 'files', id: 'saved-files', tabStrip: 'always' })
  $layoutTree.set(split('row', [group(['sessions']), split('column', [chat, terminal], [4, 1]), files]))
  const tabs = [{ auto: true, cwd: '/project', id: 'live-shell', kind: 'user' as const, title: 'zsh' }]
  $terminals.set(tabs)
  $activeTerminalId.set('live-shell')

  await import('./controller')

  const tree = $layoutTree.get()!
  expect(allPaneIds(tree)).not.toContain('summary')
  expect(registry.getArea('panes').some(pane => pane.id === 'summary')).toBe(false)
  const tools = findGroupOfPane(tree, 'files')!
  expect(tools).toMatchObject({ id: files.id, active: 'files', toolPanel: true })
  expect(tools.panes).toEqual(expect.arrayContaining(['files', 'review', 'terminal']))
  expect(findGroupOfPane(tree, 'workspace')).toEqual(chat)
  expect(findGroupOfPane(tree, 'terminal')).toBe(tools)
  expect($terminals.get()).toBe(tabs)
  expect($activeTerminalId.get()).toBe('live-shell')
}, 30_000)

import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('./right-rail/preview', () => ({ PreviewTilePane: () => null }))
vi.mock('./right-rail/preview-console-store', () => ({ forgetPreviewConsole: () => undefined }))

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

async function setup() {
  const mode = await import('@/store/interface-mode')
  const tree = await import('@/components/pane-shell/tree/store')
  const model = await import('@/components/pane-shell/tree/model')
  const { registry } = await import('@/contrib/registry')
  const preview = await import('@/store/preview')
  const session = await import('@/store/session')
  const edit = await import('@/store/preview-edit')
  const { watchPreviewTiles } = await import('./preview-tile')
  const { migrateToolPanelLayout } = await import('@/app/right-sidebar/tool-panel-actions')
  const policy = await import('@/components/pane-shell/tree/tool-panel-policy')
  const { fixedTrackSize } = await import('@/components/pane-shell/tree/renderer/track-model')
  const { LAYOUT_KEYS } = await import('@/lib/layout-persistence')

  for (const id of ['files', 'review', 'terminal']) {
    registry.register({ id, area: 'panes', data: { toolPanel: true, placement: 'right' }, render: () => null })
  }

  registry.register({
    id: 'workspace',
    area: 'panes',
    data: { placement: 'main', uncloseable: true },
    render: () => null
  })

  const layout = (name: string) =>
    model.split('row', [
      model.group(['workspace'], { id: `${name}-main` }),
      model.group(['files', 'review', 'terminal'], { id: `${name}-tools`, toolPanel: true })
    ])

  tree.declareDefaultTree(layout('advanced'), layout('simple'))
  migrateToolPanelLayout()
  mode.modeLayout.onRestore(() => queueMicrotask(migrateToolPanelLayout))
  tree.hydrateContributedPanes()
  watchPreviewTiles()
  session.$selectedStoredSessionId.set('session-a')

  const paneFor = (id: string) => registry.getArea('panes').find(pane => pane.id === id)

  const switchMode = async (next: 'advanced' | 'simple') => {
    mode.setInterfaceMode(next)
    await Promise.resolve()
  }

  return { tree, model, preview, session, edit, paneFor, switchMode, policy, fixedTrackSize, LAYOUT_KEYS }
}

const fileTarget = (path: string) => ({ kind: 'file', label: path, path, source: path, url: path }) as const

it('prunes a preview closed in another mode without restoring the legacy tool rail or changing that mode', async () => {
  const { tree, model, preview, paneFor, switchMode, policy, fixedTrackSize, LAYOUT_KEYS } = await setup()
  preview.openPreview(fileTarget('/work/closed.txt'))
  const tabId = preview.$previewTabs.get()[0]!.id
  const paneId = `preview-tile:${tabId}`
  expect(paneFor(paneId)).toBeDefined()

  await switchMode('simple')
  preview.closeRightRailTab(tabId)
  expect(paneFor(paneId)).toBeUndefined()
  expect(tree.treePanesWithPrefix('preview-tile:')).toEqual([])
  const simpleTree = tree.$layoutTree.get()
  const simpleSaved = window.localStorage.getItem(`${LAYOUT_KEYS.tree}.simple`)

  await switchMode('advanced')
  expect(tree.treePanesWithPrefix('preview-tile:')).toEqual([])
  const tools = model.findGroupOfPane(tree.$layoutTree.get()!, 'files')!
  expect(policy.isToolPanelGroup(tools, paneFor)).toBe(true)
  expect(fixedTrackSize({ ...tools, minimized: true }, 'row', { paneFor, paneGone: () => false, overrides: {} })).toBe(
    '0px'
  )
  const saved = JSON.parse(window.localStorage.getItem(LAYOUT_KEYS.tree)!)
  expect(model.allPaneIds(saved)).not.toContain(paneId)
  expect(window.localStorage.getItem(`${LAYOUT_KEYS.tree}.simple`)).toBe(simpleSaved)

  await switchMode('simple')
  expect(tree.$layoutTree.get()).toEqual(simpleTree)
})

it('keeps pinned previews visible and retains hidden live and dirty previews through mode restoration', async () => {
  const { tree, preview, session, edit, paneFor, switchMode } = await setup()
  preview.openPreview({ kind: 'url', label: 'Live page', source: 'https://live.example', url: 'https://live.example' })
  const liveId = preview.$previewTabs.get()[0]!.id
  preview.openPreview(fileTarget('/work/pinned.txt'))
  const pinnedId = preview.$previewTabs.get().at(-1)!.id
  preview.setPreviewTabPinned(pinnedId, true)
  preview.openPreview(fileTarget('/work/dirty.txt'))
  const dirtyId = preview.$previewTabs.get().at(-1)!.id
  edit.setPreviewDirty('/work/dirty.txt', true, dirtyId)
  const ids = [liveId, pinnedId, dirtyId]
  const contributions = ids.map(id => paneFor(`preview-tile:${id}`))
  contributions.forEach(pane => expect(pane).toBeDefined())

  await switchMode('simple')
  session.$selectedStoredSessionId.set('session-b')
  preview.closeRightRailTab(dirtyId)
  expect(edit.$pendingPreviewClose.get()).toBe(dirtyId)
  expect(tree.treePanesWithPrefix('preview-tile:')).toEqual([`preview-tile:${pinnedId}`])

  await switchMode('advanced')
  expect(tree.treePanesWithPrefix('preview-tile:')).toEqual([`preview-tile:${pinnedId}`])
  expect(preview.$previewTabs.get().map(tab => tab.id)).toEqual(ids)
  ids.forEach((id, index) => expect(paneFor(`preview-tile:${id}`)).toBe(contributions[index]))
  expect(edit.previewTabIsDirty(dirtyId, '/work/dirty.txt')).toBe(true)

  session.$selectedStoredSessionId.set('session-a')
  expect(new Set(tree.treePanesWithPrefix('preview-tile:'))).toEqual(new Set(ids.map(id => `preview-tile:${id}`)))
  ids.forEach((id, index) => expect(paneFor(`preview-tile:${id}`)).toBe(contributions[index]))
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./right-rail/preview', () => ({ PreviewTilePane: () => null }))
vi.mock('./right-rail/preview-console-store', () => ({ forgetPreviewConsole: () => undefined }))

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

async function setup() {
  const tree = await import('@/components/pane-shell/tree/store')
  const model = await import('@/components/pane-shell/tree/model')
  const tracks = await import('@/components/pane-shell/tree/renderer/track-model')
  const { registry } = await import('@/contrib/registry')
  const preview = await import('@/store/preview')
  const { watchPreviewTiles } = await import('./preview-tile')
  registry.registerMany([
    {
      id: 'workspace',
      area: 'panes',
      title: 'Chat',
      data: { placement: 'main', uncloseable: true },
      render: () => null
    },
    {
      id: 'files',
      area: 'panes',
      title: 'Files',
      data: { placement: 'right', toolPanel: true, width: '400px' },
      render: () => null
    }
  ])
  tree.declareDefaultTree(
    model.split('row', [model.group(['workspace']), model.group(['files'], { id: 'tools', toolPanel: true })])
  )
  tree.watchContributedPanes()
  watchPreviewTiles()

  const ctx = {
    paneFor: (id: string) => registry.getArea('panes').find(pane => pane.id === id),
    paneGone: () => false,
    overrides: {}
  }

  return { tree, model, tracks, preview, ctx }
}

const fileTarget = {
  kind: 'file',
  label: 'a.ts',
  path: '/work/a.ts',
  source: '/work/a.ts',
  url: 'file:///work/a.ts'
} as const

describe('unified tool panel', () => {
  it('keeps a user-hidden panel closed while pinned preview metadata changes or a new chat is selected', async () => {
    const { tree, model, preview } = await setup()
    const session = await import('@/store/session')
    session.$selectedStoredSessionId.set('first')
    preview.openPreview(fileTarget)
    const id = preview.$previewTabs.get()[0]!.id
    preview.setPreviewTabPinned(id, true)
    tree.setTreeGroupMinimized('tools', true)
    preview.$previewTabs.set(preview.$previewTabs.get().map(tab => ({ ...tab, target: { ...tab.target, label: 'Updated label' } })))
    expect(model.findGroup(tree.$layoutTree.get()!, 'tools')?.minimized).toBe(true)
    session.$selectedStoredSessionId.set(null)
    expect(model.findGroup(tree.$layoutTree.get()!, 'tools')?.minimized).toBe(true)
    preview.openPreview(fileTarget)
    expect(model.findGroup(tree.$layoutTree.get()!, 'tools')?.minimized).toBeFalsy()
  })

  it('restores another chat’s saved preview selection without opening its hidden panel', async () => {
    const { tree, model, preview } = await setup()
    const session = await import('@/store/session')
    session.$selectedStoredSessionId.set('first')
    preview.openPreview(fileTarget)
    session.$selectedStoredSessionId.set('second')
    preview.openPreview({ ...fileTarget, path: '/work/b.ts', source: '/work/b.ts', url: 'file:///work/b.ts' })
    tree.setTreeGroupMinimized('tools', true)
    session.$selectedStoredSessionId.set('first')
    expect(model.findGroup(tree.$layoutTree.get()!, 'tools')?.minimized).toBe(true)
  })

  it.each([
    fileTarget,
    { kind: 'url', label: 'Browser', source: 'https://example.com', url: 'https://example.com' } as const
  ])('keeps a user-hidden returning $kind preview folded after Files was closed', async target => {
    const { tree, model, preview } = await setup()
    const session = await import('@/store/session')
    const actions = await import('../right-sidebar/tool-panel-actions')
    session.$selectedStoredSessionId.set('first')
    preview.openPreview(target)
    const paneId = `preview-tile:${preview.$previewTabs.get()[0]!.id}`
    expect(tree.isPaneVisible(paneId)).toBe(true)
    actions.closeUnifiedFilesTab()
    const survivingPanel = model.findGroupOfPane(tree.$layoutTree.get()!, paneId)!
    // Closing Files leaves the preview visible; the user must hide that surviving panel.
    tree.setTreeGroupMinimized(survivingPanel.id, true)
    expect(tree.isPaneVisible(paneId)).toBe(false)
    session.$selectedStoredSessionId.set('second')
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, paneId)).toBeNull()
    session.$selectedStoredSessionId.set('first')
    expect(tree.isPaneVisible(paneId)).toBe(false)
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, paneId)?.minimized).toBe(true)
    preview.openPreview(target)
    expect(tree.isPaneVisible(paneId)).toBe(true)
  })

  it('opens a new browser explicitly after all tool hosts were removed', async () => {
    const { tree, preview } = await setup()
    const actions = await import('../right-sidebar/tool-panel-actions')
    actions.closeUnifiedFilesTab()
    preview.newBrowserTab()
    const paneId = `preview-tile:${preview.$previewTabs.get()[0]!.id}`
    expect(tree.isPaneVisible(paneId)).toBe(true)
  })

  it('keeps the user-selected terminal in front while preview metadata refreshes', async () => {
    const { tree, model, preview } = await setup()
    const { registry } = await import('@/contrib/registry')
    registry.register({
      id: 'terminal',
      area: 'panes',
      data: { placement: 'right', toolPanel: true },
      render: () => null
    })
    preview.openPreview(fileTarget)
    tree.restoreTreePane('terminal')
    preview.$previewTabs.set(preview.$previewTabs.get().map(tab => ({ ...tab, target: { ...tab.target, label: 'Saved' } })))
    expect(model.findGroup(tree.$layoutTree.get()!, 'tools')?.active).toBe('terminal')
    const id = preview.$previewTabs.get()[0]!.id
    preview.openPreview(fileTarget)
    expect(preview.$previewTabs.get()).toHaveLength(1)
    expect(tree.isPaneVisible(`preview-tile:${id}`)).toBe(true)
  })

  it.each([
    fileTarget,
    { kind: 'url', label: 'Browser', source: 'https://example.com', url: 'https://example.com' } as const
  ])('docks the first $kind preview in the files group', async target => {
    const { tree, model, preview } = await setup()
    preview.openPreview(target)
    const paneId = `preview-tile:${preview.$previewTabs.get()[0]!.id}`
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, paneId)?.id).toBe('tools')
  })

  it('hides the complete tool track and restores the same active tab', async () => {
    const { tree, model, tracks, preview, ctx } = await setup()
    preview.openPreview(fileTarget)
    const tabId = preview.$previewTabs.get()[0]!.id
    const paneId = `preview-tile:${tabId}`
    const panel = model.findGroupOfPane(tree.$layoutTree.get()!, 'files')!
    tree.setTreeGroupMinimized(panel.id, true)
    const hidden = model.findGroupOfPane(tree.$layoutTree.get()!, 'files')!
    expect(tracks.subtreeGone(hidden, ctx)).toBe(true)
    expect(tracks.fixedTrackSize(hidden, 'row', ctx)).toBe('0px')
    tree.restoreTreePane(paneId)
    expect(preview.$previewTabs.get()[0]!.id).toBe(tabId)
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, paneId)?.active).toBe(paneId)
  })
})

it('cycles and closes the focused tool tab without targeting the chat', async () => {
  const { tree, model, preview } = await setup()
  preview.openPreview(fileTarget)
  const pane = 'preview-tile:' + preview.$previewTabs.get()[0]!.id
  tree.noteActiveTreeGroup('tools')
  expect(tree.cycleTreeTabInFocusedZone(1)).toBe('files')
  tree.revealTreePane(pane)
  expect(tree.closeFocusedSessionTab()).toBe(true)
  expect(preview.$previewTabs.get()).toHaveLength(0)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'workspace')).toBeTruthy()
})

it('closes only Files while preserving the visible preview and restores Files by identity', async () => {
  const { tree, model, preview } = await setup()
  const actions = await import('../right-sidebar/tool-panel-actions')
  preview.openPreview(fileTarget)
  const pane = 'preview-tile:' + preview.$previewTabs.get()[0]!.id
  expect(actions.closeUnifiedFilesTab()).toBe(true)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, pane)?.minimized).toBeFalsy()
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, pane)?.active).toBe(pane)
  tree.restoreTreePane('files')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')?.id).toBe('tools')
})

it('restores a dismissed Files tab when the user explicitly applies a preset that places it', async () => {
  const { tree, model, preview } = await setup()
  const actions = await import('../right-sidebar/tool-panel-actions')
  const layout = await import('@/store/layout')
  tree.bindPaneVisibility(
    'files',
    layout.$fileBrowserOpen,
    () => layout.setFileBrowserOpen(false),
    () => layout.setFileBrowserOpen(true)
  )
  preview.openPreview(fileTarget)
  actions.closeUnifiedFilesTab()
  expect(tree.$dismissedPanes.get().has('files')).toBe(true)
  tree.applyTree(
    model.split('row', [model.group(['workspace']), model.group(['files'], { id: 'tools', toolPanel: true })]),
    'default'
  )
  expect(tree.$dismissedPanes.get().has('files')).toBe(false)
  expect(tree.isPaneVisible('files')).toBe(true)
  expect(preview.$previewTabs.get()).toHaveLength(1)
})

it('releases maximize when the existing titlebar minimizes the tool group', async () => {
  const { tree } = await setup()
  const view = await import('@/components/pane-shell/tree/tool-panel-view')
  view.toggleToolGroupMaximized('tools')
  tree.setTreeGroupMinimized('tools', true)
  expect(view.$maximizedToolGroup.get()).toBeNull()
})

it('keeps preview keyboard verbs after the user splits previews into a custom group', async () => {
  const { tree, model, preview } = await setup()
  preview.openPreview(fileTarget)
  const first = 'preview-tile:' + preview.$previewTabs.get()[0]!.id
  preview.openPreview({
    ...fileTarget,
    path: '/work/b.ts',
    source: '/work/b.ts',
    url: 'file:///work/b.ts',
    label: 'b.ts'
  })
  const second = 'preview-tile:' + preview.$previewTabs.get()[1]!.id
  tree.moveTreePane(first, { groupId: 'tools', pos: 'bottom' })
  const custom = model.findGroupOfPane(tree.$layoutTree.get()!, first)!
  tree.moveTreePane(second, { groupId: custom.id, pos: 'center' })
  tree.noteActiveTreeGroup(custom.id)
  expect(tree.cycleTreeTabInFocusedZone(1)).toBe(first)
  expect(tree.closeFocusedSessionTab()).toBe(true)
  expect(preview.$previewTabs.get()).toHaveLength(1)
})

it('keeps Files dismissed through startup hydration and restores it into the surviving tool group', async () => {
  const { tree, preview } = await setup()
  const actions = await import('../right-sidebar/tool-panel-actions')
  preview.openPreview(fileTarget)
  actions.closeUnifiedFilesTab()
  tree.persistTree()
  vi.resetModules()
  const restored = await import('@/components/pane-shell/tree/store')
  const model = await import('@/components/pane-shell/tree/model')
  const { registry } = await import('@/contrib/registry')
  registry.registerMany([
    {
      id: 'workspace',
      area: 'panes',
      title: 'Chat',
      data: { placement: 'main', uncloseable: true },
      render: () => null
    },
    {
      id: 'files',
      area: 'panes',
      title: 'Files',
      data: { placement: 'right', toolPanel: true, dock: { pane: 'workspace', pos: 'right' } },
      render: () => null
    },
    {
      id: 'preview-tile:file:file:///work/a.ts',
      area: 'panes',
      title: 'a.ts',
      data: { placement: 'right', toolPanel: true },
      render: () => null
    }
  ])
  restored.declareDefaultTree(
    model.split('row', [model.group(['workspace']), model.group(['files'], { id: 'tools', toolPanel: true })])
  )
  restored.hydrateContributedPanes()
  expect(restored.$dismissedPanes.get().has('files')).toBe(true)
  expect(model.findGroupOfPane(restored.$layoutTree.get()!, 'files')).toBeNull()
  restored.restoreTreePane('files')
  expect(restored.$dismissedPanes.get().has('files')).toBe(false)
  expect(model.findGroupOfPane(restored.$layoutTree.get()!, 'files')?.id).toBe('tools')
})

it('keeps explicit preview opens in their safe custom host while Files stays dismissed', async () => {
  const { tree, model, preview } = await setup()
  const { registry } = await import('@/contrib/registry')
  const actions = await import('../right-sidebar/tool-panel-actions')
  registry.register({
    id: 'terminal',
    area: 'panes',
    title: 'Terminal',
    data: { placement: 'right', toolPanel: true },
    render: () => null
  })
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files', 'terminal'], { id: 'tools', toolPanel: true })
    ])
  )
  preview.openPreview(fileTarget)
  const first = 'preview-tile:' + preview.$previewTabs.get()[0]!.id
  actions.closeUnifiedFilesTab()
  tree.moveTreePane(first, { groupId: 'tools', pos: 'bottom' })
  const custom = model.findGroupOfPane(tree.$layoutTree.get()!, first)!
  preview.openPreview({
    ...fileTarget,
    label: 'b.ts',
    path: '/work/b.ts',
    source: '/work/b.ts',
    url: 'file:///work/b.ts'
  })
  const second = 'preview-tile:' + preview.$previewTabs.get()[1]!.id
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, second)?.id).toBe(custom.id)
  expect(tree.$dismissedPanes.get().has('files')).toBe(true)
})

it('rehydrates session previews into the surviving tool group while Files stays dismissed', async () => {
  const { tree, model, preview } = await setup()
  const session = await import('@/store/session')
  const { registry } = await import('@/contrib/registry')
  const actions = await import('../right-sidebar/tool-panel-actions')
  registry.register({
    id: 'terminal',
    area: 'panes',
    title: 'Terminal',
    data: { placement: 'right', toolPanel: true },
    render: () => null
  })
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files', 'terminal'], { id: 'tools', toolPanel: true })
    ])
  )
  session.$selectedStoredSessionId.set('session-reload')
  preview.openPreview(fileTarget)
  const paneId = 'preview-tile:' + preview.$previewTabs.get()[0]!.id
  actions.closeUnifiedFilesTab()
  session.$selectedStoredSessionId.set('session-other')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, paneId)).toBeNull()
  session.$selectedStoredSessionId.set('session-reload')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, paneId)?.id).toBe('tools')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')).toBeNull()
  expect(tree.$dismissedPanes.get().has('files')).toBe(true)
})

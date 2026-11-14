import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('./right-rail/preview', () => ({ PreviewTilePane: () => null }))
vi.mock('./right-rail/preview-console-store', () => ({ forgetPreviewConsole: () => undefined }))

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

async function setup() {
  const tree = await import('@/components/pane-shell/tree/store')
  const model = await import('@/components/pane-shell/tree/model')
  const { registry } = await import('@/contrib/registry')
  const layout = await import('@/store/layout')
  const terminal = await import('../right-sidebar/store')
  const preview = await import('@/store/preview')
  const { watchPreviewTiles } = await import('./preview-tile')
  registry.registerMany([
    { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null },
    { id: 'plugin-pane', area: 'panes', source: 'plugin:test', render: () => null },
    ...['files', 'review', 'terminal'].map(id => ({
      id,
      area: 'panes',
      data: { toolPanel: true, placement: 'right' },
      render: () => null
    }))
  ])
  tree.declareDefaultTree(
    model.split('row', [
      model.group(['workspace', 'plugin-pane']),
      model.group(['files', 'review', 'terminal'], { id: 'tools', toolPanel: true })
    ])
  )
  tree.watchContributedPanes()
  watchPreviewTiles()

  return { tree, model, registry, layout, terminal, preview }
}

it.each(['files', 'review', 'terminal'])(
  'explicit tree restoration keeps %s in the safe Files host and preserves siblings',
  async paneId => {
    const { tree, model } = await setup()
    const anchor = paneId === 'files' ? 'review' : 'files'
    tree.$layoutTree.set(
      model.split('row', [
        model.group(['workspace', 'plugin-pane'], { id: 'chat' }),
        model.group([paneId], { id: 'legacy' }),
        model.group([anchor], { id: 'tools', toolPanel: true })
      ])
    )
    tree.$userPlacedPanes.set(new Set([paneId]))
    tree.restoreTreePane(paneId)
    const opened = tree.$layoutTree.get()!
    expect(model.findGroupOfPane(opened, paneId)?.id).toBe(paneId === 'files' ? 'legacy' : 'tools')
    expect(model.findGroupOfPane(opened, paneId)?.active).toBe(paneId)
    expect(model.findGroup(opened, 'chat')?.panes).toEqual(['workspace', 'plugin-pane'])

    if (paneId !== 'files') {
      expect(model.findGroup(opened, 'legacy')).toBeNull()
    }

    tree.restoreTreePane(paneId)
    expect(model.allPaneIds(tree.$layoutTree.get()!).filter(id => id === paneId)).toEqual([paneId])
  }
)

it('uses explicit Files and Terminal store setters without recreating terminal state', async () => {
  const { tree, model, layout, terminal } = await setup()
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files'], { id: 'files-legacy' }),
      model.group(['terminal'], { id: 'terminal-legacy' }),
      model.group(['review'], { id: 'tools', toolPanel: true })
    ])
  )
  terminal.$terminalInjection.set('keep-existing-command')
  layout.setFileBrowserOpen(true)
  terminal.setTerminalTakeover(true)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')?.id).toBe('files-legacy')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'terminal')?.id).toBe('files-legacy')
  expect(terminal.$terminalInjection.get()).toBe('keep-existing-command')
})

it('reopens an existing file and Browser in the host while preserving preview identity and dirty draft', async () => {
  const { tree, model, preview } = await setup()
  const edit = await import('@/store/preview-edit')

  const file = {
    kind: 'file',
    label: 'edit.ts',
    path: '/work/edit.ts',
    source: '/work/edit.ts',
    url: 'file:///work/edit.ts'
  } as const

  preview.openPreview(file)
  const fileTab = preview.$previewTabs.get()[0]!
  edit.setPreviewDirty(file.url, true, fileTab.id)
  tree.moveTreePane('preview-tile:' + fileTab.id, { groupId: 'tools', pos: 'bottom' })
  preview.openPreview(file)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'preview-tile:' + fileTab.id)?.id).toBe('tools')
  expect(preview.$previewTabs.get().find(tab => tab.id === fileTab.id)?.target).toEqual(file)
  expect(edit.previewTabIsDirty(fileTab.id, file.url)).toBe(true)
  preview.newBrowserTab()
  const browser = preview.$previewTabs.get().find(tab => tab.target.kind === 'url')!
  tree.moveTreePane('preview-tile:' + browser.id, { groupId: 'tools', pos: 'bottom' })
  preview.openBrowserTab()
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'preview-tile:' + browser.id)?.id).toBe('tools')
  expect(preview.$previewTabs.get().find(tab => tab.id === browser.id)).toBeTruthy()
  expect(edit.previewTabIsDirty(fileTab.id, file.url)).toBe(true)
})

it('does not invent a tool host in a simple chat-only tree or move a plugin restore', async () => {
  const { tree, model } = await setup()
  const mode = await import('@/store/interface-mode')
  mode.setInterfaceMode('simple')
  tree.$layoutTree.set(model.group(['workspace', 'terminal', 'plugin-pane'], { id: 'chat' }))
  const original = tree.$layoutTree.get()
  tree.restoreTreePane('terminal')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'terminal')?.id).toBe('chat')
  expect(tree.$layoutTree.get()?.type).toBe('group')
  tree.restoreTreePane('plugin-pane')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'plugin-pane')?.id).toBe('chat')
  expect(original?.type).toBe('group')
})

it('leaves reactive reveals in place while explicit tools prefer the chooser over Files', async () => {
  const { tree, model, registry } = await setup()
  registry.register({ id: 'tool-new-tab', area: 'panes', data: { toolPanel: true }, render: () => null })
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace', 'plugin-pane'], { id: 'chat' }),
      model.group(['files'], { id: 'files-tools', toolPanel: true }),
      model.group(['review'], { id: 'legacy-review' }),
      model.group(['terminal', 'tool-new-tab'], { id: 'chooser-tools', toolPanel: true })
    ])
  )
  tree.revealTreePane('review')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.id).toBe('legacy-review')
  tree.restoreTreePane('review')
  tree.restoreTreePane('files')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.id).toBe('chooser-tools')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')?.id).toBe('chooser-tools')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'workspace')?.panes).toEqual(['workspace', 'plugin-pane'])
})

it('routes the Files toggle and backend focus request through the same tool host', async () => {
  const { tree, model, layout } = await setup()
  const { revealDesktopPane } = await import('@/store/pane-focus')
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace', 'plugin-pane']),
      model.group(['files'], { id: 'legacy-files' }),
      model.group(['review'], { id: 'legacy-review' }),
      model.group(['terminal'], { id: 'tools', toolPanel: true })
    ])
  )
  layout.$fileBrowserOpen.set(false)
  layout.toggleFileBrowserOpen()
  expect(tree.isPaneVisible('files')).toBe(true)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')?.id).toBe('legacy-files')
  expect(revealDesktopPane('review')).toBe(true)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.id).toBe('legacy-files')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.active).toBe('review')
})

it('does not move or select foreground resources when a background owner opens a preview', async () => {
  const { tree, model, preview } = await setup()
  const session = await import('@/store/session')
  session.$selectedStoredSessionId.set('foreground')
  preview.openPreview({ kind: 'url', label: 'Foreground', source: 'https://example.com', url: 'https://example.com' })
  const foreground = preview.$previewTabs.get()[0]!
  const before = tree.$layoutTree.get()
  preview.openPreview(
    {
      kind: 'file',
      label: 'background',
      source: '/background.ts',
      path: '/background.ts',
      url: 'file:///background.ts'
    },
    'background-owner',
    'background-runtime',
    'default'
  )
  expect(tree.$layoutTree.get()).toBe(before)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'preview-tile:' + foreground.id)?.active).toBe(
    'preview-tile:' + foreground.id
  )
  expect(preview.$previewTabs.get().some(tab => tab.sessionId === 'background-owner')).toBe(true)
})

it('uses idempotent narrow open events for chooser, terminal and retained Browser resources', async () => {
  const { tree, model, preview, terminal } = await setup()
  const actions = await import('../right-sidebar/tool-panel-actions')
  const { PANE_TOGGLE_REVEAL_EVENT } = await import('@/components/pane-shell')
  const originalMatchMedia = window.matchMedia
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true })) })
  const events: { id: string; mode: string }[] = []
  const receive = (event: Event) => events.push((event as CustomEvent<{ id: string; mode: string }>).detail)
  window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, receive)

  try {
    actions.openToolPanelChooser('tools')
    expect(events.at(-1)).toEqual({ id: 'tool-new-tab', mode: 'open' })
    terminal.setTerminalTakeover(true)
    expect(events.at(-1)).toEqual({ id: 'terminal', mode: 'open' })
    preview.newBrowserTab()
    const browser = preview.$previewTabs.get().find(tab => tab.target.kind === 'url')!
    const paneId = 'preview-tile:' + browser.id
    expect(events.at(-1)).toEqual({ id: paneId, mode: 'open' })
    tree.setTreeGroupMinimized('tools', true)
    tree.restoreTreePane(paneId)
    tree.restoreTreePane(paneId)
    expect(events.slice(-2)).toEqual([
      { id: paneId, mode: 'open' },
      { id: paneId, mode: 'open' }
    ])
    expect(preview.$previewTabs.get().find(tab => tab.id === browser.id)).toBe(browser)
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, paneId)?.minimized).toBe(false)
    const before = events.length
    tree.revealTreePane(paneId)
    expect(events).toHaveLength(before)
  } finally {
    window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, receive)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
  }
})

it('keeps a chooser in an unmarked safe preview split created by an edge drag', async () => {
  const { tree, model, preview } = await setup()
  const actions = await import('../right-sidebar/tool-panel-actions')
  preview.newBrowserTab()
  const browser = preview.$previewTabs.get().find(tab => tab.target.kind === 'url')!
  const paneId = 'preview-tile:' + browser.id
  tree.moveTreePane(paneId, { groupId: 'tools', pos: 'bottom' })
  const split = model.findGroupOfPane(tree.$layoutTree.get()!, paneId)!
  expect(split.toolPanel).toBeUndefined()
  actions.openToolPanelChooser(split.id)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'tool-new-tab')?.id).toBe(split.id)
  tree.restoreTreePane('review')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.id).toBe(split.id)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')?.id).toBe('tools')
  expect(preview.$previewTabs.get().find(tab => tab.id === browser.id)).toBe(browser)
})

it('rejects an unmarked chooser source that contains an unknown pane', async () => {
  const { tree, model } = await setup()
  const actions = await import('../right-sidebar/tool-panel-actions')
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace', 'plugin-pane']),
      model.group(['files', 'terminal'], { id: 'tools', toolPanel: true }),
      model.group(['review', 'unknown-pane'], { id: 'unsafe-split' })
    ])
  )
  actions.openToolPanelChooser('unsafe-split')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'tool-new-tab')?.id).toBe('tools')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'unknown-pane')?.id).toBe('unsafe-split')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.id).toBe('unsafe-split')
})

it('keeps Simple-mode tool panes hidden when a contributed preset opens them as layout intent', async () => {
  const { tree, model, registry, layout, terminal } = await setup()
  const mode = await import('@/store/interface-mode')
  const presets = await import('@/components/pane-shell/tree/presets')
  mode.setInterfaceMode('simple')
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace', 'plugin-pane']),
      model.group(['files', 'review', 'terminal'], { id: 'tools', toolPanel: true })
    ])
  )
  layout.$fileBrowserOpen.set(false)
  terminal.$terminalTakeover.set(false)
  tree.bindPaneVisibility(
    'files',
    layout.$fileBrowserOpen,
    () => layout.setFileBrowserOpen(false),
    () => layout.setFileBrowserOpen(true)
  )
  tree.bindPaneVisibility(
    'terminal',
    terminal.$terminalTakeover,
    () => terminal.setTerminalTakeover(false),
    () => terminal.setTerminalTakeover(true)
  )

  const custom = model.split('row', [
    model.group(['workspace', 'plugin-pane']),
    model.group(['files', 'review', 'terminal'], { id: 'user-tools', toolPanel: true, active: 'review' })
  ])

  const id = 'plugin-simple-intent'
  registry.register({ area: 'layouts', id, source: 'plugin:test', data: custom })
  presets.applyLayoutPreset(id, custom)
  expect(layout.$fileBrowserOpen.get()).toBe(false)
  expect(terminal.$terminalTakeover.get()).toBe(false)
  expect(tree.$hiddenTreePanes.get().has('files')).toBe(true)
  expect(tree.$hiddenTreePanes.get().has('terminal')).toBe(true)
  expect(tree.isPaneVisible('files')).toBe(false)
  expect(tree.isPaneVisible('terminal')).toBe(false)
  layout.setFileBrowserOpen(true)
  terminal.setTerminalTakeover(true)
  expect(layout.$fileBrowserOpen.get()).toBe(true)
  expect(terminal.$terminalTakeover.get()).toBe(true)
  expect(tree.$hiddenTreePanes.get().has('files')).toBe(false)
  expect(tree.$hiddenTreePanes.get().has('terminal')).toBe(false)
  expect(tree.isPaneVisible('terminal')).toBe(true)
})

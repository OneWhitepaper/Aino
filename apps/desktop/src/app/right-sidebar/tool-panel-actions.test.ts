import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

async function setup() {
  const tree = await import('@/components/pane-shell/tree/store')
  const model = await import('@/components/pane-shell/tree/model')
  const { registry } = await import('@/contrib/registry')
  const actions = await import('./tool-panel-actions')
  const { modeLayout } = await import('@/store/interface-mode')
  const { $paneStates } = await import('@/store/panes')
  const storage = await import('@/lib/storage')

  registry.registerMany([
    ...['files', 'review', 'terminal'].map(id => ({
      id,
      area: 'panes',
      data: { placement: 'right', toolPanel: true },
      render: () => null
    })),
    { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null },
    { id: 'plugin-pane', area: 'panes', source: 'plugin:example', render: () => null },
    { id: 'protected-tool', area: 'panes', data: { toolPanel: true, uncloseable: true }, render: () => null }
  ])

  return { tree, model, registry, actions, $paneStates, storage, key: 'aino.desktop.toolPanel.v1.' + modeLayout.mode }
}

it.each([false, true])(
  'upgrades an old custom Files group even when migration was already recorded: %s',
  async done => {
    const { tree, model, registry, actions, storage, key } = await setup()
    const files = model.group(['files'], { id: 'old-files', active: 'files', minimized: true, tabStrip: 'never' })
    const original = model.split('row', [model.group(['workspace']), files], [4.25, 1.75], 'saved-root')
    tree.$layoutTree.set(original)
    tree.$activePresetId.set('custom')
    tree.$userPlacedPanes.set(new Set(['files']))

    if (done) {
      storage.writeKey(key, '1')
    }

    actions.migrateToolPanelLayout()
    const upgraded = tree.$layoutTree.get()!
    expect(upgraded).toEqual({ ...original, children: [original.children[0], { ...files, toolPanel: true }] })
    const writes: string[] = []

    const stop = storage.onPersistenceEvent(event => {
      if (event.op === 'write') {
        writes.push(event.key)
      }
    })

    actions.migrateToolPanelLayout()
    stop()
    expect(tree.$layoutTree.get()).toBe(upgraded)
    expect(writes).toEqual([])
    const tracks = await import('@/components/pane-shell/tree/renderer/track-model')
    const paneFor = (id: string) => registry.getArea('panes').find(pane => pane.id === id)
    expect(
      tracks.fixedTrackSize(model.findGroup(upgraded, files.id)!, 'row', {
        paneFor,
        paneGone: () => false,
        overrides: {}
      })
    ).toBe('0px')
    actions.openToolPanelChooser(files.id)
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'tool-new-tab')?.id).toBe(files.id)
  }
)

it('consolidates custom tool decks while preserving chat, active tab, visibility and preview registrations', async () => {
  const { tree, model, actions, $paneStates, storage, key } = await setup()

  const files = model.group(['files', 'preview-tile:restored-file', 'tool-new-tab'], {
    id: 'old-files',
    active: 'preview-tile:restored-file',
    minimized: true,
    tabStrip: 'never'
  })

  const center = model.split(
    'column',
    [model.group(['workspace']), model.group(['terminal'])],
    [3.5, 1.25],
    'custom-deck'
  )

  const original = model.split('row', [model.group(['sessions']), center, files], [1.25, 3.5, 2.75], 'saved-root')
  const states = { 'file-browser': { open: true, widthOverride: 423, heightOverride: 317 } }
  const hidden = new Set(['review'])
  const dismissed = new Set(['unrelated'])
  const collapsed = new Set<'left' | 'right'>(['left'])
  const placed = new Set(['files', 'terminal'])
  tree.$layoutTree.set(original)
  tree.$activePresetId.set('custom')
  tree.$userPlacedPanes.set(placed)
  tree.$hiddenTreePanes.set(hidden)
  tree.$dismissedPanes.set(dismissed)
  tree.$collapsedTreeSides.set(collapsed)
  $paneStates.set(states)
  storage.writeKey(key, '1')
  actions.migrateToolPanelLayout()
  const upgraded = tree.$layoutTree.get()!
  expect(upgraded).toEqual({
    ...original,
    children: [
      original.children[0],
      center.children[0],
      { ...files, panes: [...files.panes, 'terminal'], toolPanel: true }
    ]
  })
  expect(model.findGroup(upgraded, 'old-files')?.panes).toEqual([...files.panes, 'terminal'])
  expect(upgraded.type === 'split' && upgraded.weights).toEqual(original.weights)
  expect(tree.$userPlacedPanes.get()).toBe(placed)
  expect(tree.$hiddenTreePanes.get()).toBe(hidden)
  expect(tree.$dismissedPanes.get()).toBe(dismissed)
  expect(tree.$collapsedTreeSides.get()).toBe(collapsed)
  expect($paneStates.get()).toBe(states)
})

it.each(['workspace', 'plugin-pane', 'unknown-plugin', 'protected-tool', 'session-tile:chat', 'route-tile:settings'])(
  'does not turn a Files group mixed with %s into a unified tool panel',
  async other => {
    const { tree, model, actions, storage, key } = await setup()
    const original = model.split('row', [model.group(['workspace']), model.group(['files', other], { id: 'mixed' })])
    tree.$layoutTree.set(original)
    tree.$activePresetId.set('custom')
    storage.writeKey(key, '1')
    actions.migrateToolPanelLayout()
    expect(tree.$layoutTree.get()).toBe(original)
    tree.$activePresetId.set('default')
    storage.writeKey(key, null)
    actions.migrateToolPanelLayout()
    expect(tree.$layoutTree.get()).toBe(original)
  }
)

it('consolidates old default tool decks even when its earlier presentation migration was recorded', async () => {
  const { tree, model, actions, storage, key } = await setup()
  const files = model.group(['files', 'review'], { id: 'files', active: 'review', minimized: true })
  const deck = model.split('column', [model.group(['workspace']), model.group(['terminal'])], [4.5, 1.5], 'deck')
  const original = model.split('row', [deck, files], [3.25, 1.75], 'saved-default')
  tree.$layoutTree.set(original)
  tree.$activePresetId.set('default')
  storage.writeKey(key, '1')
  actions.migrateToolPanelLayout()
  expect(tree.$layoutTree.get()).toEqual({
    ...original,
    children: [deck.children[0], { ...files, panes: [...files.panes, 'terminal'], toolPanel: true }]
  })
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'terminal')?.id).toBe(files.id)
})

it('consolidates a built-in layout into one tool group', async () => {
  const { tree, model, actions } = await setup()

  const original = model.split('row', [
    model.group(['workspace']),
    model.group(['files'], { id: 'files' }),
    model.group(['review']),
    model.group(['terminal'])
  ])

  tree.$layoutTree.set(original)
  tree.$activePresetId.set('default')
  actions.migrateToolPanelLayout()
  const group = model.findGroupOfPane(tree.$layoutTree.get()!, 'files')!
  expect(group.panes).toEqual(['files', 'review', 'terminal'])
  expect(group.toolPanel).toBe(true)
})

it('consolidates a not-yet-migrated built-in group before its saved preview and chooser register', async () => {
  const { tree, model, actions } = await setup()

  const files = model.group(['files', 'preview-tile:saved', 'tool-new-tab'], {
    id: 'files',
    active: 'preview-tile:saved'
  })

  tree.$layoutTree.set(
    model.split('row', [model.group(['workspace']), files, model.group(['review']), model.group(['terminal'])])
  )
  tree.$activePresetId.set('default')
  actions.migrateToolPanelLayout()
  const migrated = model.findGroupOfPane(tree.$layoutTree.get()!, 'files')!
  expect(migrated.panes).toEqual(['files', 'preview-tile:saved', 'tool-new-tab', 'review', 'terminal'])
  expect(migrated.toolPanel).toBe(true)
})

it.each(['files', 'tool-new-tab'])(
  'restores the saved chooser registration at boot while keeping %s active',
  async active => {
    const first = await setup()
    first.tree.$layoutTree.set(
      first.model.split(
        'row',
        [
          first.model.group(['workspace']),
          first.model.group(['files', 'tool-new-tab'], { id: 'saved-tools', active, toolPanel: true, minimized: true })
        ],
        [3.75, 1.25],
        'saved-root'
      )
    )
    first.tree.$activePresetId.set('custom')
    first.storage.writeKey(first.key, '1')
    first.tree.persistTree()
    vi.resetModules()
    const { tree, model, registry, actions } = await setup()
    const { isToolPanelGroup } = await import('@/components/pane-shell/tree/tool-panel-policy')
    const original = tree.$layoutTree.get()!
    const paneFor = (id: string) => registry.getArea('panes').find(pane => pane.id === id)
    expect(paneFor('tool-new-tab')).toBeUndefined()
    actions.migrateToolPanelLayout()
    const chooser = paneFor('tool-new-tab')
    expect(chooser?.render).toBeTypeOf('function')
    expect(isToolPanelGroup(model.findGroup(original, 'saved-tools')!, paneFor)).toBe(true)
    expect(tree.$layoutTree.get()).toBe(original)
    expect(model.findGroup(original, 'saved-tools')?.active).toBe(active)
    expect(model.findGroup(original, 'saved-tools')?.minimized).toBe(true)
    tree.closeTreePane('tool-new-tab')
    expect(tree.$dismissedPanes.get().has('tool-new-tab')).toBe(true)
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'tool-new-tab')).toBeNull()
  }
)

it('renders a boot-restored chooser title in the locale loaded after registration', async () => {
  const { tree, model, registry, actions } = await setup()
  const { I18nProvider, resolveTranslations, setRuntimeI18nLocale } = await import('@/i18n')
  setRuntimeI18nLocale('en')
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files', 'tool-new-tab'], { id: 'tools', toolPanel: true })
    ])
  )
  tree.$activePresetId.set('custom')
  actions.migrateToolPanelLayout()
  const chooser = registry.getArea('panes').find(pane => pane.id === 'tool-new-tab')!
  const chrome = chooser.data as { tabTitle?: () => ReactNode; tabTitleText: () => string }

  const inLocale = (locale: string) =>
    renderToStaticMarkup(
      createElement(I18nProvider, {
        children: chrome.tabTitle?.() ?? chooser.title,
        configClient: null,
        initialLocale: locale
      })
    )

  expect(chooser.title).toBe(resolveTranslations('en').zones.newTab)
  expect(inLocale('en')).toBe(resolveTranslations('en').zones.newTab)
  expect(inLocale('zh')).toBe(resolveTranslations('zh').zones.newTab)
  expect(inLocale('zh')).not.toBe(chooser.title)
  setRuntimeI18nLocale('zh')

  try {
    expect(chrome.tabTitleText()).toBe(resolveTranslations('zh').zones.newTab)
  } finally {
    setRuntimeI18nLocale('en')
  }
})

it('does not register or adopt a chooser that is absent from the saved layout', async () => {
  const { tree, model, registry, actions } = await setup()
  tree.$layoutTree.set(model.split('row', [model.group(['workspace']), model.group(['files'], { toolPanel: true })]))
  tree.$activePresetId.set('custom')
  const original = tree.$layoutTree.get()
  actions.migrateToolPanelLayout()
  tree.watchContributedPanes()
  expect(registry.getArea('panes').some(pane => pane.id === 'tool-new-tab')).toBe(false)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'tool-new-tab')).toBeNull()
  expect(original && model.findGroupOfPane(original, 'files')?.panes).toEqual(['files'])
})

it('keeps a registered chooser out of another mode that never opened one', async () => {
  const { tree, model, actions } = await setup()
  const mode = await import('@/store/interface-mode')

  const defaults = model.split('row', [
    model.group(['workspace']),
    model.group(['files'], { id: 'tools', toolPanel: true })
  ])

  tree.declareDefaultTree(defaults, defaults)
  tree.watchContributedPanes()
  actions.openToolPanelChooser('tools')
  const advanced = tree.$layoutTree.get()
  mode.setInterfaceMode('simple')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'tool-new-tab')).toBeNull()
  mode.setInterfaceMode('advanced')
  expect(tree.$layoutTree.get()).toEqual(advanced)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'tool-new-tab')?.active).toBe('tool-new-tab')
})

it('opens a user-placed legacy Review as a tab in its chooser group without disturbing other splits', async () => {
  const { tree, model, actions } = await setup()
  const review = await import('@/store/review')
  const session = await import('@/store/session')
  session.$currentCwd.set('/chooser-project')
  session.$workspaceCwdOwner.set(session.$selectedStoredSessionId.get())
  const workspace = model.split('column', [model.group(['workspace']), model.group(['terminal'])], [4, 1], 'work')
  const legacy = model.group(['review', 'plugin-pane'], { id: 'old-review', active: 'plugin-pane' })
  const tools = model.group(['files'], { id: 'tools', toolPanel: true })
  tree.$layoutTree.set(model.split('row', [workspace, legacy, tools], [4.25, 1.25, 2], 'root'))
  tree.$userPlacedPanes.set(new Set(['review', 'terminal']))
  tree.$activePresetId.set('custom')
  tree.bindPaneVisibility('review', review.$reviewOpen, review.closeReview, review.restoreReview)
  actions.openToolPanelChooser('tools')
  const before = tree.$layoutTree.get()!
  const workBefore = before.type === 'split' && before.children[0]
  actions.openToolPanelResource('review')
  const opened = tree.$layoutTree.get()!
  expect(model.findGroupOfPane(opened, 'review')?.id).toBe('tools')
  expect(model.findGroupOfPane(opened, 'review')?.active).toBe('review')
  expect(model.findGroupOfPane(opened, 'files')?.panes).toEqual(['files', 'review'])
  expect(model.findGroup(opened, 'old-review')?.panes).toEqual(['plugin-pane'])
  expect(opened.type === 'split' && opened.children[0]).toEqual(workBefore)
  expect(opened.type === 'split' && opened.weights).toEqual([4.25, 1.25, 2])
  expect(tree.$userPlacedPanes.get()).toEqual(new Set(['review', 'terminal']))
  expect(review.$reviewScopeCwd.get()).toBe('/chooser-project')
  expect(review.$reviewScopeTarget.get()).toBe('main')
  actions.openToolPanelChooser('tools')
  actions.openToolPanelResource('review')
  expect(model.allPaneIds(tree.$layoutTree.get()!).filter(id => id === 'review')).toEqual(['review'])
  tree.closeTreePane('review')
  expect(review.$reviewOpen.get()).toBe(false)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')?.minimized).toBeFalsy()
  expect(tree.$hiddenTreePanes.get().has('files')).toBe(false)
  expect(tree.$dismissedPanes.get().has('files')).toBe(false)
})

it('uses the group that hosts the chooser instead of a different Files tool group', async () => {
  const { tree, model, registry, actions } = await setup()
  registry.register({ id: 'preview-tile:kept', area: 'panes', data: { toolPanel: true }, render: () => null })
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files'], { id: 'files-tools', toolPanel: true }),
      model.group(['review'], { id: 'old-review' }),
      model.group(['preview-tile:kept'], { id: 'source-tools', toolPanel: true })
    ])
  )
  actions.openToolPanelChooser('source-tools')
  const filesBefore = model.findGroupOfPane(tree.$layoutTree.get()!, 'files')
  actions.openToolPanelResource('review')
  const opened = tree.$layoutTree.get()!
  expect(model.findGroupOfPane(opened, 'review')?.id).toBe('source-tools')
  expect(model.findGroupOfPane(opened, 'review')?.active).toBe('review')
  expect(model.findGroupOfPane(opened, 'files')).toEqual(filesBefore)
  expect(model.findGroupOfPane(opened, 'preview-tile:kept')?.panes).toEqual(['preview-tile:kept', 'review'])
  expect(model.findGroup(opened, 'old-review')).toBeNull()
})

it('docks explicit Summary-style Review reveals while keeping their repository and composer origin', async () => {
  const { tree, model } = await setup()
  const review = await import('@/store/review')
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['review'], { id: 'legacy-review' }),
      model.group(['files'], { id: 'tools', toolPanel: true, minimized: true })
    ])
  )
  tree.$userPlacedPanes.set(new Set(['review']))
  review.revealReview('/summary-worktree', 'tile:summary-conversation', false)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.id).toBe('tools')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.active).toBe('review')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.minimized).toBe(false)
  expect(review.$reviewScopeCwd.get()).toBe('/summary-worktree')
  expect(review.$reviewScopeTarget.get()).toBe('tile:summary-conversation')
  const opened = tree.$layoutTree.get()
  review.revealReview('/summary-worktree', 'tile:summary-conversation', false)
  expect(tree.$layoutTree.get()).toBe(opened)
})

it('opens chooser Review for the focused tool conversation and keeps that origin on a passive restore', async () => {
  const { tree, model, registry, actions } = await setup()
  const session = await import('@/store/session')
  const states = await import('@/store/session-states')
  const { $activeGatewayProfile } = await import('@/store/profile')
  const { $toolSession } = await import('@/store/tool-session')
  const review = await import('@/store/review')

  const connection = { mode: 'local', connectionId: 'review-source', profile: 'coder' } as NonNullable<
    ReturnType<typeof session.$connection.get>
  >

  session.$connection.set(connection)
  $activeGatewayProfile.set('coder')
  session.$selectedStoredSessionId.set('main-conversation')
  session.$workspaceCwdOwner.set('main-conversation')
  session.$currentCwd.set('/main-project')
  states.$sessionTiles.set([
    {
      storedSessionId: 'focused-conversation',
      runtimeId: 'focused-runtime',
      ownerRoute: { connectionId: 'review-source', profile: 'coder' }
    }
  ])
  states.$sessionStates.set({
    'focused-runtime': { storedSessionId: 'focused-conversation', cwd: '/focused-worktree' } as never
  })
  registry.register({ id: 'session-tile:focused-conversation', area: 'panes', render: () => null })
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['session-tile:focused-conversation'], { id: 'focused-chat' }),
      model.group(['review'], { id: 'legacy-review' }),
      model.group(['files'], { id: 'tools', toolPanel: true })
    ])
  )
  tree.noteActiveTreeGroup('focused-chat')
  const origin = $toolSession.get()
  expect(origin).toMatchObject({
    cwd: '/focused-worktree',
    scope: { connectionId: 'review-source', profile: 'coder' },
    storedId: 'focused-conversation',
    target: 'tile:focused-conversation'
  })
  actions.openToolPanelChooser('tools')
  actions.openToolPanelResource('review')
  expect(review.$reviewScopeCwd.get()).toBe(origin.cwd)
  expect(review.$reviewScopeTarget.get()).toBe(origin.target)
  expect(review.reviewComposerTarget()).toBe(origin.target)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.id).toBe('tools')
  tree.noteActiveTreeGroup(null)
  review.restoreReview()
  expect(review.$reviewScopeCwd.get()).toBe('/focused-worktree')
  expect(review.$reviewScopeTarget.get()).toBe('tile:focused-conversation')
  expect(session.$connection.get()).toBe(connection)
  expect($activeGatewayProfile.get()).toBe('coder')
})

it('leaves the saved Review placement and pinned repo alone on passive restore', async () => {
  const { tree, model } = await setup()
  const review = await import('@/store/review')
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['review'], { id: 'custom-review' }),
      model.group(['files'], { id: 'tools', toolPanel: true })
    ])
  )
  review.openReview('/pinned-repository', 'tile:pinned-conversation', false)
  const original = tree.$layoutTree.get()
  review.restoreReview()
  expect(tree.$layoutTree.get()).toBe(original)
  expect(review.$reviewScopeCwd.get()).toBe('/pinned-repository')
  expect(review.$reviewScopeTarget.get()).toBe('tile:pinned-conversation')
})

it('explicitly opens Review on narrow screens after Escape, from Files and after dismissal', async () => {
  const { act, cleanup, fireEvent, render } = await import('@testing-library/react')
  const { tree, model, registry, actions } = await setup()
  const review = await import('@/store/review')
  const session = await import('@/store/session')
  const { PANE_TOGGLE_REVEAL_EVENT } = await import('@/components/pane-shell')
  const { NarrowOverlays } = await import('@/components/pane-shell/tree/renderer/narrow-overlays')
  const { stubResizeObserver } = await import('@/test/jsdom')
  stubResizeObserver()
  const originalMatchMedia = window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  })
  session.$currentCwd.set('/narrow-project')
  session.$workspaceCwdOwner.set(session.$selectedStoredSessionId.get())
  registry.registerMany(
    ['files', 'review'].map(id => ({
      id,
      area: 'panes',
      data: { placement: 'right', toolPanel: true, collapsible: true },
      render: () => createElement('div', { 'data-review-action-body': id }, id)
    }))
  )
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['review'], { id: 'legacy-review' }),
      model.group(['files'], { id: 'tools', toolPanel: true })
    ])
  )
  tree.bindPaneVisibility('review', review.$reviewOpen, review.closeReview, review.restoreReview)
  tree.$narrowViewport.set(true)
  const { container } = render(createElement(NarrowOverlays))
  const overlay = () => container.querySelector('[data-narrow-overlay]')?.getAttribute('data-narrow-overlay')

  const openFromChooser = () =>
    act(() => {
      actions.openToolPanelChooser('tools')
      actions.openToolPanelResource('review')
    })

  try {
    openFromChooser()
    expect(overlay()).toBe('review')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(overlay()).toBeUndefined()
    expect(review.$reviewOpen.get()).toBe(true)
    openFromChooser()
    expect(overlay()).toBe('review')
    act(() => {
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: 'files', mode: 'open' } }))
    })
    expect(overlay()).toBe('files')
    openFromChooser()
    expect(overlay()).toBe('review')
    act(() => review.revealReview('/narrow-project'))
    expect(overlay()).toBe('review')
    act(() => review.toggleReview('/narrow-project'))
    expect(overlay()).toBeUndefined()
    act(() => review.toggleReview('/narrow-project'))
    expect(overlay()).toBe('review')
    act(() => {
      tree.dismissTreePane('review')
      tree.setTreeGroupMinimized('tools', true)
    })
    openFromChooser()
    expect(overlay()).toBe('review')
    expect(tree.$dismissedPanes.get().has('review')).toBe(false)
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.active).toBe('review')
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.minimized).toBe(false)
  } finally {
    cleanup()
    tree.$narrowViewport.set(false)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
  }
})

it('releases a different maximized panel when an explicit Review selection targets its chooser group', async () => {
  const { tree, model, registry, actions } = await setup()
  const view = await import('@/components/pane-shell/tree/tool-panel-view')
  registry.register({ id: 'preview-tile:target', area: 'panes', data: { toolPanel: true }, render: () => null })
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files'], { id: 'maximized-tools', toolPanel: true }),
      model.group(['review'], { id: 'legacy-review' }),
      model.group(['preview-tile:target'], { id: 'target-tools', toolPanel: true })
    ])
  )
  actions.openToolPanelChooser('target-tools')
  view.$maximizedToolGroup.set('maximized-tools')
  actions.openToolPanelResource('review')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.id).toBe('target-tools')
  expect(view.$maximizedToolGroup.get()).toBeNull()
  view.$maximizedToolGroup.set('target-tools')
  actions.openToolPanelChooser('target-tools')
  actions.openToolPanelResource('review')
  expect(view.$maximizedToolGroup.get()).toBe('target-tools')
})

it('skips an unsafe marked group when a later safe tool panel can host Review', async () => {
  const { tree, model } = await setup()
  const review = await import('@/store/review')
  const mixed = model.group(['workspace', 'plugin-pane'], { id: 'mixed', toolPanel: true })
  tree.$layoutTree.set(
    model.split('row', [
      mixed,
      model.group(['review'], { id: 'legacy-review' }),
      model.group(['files'], { id: 'safe-tools', toolPanel: true })
    ])
  )
  review.revealReview('/safe-worktree', 'main', false)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.id).toBe('safe-tools')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'workspace')).toEqual(mixed)
})

it('closes only Files in an unmarked safe Files and Review group', async () => {
  const { tree, model, actions } = await setup()
  const layout = await import('@/store/layout')
  layout.$fileBrowserOpen.set(true)
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files', 'review'], { id: 'runtime-tools', active: 'files' })
    ])
  )
  tree.registerPaneCloser('files', () => {
    if (!actions.closeUnifiedFilesTab()) {
      layout.setFileBrowserOpen(false)
    }
  })
  tree.closeTreePane('files')
  expect(tree.$dismissedPanes.get().has('files')).toBe(true)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')).toBeNull()
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.id).toBe('runtime-tools')
  expect(tree.isPaneVisible('review')).toBe(true)
  expect(layout.$fileBrowserOpen.get()).toBe(true)
})

it.each(['unknown-pane', 'workspace', 'plugin-pane', 'protected-tool'])(
  'rejects Files close as unified when a marked group contains %s',
  async other => {
    const { tree, model, actions } = await setup()
    const original = model.group(['files', other], { id: 'unsafe', toolPanel: true })
    tree.$layoutTree.set(original)
    expect(actions.closeUnifiedFilesTab()).toBe(false)
    expect(tree.$layoutTree.get()).toBe(original)
    expect(tree.$dismissedPanes.get().has('files')).toBe(false)
  }
)

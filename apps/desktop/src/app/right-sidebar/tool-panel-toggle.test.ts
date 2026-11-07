import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

async function setup(side: 'left' | 'right' = 'right') {
  const tree = await import('@/components/pane-shell/tree/store')
  const model = await import('@/components/pane-shell/tree/model')
  const { registry } = await import('@/contrib/registry')
  const actions = await import('./tool-panel-actions')
  const layout = await import('@/store/layout')
  const review = await import('@/store/review')
  const session = await import('@/store/session')
  registry.registerMany([
    { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null },
    ...['files', 'review', 'terminal'].map(id => ({
      id,
      area: 'panes',
      data: { placement: 'right', toolPanel: true },
      render: () => null
    }))
  ])

  const tools = model.group(['files', 'review', 'terminal'], {
    id: 'tools',
    active: 'review',
    minimized: true,
    toolPanel: true
  })

  const main = model.group(['workspace'])
  tree.$layoutTree.set(model.split('row', side === 'right' ? [main, tools] : [tools, main]))
  tree.$hiddenTreePanes.set(new Set(['files', 'terminal']))
  session.$selectedStoredSessionId.set(null)
  session.$currentCwd.set('')
  session.$workspaceCwdOwner.set(null)

  return { tree, model, actions, layout, review, session, registry }
}

it.each(['left', 'right'] as const)(
  'opens a chooser instead of a legacy Review in a fresh draft on the %s',
  async side => {
    const { tree, model, actions, review } = await setup(side)
    actions.toggleToolPanelSide(side)
    expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'tool-new-tab')?.active).toBe('tool-new-tab')
    expect(review.$reviewOpen.get()).toBe(false)
  }
)

it('retains an explicitly selected review until a different draft lifecycle starts', async () => {
  const { tree, model, actions, session } = await setup()
  actions.openToolPanelResource('review')
  tree.setTreeGroupMinimized('tools', true)
  actions.toggleToolPanelSide('right')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.active).toBe('review')
  actions.toggleToolPanelSide('right')
  session.rotateFreshDraftKey()
  actions.toggleToolPanelSide('right')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'tool-new-tab')?.active).toBe('tool-new-tab')
})

it('retains Files explicitly selected without a project when the panel reopens', async () => {
  const { tree, model, actions, layout } = await setup()

  tree.bindPaneVisibility(
    'files',
    layout.$fileBrowserOpen,
    () => layout.setFileBrowserOpen(false),
    () => layout.setFileBrowserOpen(true)
  )
  actions.openToolPanelResource('files')
  expect(layout.$fileBrowserOpen.get()).toBe(true)
  tree.setTreeGroupMinimized('tools', true)
  actions.toggleToolPanelSide('right')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')?.active).toBe('files')
})

it('retains Review explicitly selected again in a new draft', async () => {
  const { tree, model, actions, session, review } = await setup()
  actions.openToolPanelResource('review')
  session.rotateFreshDraftKey()
  actions.openToolPanelResource('review')
  expect(review.reviewBelongsToCurrentDraft()).toBe(true)
  tree.setTreeGroupMinimized('tools', true)
  actions.toggleToolPanelSide('right')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'review')?.active).toBe('review')
})

it('restores a shown resource instead of a stale hidden active Review', async () => {
  const { tree, model, actions } = await setup()
  tree.$hiddenTreePanes.set(new Set(['files', 'review']))
  actions.toggleToolPanelSide('right')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'terminal')?.active).toBe('terminal')
})

it('opens the chooser on narrow windows and toggles that same overlay on the second press', async () => {
  const { actions } = await setup()
  const { PANE_TOGGLE_REVEAL_EVENT } = await import('@/components/pane-shell')
  const events: { id: string; mode: string }[] = []
  const original = window.matchMedia
  const receive = (event: Event) => events.push((event as CustomEvent).detail)
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: true })) })
  window.addEventListener(PANE_TOGGLE_REVEAL_EVENT, receive)

  try {
    actions.toggleToolPanelSide('right')
    expect(events.at(-1)).toEqual({ id: 'tool-new-tab', mode: 'open' })
    actions.toggleToolPanelSide('right')
    expect(events.at(-1)).toEqual({ id: 'tool-new-tab', mode: 'toggle' })
  } finally {
    window.removeEventListener(PANE_TOGGLE_REVEAL_EVENT, receive)
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: original })
  }
})

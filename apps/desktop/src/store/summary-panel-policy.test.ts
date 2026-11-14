import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

async function setup() {
  const { registry } = await import('@/contrib/registry')
  const tree = await import('@/components/pane-shell/tree/store')
  const model = await import('@/components/pane-shell/tree/model')
  const summary = await import('./summary')
  const { bindSummaryPanelVisibility } = await import('./summary-panel-policy')
  registry.registerMany([
    { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null },
    { id: 'files', area: 'panes', data: { placement: 'right', toolPanel: true }, render: () => null }
  ])
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files'], { id: 'tools', toolPanel: true, minimized: true })
    ])
  )

  return { tree, summary, dispose: bindSummaryPanelVisibility() }
}

it('folds summary when tools open, permits explicit reopening, and restores summary when tools close', async () => {
  const h = await setup()

  try {
    h.summary.$summaryOpen.set(true)
    h.tree.restoreTreePane('files')
    await Promise.resolve()
    expect(h.summary.$summaryOpen.get()).toBe(false)
    h.summary.toggleSummary()
    expect(h.summary.$summaryOpen.get()).toBe(true)
    h.summary.toggleSummary()
    h.tree.setTreeGroupMinimized('tools', true)
    await Promise.resolve()
    expect(h.summary.$summaryOpen.get()).toBe(true)
  } finally {
    h.dispose()
  }
})

it('does not reopen summary on a new draft or a background layout refresh', async () => {
  const h = await setup()

  try {
    const { rotateFreshDraftKey } = await import('./composer')
    h.summary.$summaryOpen.set(true)
    rotateFreshDraftKey()
    expect(h.summary.$summaryOpen.get()).toBe(false)
    h.tree.$layoutTree.set(structuredClone(h.tree.$layoutTree.get()))
    await Promise.resolve()
    expect(h.summary.$summaryOpen.get()).toBe(false)
  } finally {
    h.dispose()
  }
})

it('keeps a fresh draft quiet when its previous session tools leave in the same turn', async () => {
  const h = await setup()

  try {
    const { rotateFreshDraftKey } = await import('./composer')
    h.tree.restoreTreePane('files')
    await Promise.resolve()
    h.summary.toggleSummary()
    rotateFreshDraftKey()
    // Session-scoped preview mirrors remove their old pane during New Chat.
    h.tree.removeTreePane('files')
    await Promise.resolve()
    expect(h.summary.$summaryOpen.get()).toBe(false)
  } finally {
    h.dispose()
  }
})

it('preserves the summary choice while restoring a different interface layout', async () => {
  const h = await setup()

  try {
    const { setInterfaceMode } = await import('./interface-mode')
    h.tree.restoreTreePane('files')
    await Promise.resolve()
    setInterfaceMode('simple')
    await Promise.resolve()
    expect(h.summary.$summaryOpen.get()).toBe(false)
    h.summary.toggleSummary()
    setInterfaceMode('advanced')
    await Promise.resolve()
    expect(h.summary.$summaryOpen.get()).toBe(true)
  } finally {
    h.dispose()
  }
})

it('follows the visible narrow overlay rather than its saved docked expansion', async () => {
  const h = await setup()

  try {
    const { $narrowOverlayPaneIds } = await import('@/components/pane-shell/narrow-overlay-state')
    h.tree.$narrowViewport.set(true)
    h.summary.$summaryOpen.set(true)
    $narrowOverlayPaneIds.set(new Set(['files']))
    await Promise.resolve()
    expect(h.summary.$summaryOpen.get()).toBe(false)
    $narrowOverlayPaneIds.set(new Set())
    await Promise.resolve()
    expect(h.summary.$summaryOpen.get()).toBe(true)
  } finally {
    h.dispose()
  }
})

it('ignores transient visibility gaps while preview contributions are reconciled', async () => {
  const h = await setup()

  try {
    h.tree.restoreTreePane('files')
    await Promise.resolve()
    h.tree.setTreeGroupMinimized('tools', true)
    h.tree.restoreTreePane('files')
    await Promise.resolve()
    expect(h.summary.$summaryOpen.get()).toBe(false)
  } finally {
    h.dispose()
  }
})

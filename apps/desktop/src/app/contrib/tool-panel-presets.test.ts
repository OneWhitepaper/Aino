import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

it.each(['default', 'basic', 'focus', 'terminal-deck', 'quad', 'sidebar-left', 'sidebar-right'])(
  'keeps every core tool in one tab host when applying the %s layout',
  async id => {
    const { registry } = await import('@/contrib/registry')
    const { registerLayoutPresets } = await import('./layout-presets')
    const { applyLayoutPreset } = await import('@/components/pane-shell/tree/presets')
    const { $layoutTree } = await import('@/components/pane-shell/tree/store')
    const { findGroupOfPane } = await import('@/components/pane-shell/tree/model')
    registry.registerMany([
      ...['files', 'review', 'terminal'].map(id => ({
        id,
        area: 'panes',
        data: { toolPanel: true, placement: 'right' },
        render: () => null
      })),
      { id: 'sessions', area: 'panes', data: { placement: 'left' }, render: () => null },
      { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null }
    ])
    registerLayoutPresets()
    const preset = registry.getArea('layouts').find(preset => preset.id === id)!
    applyLayoutPreset(id, preset.data as Parameters<typeof applyLayoutPreset>[1])
    const tree = $layoutTree.get()!
    const tools = findGroupOfPane(tree, 'files')!
    expect(tools.toolPanel).toBe(true)
    expect(new Set(tools.panes)).toEqual(new Set(['files', 'review', 'terminal']))
    expect(findGroupOfPane(tree, 'review')?.id).toBe(tools.id)
    expect(findGroupOfPane(tree, 'terminal')?.id).toBe(tools.id)
    expect(tools.panes).not.toContain('workspace')
    expect(tools.panes).not.toContain('sessions')
  }
)

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
  const storage = await import('@/lib/storage')
  registry.registerMany([
    ...['files', 'review', 'terminal'].map(id => ({
      id,
      area: 'panes',
      data: { placement: 'right', toolPanel: true },
      render: () => null
    })),
    { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null },
    { id: 'sessions', area: 'panes', data: { placement: 'left' }, render: () => null },
    { id: 'plugin-pane', area: 'panes', source: 'plugin:example', render: () => null }
  ])

  return { tree, model, registry, actions, storage, key: 'aino.desktop.toolPanel.v1.' + modeLayout.mode }
}

it.each([false, true])('consolidates saved safe tools even after the old migration: %s', async migrated => {
  const { tree, model, actions, storage, key } = await setup()
  const rail = model.group(['sessions'], { id: 'rail' })
  const chat = model.group(['workspace'], { id: 'chat' })

  const files = model.group(['files', 'preview-tile:saved-file'], {
    id: 'tools',
    active: 'preview-tile:saved-file',
    tabStrip: 'never'
  })

  tree.$layoutTree.set(
    model.split(
      'row',
      [rail, chat, files, model.group(['review'], { minimized: true }), model.group(['terminal'], { minimized: true })],
      [1, 4, 2, 1, 1],
      'root'
    )
  )
  tree.$activePresetId.set('custom')
  const placed = new Set(['files', 'review', 'terminal'])
  const hidden = new Set(['review'])
  tree.$userPlacedPanes.set(placed)
  tree.$hiddenTreePanes.set(hidden)

  if (migrated) {
    storage.writeKey(key, '1')
  }

  actions.migrateToolPanelLayout()
  const upgraded = tree.$layoutTree.get()!
  const tools = model.findGroup(upgraded, 'tools')!
  expect(tools.panes).toEqual(['files', 'preview-tile:saved-file', 'review', 'terminal'])
  expect(tools.active).toBe('preview-tile:saved-file')
  expect(tools.toolPanel).toBe(true)
  expect(model.findGroup(upgraded, 'rail')).toEqual(rail)
  expect(model.findGroup(upgraded, 'chat')).toEqual(chat)
  expect(upgraded.type === 'split' && upgraded.weights).toEqual([1, 4, 2])
  expect(tree.$userPlacedPanes.get()).toBe(placed)
  expect(tree.$hiddenTreePanes.get()).toBe(hidden)
  actions.migrateToolPanelLayout()
  expect(tree.$layoutTree.get()).toBe(upgraded)
})

it('preserves a completely hidden tool host while removing obsolete minimized rails', async () => {
  const { tree, model, actions } = await setup()
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files'], { id: 'tools', minimized: true }),
      model.group(['review'], { minimized: true }),
      model.group(['terminal'], { minimized: true })
    ])
  )
  actions.migrateToolPanelLayout()
  expect(model.findGroup(tree.$layoutTree.get()!, 'tools')).toMatchObject({
    panes: ['files', 'review', 'terminal'],
    active: 'files',
    minimized: true,
    toolPanel: true
  })
  expect(
    tree.$layoutTree.get()!.type === 'split' && (tree.$layoutTree.get() as ReturnType<typeof model.split>).children
  ).toHaveLength(2)
})

it('keeps tools embedded with an unknown plugin isolated from the unified host', async () => {
  const { tree, model, actions } = await setup()
  const mixed = model.group(['review', 'plugin-pane'], { id: 'mixed', active: 'plugin-pane' })
  tree.$layoutTree.set(model.split('row', [model.group(['workspace']), model.group(['files'], { id: 'tools' }), mixed]))
  actions.migrateToolPanelLayout()
  expect(model.findGroup(tree.$layoutTree.get()!, 'mixed')).toBe(mixed)
  expect(model.findGroup(tree.$layoutTree.get()!, 'tools')?.panes).toEqual(['files'])
})

it('rejoins the bot schedule with a saved file tool deck without moving the bot conversation', async () => {
  const { tree, model, registry, actions } = await setup()
  registry.register({
    id: 'hermes-bots:routines',
    area: 'panes',
    source: 'plugin:hermes-bots',
    data: { toolPanel: true, placement: 'right' },
    render: () => null
  })
  const chat = model.group(['workspace'], { id: 'bot-chat' })
  tree.$layoutTree.set(
    model.split('row', [
      chat,
      model.group(['hermes-bots:routines'], { id: 'legacy-cron', minimized: true }),
      model.group(['files', 'preview-tile:soul'], { id: 'tools', active: 'preview-tile:soul', toolPanel: true })
    ])
  )
  actions.migrateToolPanelLayout()
  const result = tree.$layoutTree.get()!
  expect(model.findGroupOfPane(result, 'hermes-bots:routines')?.id).toBe('tools')
  expect(model.findGroup(result, 'tools')?.active).toBe('preview-tile:soul')
  expect(model.findGroup(result, 'bot-chat')).toBe(chat)
  expect(model.findGroup(result, 'legacy-cron')).toBeNull()
})

it('gives a restored Review-only host the same tool presentation without resurrecting Files', async () => {
  const { tree, model, actions } = await setup()
  const dismissed = new Set(['files'])
  tree.$dismissedPanes.set(dismissed)
  tree.$layoutTree.set(
    model.split('row', [model.group(['workspace']), model.group(['review'], { id: 'tools', minimized: true })])
  )
  actions.migrateToolPanelLayout()
  expect(model.findGroup(tree.$layoutTree.get()!, 'tools')).toMatchObject({
    panes: ['review'],
    minimized: true,
    toolPanel: true
  })
  expect(tree.$dismissedPanes.get()).toBe(dismissed)
})

it('extracts only core tools from an old Focus chat stack and preserves the conversation surface', async () => {
  const { tree, model, actions } = await setup()
  const rail = model.group(['sessions'], { id: 'rail' })
  tree.$layoutTree.set(
    model.split(
      'row',
      [rail, model.group(['workspace', 'files', 'review'], { id: 'chat', active: 'review' })],
      [1, 4],
      'root'
    )
  )
  tree.$activePresetId.set('focus')
  actions.migrateToolPanelLayout()
  const upgraded = tree.$layoutTree.get()!
  expect(model.findGroup(upgraded, 'chat')).toMatchObject({ panes: ['workspace'], active: 'workspace' })
  expect(model.findGroup(upgraded, 'rail')).toEqual(rail)
  const host = model.findGroupOfPane(upgraded, 'files')!
  expect(host.panes).toEqual(['files', 'review'])
  expect(host.toolPanel).toBe(true)
  expect(host.id).not.toBe('chat')
})

it('finishes consolidation after summon-only stale Logs is removed from a saved terminal group', async () => {
  const { tree, model, actions } = await setup()
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files'], { id: 'tools' }),
      model.group(['terminal', 'logs'], { id: 'stale-terminal' })
    ])
  )
  actions.migrateToolPanelLayout()
  expect(model.findGroup(tree.$layoutTree.get()!, 'stale-terminal')?.panes).toEqual(['terminal', 'logs'])
  tree.removeTreePane('logs')
  actions.migrateToolPanelLayout()
  expect(model.findGroup(tree.$layoutTree.get()!, 'tools')?.panes).toEqual(['files', 'terminal'])
  expect(model.findGroup(tree.$layoutTree.get()!, 'stale-terminal')).toBeNull()
})

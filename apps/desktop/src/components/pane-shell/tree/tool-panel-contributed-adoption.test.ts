import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

async function setup() {
  const tree = await import('./store')
  const model = await import('./model')
  const { registry } = await import('@/contrib/registry')
  registry.registerMany([
    { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null },
    ...['files', 'review'].map(id => ({
      id,
      area: 'panes',
      data: { placement: 'right', toolPanel: true },
      render: () => null
    }))
  ])

  const registerSchedule = () =>
    registry.register({
      id: 'hermes-bots:routines',
      area: 'panes',
      source: 'plugin:hermes-bots',
      data: { placement: 'right', toolPanel: true, dock: { pane: 'files', pos: 'center', enforce: true } },
      render: () => null
    })

  return { tree, model, registerSchedule }
}

it('silently adopts a bot schedule beside the active file in the existing tool tabs', async () => {
  const { tree, model, registerSchedule } = await setup()
  const chat = model.group(['workspace'], { id: 'bot-chat' })
  tree.$layoutTree.set(
    model.split('row', [
      chat,
      model.group(['files', 'review', 'preview-tile:soul'], {
        id: 'tools',
        active: 'preview-tile:soul',
        toolPanel: true
      })
    ])
  )
  tree.watchContributedPanes()
  registerSchedule()
  const result = tree.$layoutTree.get()!
  expect(model.findGroupOfPane(result, 'hermes-bots:routines')?.id).toBe('tools')
  expect(model.findGroup(result, 'tools')?.active).toBe('preview-tile:soul')
  expect(model.findGroup(result, 'tools')?.minimized).toBeFalsy()
  expect(model.findGroup(result, 'bot-chat')).toBe(chat)
})

it('re-homes a restored narrow schedule column when the contribution registers after boot', async () => {
  const { tree, model, registerSchedule } = await setup()
  const chat = model.group(['workspace'], { id: 'bot-chat' })
  tree.$layoutTree.set(
    model.split('row', [
      chat,
      model.group(['hermes-bots:routines'], { id: 'legacy-cron', minimized: true }),
      model.group(['files', 'review', 'preview-tile:soul'], {
        id: 'tools',
        active: 'preview-tile:soul',
        toolPanel: true
      })
    ])
  )
  tree.watchContributedPanes()
  registerSchedule()
  const result = tree.$layoutTree.get()!
  expect(model.findGroupOfPane(result, 'hermes-bots:routines')?.id).toBe('tools')
  expect(model.findGroup(result, 'tools')?.active).toBe('preview-tile:soul')
  expect(model.findGroup(result, 'legacy-cron')).toBeNull()
  expect(model.findGroup(result, 'bot-chat')).toBe(chat)
})

it('reuses the restored tool host when its Files anchor was closed', async () => {
  const { tree, model, registerSchedule } = await setup()
  const dismissed = new Set(['files'])
  const chat = model.group(['workspace'], { id: 'bot-chat' })
  tree.$dismissedPanes.set(dismissed)
  tree.$layoutTree.set(
    model.split('row', [
      chat,
      model.group(['hermes-bots:routines'], { id: 'legacy-cron', minimized: true }),
      model.group(['review', 'preview-tile:soul'], { id: 'tools', active: 'preview-tile:soul', toolPanel: true })
    ])
  )
  tree.watchContributedPanes()
  registerSchedule()
  const result = tree.$layoutTree.get()!
  expect(model.findGroupOfPane(result, 'hermes-bots:routines')?.id).toBe('tools')
  expect(model.findGroup(result, 'tools')?.active).toBe('preview-tile:soul')
  expect(model.findGroup(result, 'legacy-cron')).toBeNull()
  expect(model.findGroup(result, 'bot-chat')).toBe(chat)
  expect(tree.$dismissedPanes.get()).toBe(dismissed)
  expect(model.allPaneIds(result)).not.toContain('files')
})

it('adopts a new schedule into a preview-only host when standing tools were closed', async () => {
  const { tree, model, registerSchedule } = await setup()
  tree.$dismissedPanes.set(new Set(['files', 'review']))
  const chat = model.group(['workspace'], { id: 'bot-chat' })
  tree.$layoutTree.set(
    model.split('row', [
      chat,
      model.group(['preview-tile:soul'], { id: 'tools', active: 'preview-tile:soul', toolPanel: true })
    ])
  )
  tree.watchContributedPanes()
  registerSchedule()
  const result = tree.$layoutTree.get()!
  expect(model.findGroupOfPane(result, 'hermes-bots:routines')?.id).toBe('tools')
  expect(model.findGroup(result, 'tools')?.active).toBe('preview-tile:soul')
  expect(model.findGroup(result, 'bot-chat')).toBe(chat)
  expect(model.allPaneIds(result)).not.toContain('files')
  expect(model.allPaneIds(result)).not.toContain('review')
})

it('opens a separate tool host after every tool tab was closed instead of stacking over the chat', async () => {
  const { tree, model, registerSchedule } = await setup()
  tree.$dismissedPanes.set(new Set(['files', 'review']))
  const chat = model.group(['workspace'], { id: 'bot-chat' })
  tree.$layoutTree.set(chat)
  tree.watchContributedPanes()
  registerSchedule()
  const result = tree.$layoutTree.get()!
  expect(model.findGroup(result, 'bot-chat')).toBe(chat)
  const schedule = model.findGroupOfPane(result, 'hermes-bots:routines')!
  expect(schedule.id).not.toBe('bot-chat')
  expect(schedule.panes).toEqual(['hermes-bots:routines'])
  expect(schedule.minimized).toBe(true)
})

import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  session: {
    runtimeId: 'runtime-a',
    storedId: 'stored-a',
    owner: { connectionId: 'local', profile: 'alpha' },
    sourceKey: 'local-alpha'
  }
}))

vi.mock('@/store/tool-session', () => ({ $toolSession: { get: () => state.session } }))

beforeEach(() => {
  window.localStorage.clear()
  state.session = {
    runtimeId: 'runtime-a',
    storedId: 'stored-a',
    owner: { connectionId: 'local', profile: 'alpha' },
    sourceKey: 'local-alpha'
  }
  vi.resetModules()
})

async function setup() {
  const tree = await import('@/components/pane-shell/tree/store')
  const model = await import('@/components/pane-shell/tree/model')
  const { registry } = await import('@/contrib/registry')
  const panel = await import('./subagent-panel')
  const main = model.group(['workspace'], { id: 'chat' })
  tree.$layoutTree.set(model.split('row', [main, model.group(['files', 'review'], { id: 'tools', toolPanel: true })]))
  registry.registerMany([
    { id: 'workspace', area: 'panes', data: { placement: 'main', uncloseable: true }, render: () => null },
    ...['files', 'review', panel.SUBAGENT_PANEL_ID].map(id => ({
      id,
      area: 'panes',
      data: { placement: 'right', toolPanel: true, dock: { pane: 'files', pos: 'center' } },
      render: () => null
    }))
  ])
  tree.watchContributedPanes()

  return { tree, model, panel, main }
}

it('opens one tool tab only on explicit intent, preserving the main conversation and existing file tabs', async () => {
  const { tree, model, panel, main } = await setup()
  expect(model.allPaneIds(tree.$layoutTree.get()!)).not.toContain(panel.SUBAGENT_PANEL_ID)
  expect(panel.openSubagentPanel({ parentRuntimeId: 'runtime-a' })).toBe(true)
  expect(panel.openSubagentPanel({ parentRuntimeId: 'runtime-a', taskId: 'child-b' })).toBe(true)
  let result = tree.$layoutTree.get()!
  expect(model.findGroupOfPane(result, panel.SUBAGENT_PANEL_ID)?.id).toBe('tools')
  expect(model.findGroup(result, 'tools')?.panes).toEqual(['files', 'review', panel.SUBAGENT_PANEL_ID])
  expect(model.findGroup(result, 'tools')?.active).toBe(panel.SUBAGENT_PANEL_ID)
  expect(model.findGroup(result, 'chat')).toBe(main)
  tree.dismissTreePane(panel.SUBAGENT_PANEL_ID)
  expect(panel.openSubagentPanel({ parentRuntimeId: 'runtime-a' })).toBe(true)
  result = tree.$layoutTree.get()!
  expect(model.allPaneIds(result).filter(id => id === panel.SUBAGENT_PANEL_ID)).toHaveLength(1)
  expect(model.findGroup(result, 'chat')).toBe(main)
})

it('rejects a stale conversation or owner even when another profile has the same durable id', async () => {
  const { panel } = await setup()
  expect(panel.openSubagentPanel({ parentRuntimeId: 'runtime-old' })).toBe(false)
  expect(
    panel.openSubagentPanel({
      parentRuntimeId: null,
      storedSessionId: 'stored-a',
      owner: { connectionId: 'other', profile: 'alpha' }
    })
  ).toBe(false)
  expect(panel.$subagentPanelSelection.get()).toBeNull()
})

it('opens a capsule child against its captured source without replacing the foreground conversation', async () => {
  const { tree, model, panel, main } = await setup()

  const inspection = {
    runtimeId: 'member-runtime',
    storedId: 'member-history',
    owner: { connectionId: 'room-gateway', profile: 'member' }
  }

  const row = { id: 'child', subagentId: 'child', goal: 'Review sources', activity: [], status: 'failed' as const }

  expect(
    panel.openSubagentPanel({
      parentRuntimeId: null,
      anchorSourceKey: panel.subagentPanelSourceKey(state.session),
      inspection,
      taskId: 'child',
      row
    })
  ).toBe(true)
  expect(panel.$subagentPanelSelection.get()).toMatchObject({ inspection, taskId: 'child', row })
  expect(model.findGroup(tree.$layoutTree.get()!, 'chat')).toBe(main)
  expect(state.session.runtimeId).toBe('runtime-a')
  expect(
    panel.openSubagentPanel({
      parentRuntimeId: null,
      anchorSourceKey: 'previous-account',
      inspection,
      taskId: 'child',
      row
    })
  ).toBe(false)
})

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('./right-rail/preview', () => ({ PreviewTilePane: () => null }))
vi.mock('./right-rail/preview-console-store', () => ({ forgetPreviewConsole: () => undefined }))

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

afterEach(() => vi.unstubAllGlobals())

async function setup() {
  const tree = await import('@/components/pane-shell/tree/store')
  const model = await import('@/components/pane-shell/tree/model')
  const { registry } = await import('@/contrib/registry')
  const preview = await import('@/store/preview')
  const session = await import('@/store/session')

  let dockBack: (tabId: string) => void = () => {
    throw new Error('Pop-out listener was not registered')
  }
  vi.stubGlobal('hermesDesktop', {
    onBrowserPopoutClosed: callback => {
      dockBack = callback

      return () => undefined
    }
  } satisfies Pick<NonNullable<Window['hermesDesktop']>, 'onBrowserPopoutClosed'>)

  for (const id of ['files', 'terminal']) {
    registry.register({ id, area: 'panes', data: { toolPanel: true, placement: 'right' }, render: () => null })
  }

  registry.register({
    id: 'workspace',
    area: 'panes',
    data: { placement: 'main', uncloseable: true },
    render: () => null
  })
  tree.declareDefaultTree(
    model.split('row', [
      model.group(['workspace'], { id: 'main' }),
      model.group(['files', 'terminal'], { id: 'tools', toolPanel: true })
    ])
  )
  tree.hydrateContributedPanes()
  const { watchPreviewTiles } = await import('./preview-tile')
  watchPreviewTiles()
  session.$selectedStoredSessionId.set('session-a')
  preview.openPreview({ kind: 'url', label: 'Live page', source: 'https://live.example', url: 'https://live.example' })
  const tabId = preview.$previewTabs.get()[0]!.id
  preview.markBrowserTabPopped(tabId, true)
  tree.restoreTreePane('files')

  return { tree, model, preview, session, tabId, dockBack: () => dockBack(tabId) }
}

it('fronts the returned Browser when its owning session is still on screen', async () => {
  const { tree, model, tabId, dockBack } = await setup()
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'files')?.active).toBe('files')

  dockBack()

  expect(model.findGroupOfPane(tree.$layoutTree.get()!, `preview-tile:${tabId}`)?.active).toBe(`preview-tile:${tabId}`)
})

it('returns a pinned Browser quietly when another session is on screen', async () => {
  const { tree, model, preview, session, tabId, dockBack } = await setup()
  preview.setPreviewTabPinned(tabId, true)
  session.$selectedStoredSessionId.set('session-b')
  tree.restoreTreePane('terminal')

  dockBack()

  expect(session.$selectedStoredSessionId.get()).toBe('session-b')
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'terminal')?.active).toBe('terminal')
})

it('does not re-home the current profile to a background Browser owner', async () => {
  const { tree, model, preview, session, tabId, dockBack } = await setup()
  preview.setPreviewScope('other-profile')
  session.$selectedStoredSessionId.set('session-b')
  preview.openPreview({ kind: 'file', label: 'Current file', source: '/work/file.txt', url: '/work/file.txt' })
  const currentTabs = preview.$previewTabs.get()
  tree.restoreTreePane('terminal')
  const stored = JSON.parse(window.localStorage.getItem('hermes.desktop.previewTabs.v2')!)
  stored.default[0].target.url = 'https://live.example/next'
  window.localStorage.setItem('hermes.desktop.previewTabs.v2', JSON.stringify(stored))

  dockBack()

  expect(preview.$previewTabs.get()).toEqual(currentTabs)
  expect(preview.$poppedBrowserTabIds.get().has(tabId)).toBe(false)
  expect(model.findGroupOfPane(tree.$layoutTree.get()!, 'terminal')?.active).toBe('terminal')
  preview.setPreviewScope('default')
  expect(preview.$previewTabs.get().find(tab => tab.id === tabId)?.target.url).toBe('https://live.example/next')
})

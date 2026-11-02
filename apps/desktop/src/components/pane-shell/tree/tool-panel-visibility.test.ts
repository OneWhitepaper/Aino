import { atom } from 'nanostores'
import { beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
  window.localStorage.clear()
  vi.resetModules()
})

it('retains the saved tool tab while workspace availability arrives for another open tool first', async () => {
  const tree = await import('./store')
  const model = await import('./model')
  const { registry } = await import('@/contrib/registry')
  registry.registerMany(
    ['files', 'review'].map(id => ({
      id,
      area: 'panes',
      data: { toolPanel: true, placement: 'right' },
      render: () => null
    }))
  )
  tree.$layoutTree.set(
    model.split('row', [
      model.group(['workspace']),
      model.group(['files', 'review'], { id: 'tools', active: 'files', toolPanel: true })
    ])
  )
  const files = atom(false)
  const review = atom(false)
  tree.bindPaneVisibility('files', files)
  tree.bindPaneVisibility('review', review)
  review.set(true)
  expect(model.findGroup(tree.$layoutTree.get()!, 'tools')?.active).toBe('files')
  files.set(true)
  expect(model.findGroup(tree.$layoutTree.get()!, 'tools')?.active).toBe('files')
  tree.revealTreePane('review')
  expect(model.findGroup(tree.$layoutTree.get()!, 'tools')?.active).toBe('review')
})

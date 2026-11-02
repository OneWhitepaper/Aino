import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const file = (name: string) =>
  ({ kind: 'file', label: name, path: '/work/' + name, source: '/work/' + name, url: 'file:///work/' + name }) as const

describe('temporary file previews', () => {
  it('replaces an unmodified temporary file and keeps a file without pinning it across sessions', async () => {
    const preview = await import('./preview')
    preview.openTemporaryPreview(file('a.ts'))
    preview.openTemporaryPreview(file('b.ts'))
    expect(preview.$previewTabs.get().map(tab => tab.target.label)).toEqual(['b.ts'])
    const id = preview.$previewTabs.get()[0]!.id
    preview.keepPreviewTab(id)
    preview.openTemporaryPreview(file('c.ts'))
    expect(preview.$previewTabs.get().map(tab => tab.target.label)).toEqual(['b.ts', 'c.ts'])
    expect(preview.$previewTabs.get()[0]).toMatchObject({ temporary: false, pinned: false })
  })

  it('retains a dirty temporary draft when another file opens and when close is cancelled', async () => {
    const preview = await import('./preview')
    const edits = await import('./preview-edit')
    preview.openTemporaryPreview(file('a.ts'))
    const id = preview.$previewTabs.get()[0]!.id
    edits.setPreviewDirty(file('a.ts').url, true)
    preview.openTemporaryPreview(file('b.ts'))
    expect(preview.$previewTabs.get()).toHaveLength(2)
    preview.closeRightRailTab(id)
    expect(preview.$previewTabs.get()).toHaveLength(2)
    expect(edits.$pendingPreviewClose.get()).toBe(id)
    edits.cancelPreviewClose()
    expect(preview.$previewTabs.get()).toHaveLength(2)
  })
})

it('keeps separate dirty writers for the same file in two sessions', async () => {
  const edits = await import('./preview-edit')
  edits.setPreviewDirty('file:///work/a.ts', true, 'owner-a')
  edits.setPreviewDirty('file:///work/a.ts', false, 'owner-b')
  expect(edits.previewTabIsDirty('owner-a', 'file:///work/a.ts')).toBe(true)
  expect(edits.previewTabIsDirty('owner-b', 'file:///work/a.ts')).toBe(false)
})

it('saves through the owning editor before closing and retains the tab on save conflict', async () => {
  const preview = await import('./preview')
  const edits = await import('./preview-edit')
  preview.openPreview(file('save.ts'))
  const id = preview.$previewTabs.get()[0]!.id
  edits.setPreviewDirty(file('save.ts').url, true, id)
  const disposeConflict = edits.registerPreviewSaver(id, async () => false)
  await expect(preview.saveAndClosePreviewTab(id)).resolves.toBe(false)
  expect(preview.$previewTabs.get()).toHaveLength(1)
  disposeConflict()
  edits.registerPreviewSaver(id, async () => {
    edits.setPreviewDirty(file('save.ts').url, false, id)

    return true
  })
  await expect(preview.saveAndClosePreviewTab(id)).resolves.toBe(true)
  expect(preview.$previewTabs.get()).toHaveLength(0)
})

it('marks only the explicit background owner temporary, leaving foreground selection and keep state intact', async () => {
  const preview = await import('./preview')
  const session = await import('./session')
  const layout = await import('./layout')
  session.$selectedStoredSessionId.set('foreground')
  preview.openPreview(file('foreground.ts'), 'foreground')
  const foregroundId = layout.$rightRailActiveTabId.get()
  preview.openTemporaryPreview(file('background.ts'), 'background', null)
  expect(layout.$rightRailActiveTabId.get()).toBe(foregroundId)
  expect(preview.$previewTabs.get().find(tab => tab.sessionId === 'foreground')?.temporary).toBeFalsy()
  expect(preview.$previewTabs.get().find(tab => tab.sessionId === 'background')?.temporary).toBe(true)
})

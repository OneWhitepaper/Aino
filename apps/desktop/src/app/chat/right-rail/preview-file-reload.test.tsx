import { EditorView } from '@codemirror/view'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import { previewTabIsDirty, savePreviewTab } from '@/store/preview-edit'
import { $connection } from '@/store/session'

import { LocalFilePreview } from './preview-file'

vi.mock('@/components/chat/shiki-highlighter', () => ({
  LazyShiki: ({ code }: { code: string }) => <pre>{code}</pre>
}))

const target = {
  kind: 'file',
  label: 'note.txt',
  path: '/work/note.txt',
  previewKind: 'text',
  source: '/work/note.txt',
  url: 'file:///work/note.txt'
} as const

const tabId = 'reload-draft'
const rangeDescriptors = Object.getOwnPropertyDescriptors(Range.prototype)
let diskText = ''
const read = vi.fn(async () => ({ path: target.path, text: diskText, binary: false, truncated: false }))

const write = vi.fn(async (_path: string, content: string) => {
  diskText = content

  return { path: target.path }
})

beforeEach(() => {
  diskText = 'Original document'
  read.mockClear()
  write.mockClear()
  $connection.set(null)
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  vi.stubGlobal('hermesDesktop', { readFileText: read, writeTextFile: write })
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() }
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()

  for (const key of ['getClientRects', 'getBoundingClientRect']) {
    if (rangeDescriptors[key]) {
      Object.defineProperty(Range.prototype, key, rangeDescriptors[key])
    } else {
      Reflect.deleteProperty(Range.prototype, key)
    }
  }
})

it('keeps the same dirty editor and owning saver through a watcher reload without replacing its disk baseline', async () => {
  const view = render(<LocalFilePreview reloadKey={0} tabId={tabId} target={target} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const content = view.container.querySelector<HTMLElement>('.cm-content')!
  const editor = EditorView.findFromDOM(content)!
  act(() => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'Unsaved draft' } }))
  expect(previewTabIsDirty(tabId, target.url)).toBe(true)
  diskText = 'External disk change'
  view.rerender(<LocalFilePreview reloadKey={1} tabId={tabId} target={target} />)
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  expect(view.container.querySelector('.cm-content')).toBe(content)
  expect(content.isConnected).toBe(true)
  expect(editor.state.doc.toString()).toBe('Unsaved draft')
  expect(previewTabIsDirty(tabId, target.url)).toBe(true)
  let saved = true
  await act(async () => {
    saved = await savePreviewTab(tabId)
  })
  expect(saved).toBe(false)
  expect(await screen.findByRole('button', { name: 'Overwrite' })).toBeTruthy()
  expect(write).not.toHaveBeenCalled()
  expect(diskText).toBe('External disk change')
  expect(editor.state.doc.toString()).toBe('Unsaved draft')
})

it('still refreshes a clean read view when the watcher reloads the same file', async () => {
  const view = render(<LocalFilePreview reloadKey={0} tabId={tabId} target={target} />)
  expect(await screen.findByText('Original document')).toBeTruthy()
  diskText = 'External disk change'
  view.rerender(<LocalFilePreview reloadKey={1} tabId={tabId} target={target} />)
  expect(await screen.findByText('External disk change')).toBeTruthy()
  expect(previewTabIsDirty(tabId, target.url)).toBe(false)
})

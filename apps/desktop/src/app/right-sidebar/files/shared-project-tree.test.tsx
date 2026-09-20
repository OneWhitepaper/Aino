import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import * as api from '@/api/client'
import { $renamingPath } from '@/store/file-actions'
import { sharedProjectWindow } from '@/store/shared-project-windows'

import { SharedProjectTree } from './shared-project-tree'

const source = {
  install_id: 'host',
  execution_environment_id: 'local',
  registration_profile: 'writer',
  project_id: 'source',
  cwd: '/book'
}

const project = {
  id: 'shared',
  install_id: 'host',
  environment_id: 'local',
  canonical_path: '/book',
  name: 'Book',
  sources: [source]
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', undefined)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    height: 256,
    width: 320,
    top: 0,
    left: 0,
    right: 320,
    bottom: 256,
    x: 0,
    y: 0,
    toJSON: () => ({})
  })
})

afterEach(() => {
  cleanup()
  sharedProjectWindow.opened.set([])
  $renamingPath.set(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('reads no registered roots until explicitly opened, then previews the file on its captured source', async () => {
  const request = vi.spyOn(api, 'hermesApi').mockImplementation(async request => {
    if (request.path === '/api/fs/list?path=%2Fbook') {
      return { entries: [{ path: '/book/chapters', name: 'chapters', isDirectory: true }] } as never
    }

    if (request.path === '/api/fs/list?path=%2Fbook%2Fchapters') {
      return { entries: [{ path: '/book/chapter.txt', name: 'chapter.txt', isDirectory: false }] } as never
    }

    if (request.path.startsWith('/api/fs/read-text?')) {
      return { text: 'Captured project text', byteSize: 21 } as never
    }
    throw new Error('Unexpected filesystem call')
  })

  render(<SharedProjectTree owner={{ connectionId: 'captured', installId: 'host', conversationId: 'chat' }} />)
  expect(request).not.toHaveBeenCalled()
  sharedProjectWindow.open({ connectionId: 'captured', project, source })
  expect(request.mock.calls.filter(([r]) => r.path.includes('chapters'))).toHaveLength(0)
  fireEvent.click(await screen.findByText('chapters'))
  const file = await screen.findByText('chapter.txt')
  expect(file.closest('[data-project-tree]')).toBeTruthy()
  expect(file.closest('[draggable="true"]')).toBeNull()
  fireEvent.click(file)
  fireEvent.keyDown(file, { key: 'F2' })
  expect($renamingPath.get()).toBeNull()
  fireEvent.doubleClick(file)
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith({
      connectionId: 'captured',
      profile: 'writer',
      path: '/api/fs/read-text?path=%2Fbook%2Fchapter.txt'
    })
  )
  expect(
    request.mock.calls.every(([request]) => request.connectionId === 'captured' && request.profile === 'writer')
  ).toBe(true)
  const previewText = await screen.findByText('Captured project text')
  expect(previewText).toBeTruthy()
  expect(previewText.closest('section')?.querySelector('[draggable="true"]')).toBeNull()
})

it('unmounts the old source preview when the same shared folder is opened through another source', async () => {
  const request = vi.spyOn(api, 'hermesApi').mockImplementation(async request => {
    if (request.path.startsWith('/api/fs/list?')) {
      return { entries: [{ path: '/book/chapter.txt', name: 'chapter.txt', isDirectory: false }] } as never
    }

    if (request.path.startsWith('/api/fs/read-text?')) {
      return { text: `${request.profile} preview`, byteSize: 20 } as never
    }

    throw new Error('Unexpected filesystem call')
  })

  sharedProjectWindow.open({ connectionId: 'captured', project, source })
  render(<SharedProjectTree owner={{ connectionId: 'captured', installId: 'host', conversationId: 'chat' }} />)
  fireEvent.doubleClick(await screen.findByText('chapter.txt'))
  expect(await screen.findByText('writer preview')).toBeTruthy()
  sharedProjectWindow.open({
    connectionId: 'captured',
    project,
    source: { ...source, registration_profile: 'reviewer', project_id: 'other-source' }
  })
  await waitFor(() => expect(screen.queryByText('writer preview')).toBeNull())
  fireEvent.doubleClick(await screen.findByText('chapter.txt'))
  expect(await screen.findByText('reviewer preview')).toBeTruthy()
  expect(request.mock.calls.at(-1)?.[0].profile).toBe('reviewer')
})

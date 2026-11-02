import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { setApiRequestConnection, setApiRequestProfile } from '@/api/client'
import type { HermesConnection } from '@/global'
import { $connection } from '@/store/session'

import { FilePreviewActions } from './preview-file-actions'

const target = {
  kind: 'file' as const,
  label: 'README.md',
  path: '/workspace/README.md',
  previewKind: 'text' as const,
  source: '/workspace/README.md',
  url: 'file:///workspace/README.md'
}

afterEach(() => {
  cleanup()
  $connection.set(null)
  setApiRequestConnection(null)
  setApiRequestProfile(null)
  vi.unstubAllGlobals()
})

it('reuses native open, clipboard and editing actions from the visible file toolbar', async () => {
  const openPreviewInBrowser = vi.fn(async () => undefined)
  const writeClipboard = vi.fn(async () => undefined)
  const onEdit = vi.fn()
  vi.stubGlobal('hermesDesktop', { openPreviewInBrowser, writeClipboard })
  $connection.set({ mode: 'local', connectionId: 'local', profile: 'default' } as HermesConnection)
  render(<FilePreviewActions filePath={target.path} onEdit={onEdit} target={target} />)

  fireEvent.click(screen.getByRole('button', { name: 'Open in external' }))
  await waitFor(() => expect(openPreviewInBrowser).toHaveBeenCalledWith(target.url))
  fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
  await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith(target.path))
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect(onEdit).toHaveBeenCalledOnce()
})

it('removes the local-open action for remote files and downloads from the owning connection/profile', async () => {
  const openPreviewInBrowser = vi.fn(async () => undefined)
  const saveGatewayFile = vi.fn(async () => ({ saved: false, canceled: true }))
  vi.stubGlobal('hermesDesktop', { openPreviewInBrowser, saveGatewayFile })
  $connection.set({ mode: 'local', connectionId: 'local', profile: 'default' } as HermesConnection)
  render(<FilePreviewActions filePath={target.path} target={target} />)

  act(() => {
    $connection.set({ mode: 'remote', connectionId: 'ssh-team', profile: 'research' } as HermesConnection)
    setApiRequestConnection('ssh-team')
    setApiRequestProfile('research')
  })
  expect(screen.queryByRole('button', { name: 'Open in external' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() =>
    expect(saveGatewayFile).toHaveBeenCalledWith({
      connectionId: 'ssh-team',
      path: target.path,
      profile: 'research',
      suggestedName: target.label
    })
  )
  expect(openPreviewInBrowser).not.toHaveBeenCalled()
})

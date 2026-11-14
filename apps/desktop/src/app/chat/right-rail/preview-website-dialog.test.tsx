import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { group } from '@/components/pane-shell/tree/model'
import { $layoutTree } from '@/components/pane-shell/tree/store'
import { $confirmRequest } from '@/store/confirm'
import { $rightRailActiveTabId } from '@/store/layout'
import { closeRightRail, newBrowserTab } from '@/store/preview'

import type { PreviewBrowserDialog } from '../../../../shared/preview-browser-interactions'

import { $previewWebsiteDialogs, $previewWebsiteFileChoosers } from './preview-native-actions'
import { PreviewWebsiteDialog } from './preview-website-dialog'

let tabId: string
beforeEach(() => {
  newBrowserTab()
  tabId = $rightRailActiveTabId.get()!
  $layoutTree.set(group([`preview-tile:${tabId}`]))
})

afterEach(() => {
  cleanup()
  $previewWebsiteDialogs.set({})
  $previewWebsiteFileChoosers.set({})
  $confirmRequest.set(null)
  $layoutTree.set(null)
  closeRightRail()
})

function pendingDialog(id: string, type: string, sensitive = false): PreviewBrowserDialog {
  return { id, type, sensitive, message: `${id} response`, url: 'https://example.test', state: 'pending' }
}

describe('website dialog keyboard and input lifecycle', () => {
  it('clears sensitive text for the next prompt and requires an explicit acceptance', async () => {
    const respond = vi.fn().mockResolvedValue(undefined)
    $previewWebsiteDialogs.set({ [tabId]: { dialog: pendingDialog('secret', 'prompt', true), defaultText: 'private-default', respond } })
    render(<PreviewWebsiteDialog tabId={tabId} />)
    const secret = screen.getByLabelText('secret response', { selector: 'input' }) as HTMLInputElement
    expect(secret.type).toBe('password')
    expect(secret.value).toBe('private-default')
    fireEvent.change(secret, { target: { value: 'private-code' } })
    fireEvent.keyDown(secret, { key: 'Enter' })
    expect(respond).not.toHaveBeenCalled()

    act(() => $previewWebsiteDialogs.set({ [tabId]: { dialog: pendingDialog('public', 'prompt'), respond } }))
    const publicInput = screen.getByRole('textbox', { name: 'public response' }) as HTMLInputElement
    expect(publicInput.value).toBe('')
    await waitFor(() => expect(globalThis.document.activeElement).toBe(publicInput))
    fireEvent.change(publicInput, { target: { value: 'ordinary reply' } })
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    await waitFor(() => expect(respond).toHaveBeenCalledExactlyOnceWith(true, 'ordinary reply'))
  })

  it('focuses Cancel for a confirmation, dismisses on Escape, and restores the original focus', async () => {
    const respond = vi.fn(async () => {
      $previewWebsiteDialogs.set({})
    })

    render(
      <>
        <button>Browser address</button>
        <PreviewWebsiteDialog tabId={tabId} />
      </>
    )
    const original = screen.getByRole('button', { name: 'Browser address' })
    original.focus()
    act(() => $previewWebsiteDialogs.set({ [tabId]: { dialog: pendingDialog('delete', 'confirm', true), respond } }))
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(globalThis.document.activeElement).toBe(cancel))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(respond).toHaveBeenCalledExactlyOnceWith(false, undefined))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(globalThis.document.activeElement).toBe(original))
  })

  it('keeps a hidden page prompt pending until that browser is visible', async () => {
    const respond = vi.fn().mockResolvedValue(undefined)
    $layoutTree.set(group(['files', `preview-tile:${tabId}`], { active: 'files' }))
    $previewWebsiteDialogs.set({ [tabId]: { dialog: pendingDialog('background', 'confirm'), respond } })
    render(
      <>
        <button>Current work</button>
        <PreviewWebsiteDialog tabId={tabId} />
      </>
    )
    const current = screen.getByRole('button', { name: 'Current work' })
    current.focus()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(globalThis.document.activeElement).toBe(current)
    expect($previewWebsiteDialogs.get()[tabId]).toBeTruthy()
    act(() => $layoutTree.set(group(['files', `preview-tile:${tabId}`], { active: `preview-tile:${tabId}` })))
    await screen.findByRole('dialog', { name: 'background response' })
    expect(respond).not.toHaveBeenCalled()
  })

  it('opens the native chooser only after Choose files and dismisses it through Cancel or Escape', async () => {
    const choose = vi.fn().mockResolvedValue(undefined)

    const cancel = vi.fn(async () => {
      $previewWebsiteFileChoosers.set({})
    })

    $previewWebsiteFileChoosers.set({
      [tabId]: {
        chooser: { id: 'file-picker', url: 'https://upload.test', multiple: true, state: 'pending' },
        choose,
        cancel
      }
    })
    render(<PreviewWebsiteDialog tabId={tabId} />)
    const dismiss = screen.getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(globalThis.document.activeElement).toBe(dismiss))
    expect(choose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Choose files' }))
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(dismiss.hasAttribute('disabled')).toBe(false))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

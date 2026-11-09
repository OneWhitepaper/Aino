import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'
import { $gateway } from '@/store/gateway'
import { $sendDiagnostics, dismissSendDiagnostics, requestSendDiagnostics } from '@/store/send-diagnostics'

import { SendDiagnosticsHost } from './send-diagnostics-dialog'

const originalDesktop = window.hermesDesktop
const originalGateway = $gateway.get()

function rig() {
  const request = vi.fn().mockResolvedValue({ ok: true, bundle_base64: 'redacted-gzip' })
  const scope = vi.fn().mockResolvedValue({ user_id: '17', generation: 4 })
  const upload = vi.fn().mockResolvedValue({ id: 'diagnostic-id' })
  const writeClipboard = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformDiagnostics: { scope, upload },
      writeClipboard
    }
  })
  $gateway.set({ request } as never)

  return { request, scope, upload, writeClipboard }
}

beforeEach(() => setRuntimeI18nLocale('en'))
afterEach(() => {
  cleanup()
  dismissSendDiagnostics()
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
  $gateway.set(originalGateway)
})

describe('SendDiagnosticsHost recovery', () => {
  it('returns a failed upload to explicit consent before retrying', async () => {
    const f = rig()
    const error = `Unable to collect /project/${'long-folder/'.repeat(30)}report.log`
    f.request.mockResolvedValueOnce({ ok: false, error })
    requestSendDiagnostics('original failure')
    render(<SendDiagnosticsHost />)
    expect(f.scope).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect((await screen.findByRole('alert')).textContent).toBe(error)
    expect($sendDiagnostics.get()?.phase).toBe('error')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect($sendDiagnostics.get()).toEqual({ phase: 'consent', errorContext: 'original failure' })
    expect(f.request).toHaveBeenCalledTimes(1)
    expect(f.upload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await screen.findByText('Diagnostics sent')
    expect(f.request).toHaveBeenCalledTimes(2)
    expect(f.upload).toHaveBeenCalledTimes(1)
  })

  it('allows closing an upload without claiming it was cancelled or restoring its late result', async () => {
    const f = rig()
    let resolve!: (value: { id: string }) => void
    f.upload.mockImplementation(
      () =>
        new Promise(yes => {
          resolve = yes
        })
    )
    requestSendDiagnostics()
    render(<SendDiagnosticsHost />)
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(f.upload).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('status').textContent).toContain('will not cancel')
    expect(screen.getByRole('button', { name: 'Uploading…' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0])
    expect($sendDiagnostics.get()).toBeNull()
    await act(async () => resolve({ id: 'late-result' }))
    expect($sendDiagnostics.get()).toBeNull()
    expect(screen.queryByText('Diagnostics sent')).toBeNull()
  })

  it('preserves a long diagnostic ID for display and exact copying', async () => {
    const f = rig()
    const uploadId = `diagnostics-${'a'.repeat(200)}`
    $sendDiagnostics.set({ phase: 'done', result: { uploadId } })
    render(<SendDiagnosticsHost />)
    expect(screen.getByText(`Diagnostic ID: ${uploadId}`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostic ID' }))
    await waitFor(() => expect(f.writeClipboard).toHaveBeenCalledWith(uploadId))
  })
})

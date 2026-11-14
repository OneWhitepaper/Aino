import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'
import { $gateway } from '@/store/gateway'
import { dismissSendDiagnostics, requestSendDiagnostics } from '@/store/send-diagnostics'

import { RootErrorBoundary } from './error-boundary'
import { SendDiagnosticsHost } from './send-diagnostics-dialog'

const originalDesktop = window.hermesDesktop
const originalGateway = $gateway.get()

function fixture() {
  const box: { error: Error | null } = { error: null }
  const request = vi.fn().mockResolvedValue({ ok: true, bundle_base64: 'redacted-gzip' })
  const scope = vi.fn().mockResolvedValue({ user_id: '17', generation: 4 })
  const upload = vi.fn().mockResolvedValue({ id: 'diagnostic-id' })
  const revealLogs = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { platformDiagnostics: { scope, upload }, revealLogs }
  })
  $gateway.set({ request } as never)

  function Bomb({ error }: { error: Error | null }) {
    if (error) {
      throw error
    }

    return <div>recovered app</div>
  }

  function tree() {
    return (
      <RootErrorBoundary>
        <SendDiagnosticsHost />
        <Bomb error={box.error} />
      </RootErrorBoundary>
    )
  }

  const view = render(tree())

  const crash = (error = new Error('renderer failed')) => {
    box.error = error
    view.rerender(tree())
  }

  const repair = () => {
    box.error = null
    view.rerender(tree())
  }

  return { crash, repair, request, revealLogs, scope, upload }
}

beforeEach(() => {
  setRuntimeI18nLocale('en')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  dismissSendDiagnostics()
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
  $gateway.set(originalGateway)
  vi.restoreAllMocks()
})

describe('root crash recovery', () => {
  it('keeps full details, native logs and consent available after the app host unmounts', async () => {
    const f = fixture()
    const error = new Error(`Renderer failed at /project/${'long-folder/'.repeat(100)}report.md`)
    f.crash(error)
    fireEvent.click(screen.getByText('Details'))
    expect(screen.getByText(error.message).textContent).toBe(error.message)
    fireEvent.click(screen.getByRole('button', { name: 'Open logs' }))
    expect(f.revealLogs).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Send diagnostics' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(f.request).not.toHaveBeenCalled()
    expect(f.upload).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    f.repair()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(screen.getByText('recovered app')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('requires fresh consent before retrying a failed crash report without duplicating uploads', async () => {
    const f = fixture()
    const error = new Error('renderer failed with context')
    f.request.mockResolvedValueOnce({ ok: false, error: 'collection unavailable' })
    f.crash(error)
    fireEvent.click(screen.getByRole('button', { name: 'Send diagnostics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect((await screen.findByRole('alert')).textContent).toBe('collection unavailable')
    expect(f.request).toHaveBeenCalledTimes(1)
    expect(f.request.mock.calls[0][1].error_context).toBe(error.stack)
    expect(f.upload).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retry' }))
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy()
    expect(f.request).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await screen.findByText('Diagnostics sent')
    expect(f.request).toHaveBeenCalledTimes(2)
    expect(f.upload).toHaveBeenCalledTimes(1)
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('continues the existing upload state across a crash without sending it twice', async () => {
    const f = fixture()
    let finish!: (value: { id: string }) => void
    f.upload.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    act(() => requestSendDiagnostics('pre-crash report'))
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(f.upload).toHaveBeenCalledTimes(1))

    f.crash()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Uploading…' }).hasAttribute('disabled')).toBe(true)
    expect(f.request).toHaveBeenCalledTimes(1)
    expect(f.upload).toHaveBeenCalledTimes(1)
    fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0])
    await act(async () => finish({ id: 'late-result' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Diagnostics sent')).toBeNull()
  })
})

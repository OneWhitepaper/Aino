import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setRuntimeI18nLocale } from '@/i18n'
import { $gateway } from '@/store/gateway'
import {
  $sendDiagnostics,
  confirmSendDiagnostics,
  dismissSendDiagnostics,
  requestSendDiagnostics
} from '@/store/send-diagnostics'

const receipt = { id: '22c5a21b-bfaa-476e-92fd-3e408c6effb8', expires_at: '2026-11-07T00:00:00Z' }
const originalDesktop = window.hermesDesktop
const originalGateway = $gateway.get()

function rig() {
  const request = vi.fn().mockResolvedValue({ ok: true, bundle_base64: 'redacted-gzip' })
  const scope = vi.fn().mockResolvedValue({ user_id: '17', generation: 4, origin: 'https://api.agentera.com.cn' })
  const upload = vi.fn().mockResolvedValue(receipt)
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      platformDiagnostics: { scope, upload },
      getRecentLogs: vi.fn().mockResolvedValue({ lines: ['synthetic boot'] })
    }
  })
  $gateway.set({ request } as never)

  return { request, scope, upload }
}

describe('Aino diagnostic consent and upload', () => {
  beforeEach(() => setRuntimeI18nLocale('zh'))
  afterEach(() => {
    dismissSendDiagnostics()
    setRuntimeI18nLocale('en')
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: originalDesktop })
    $gateway.set(originalGateway)
  })
  it('requires consent and uploads once under the captured account', async () => {
    const f = rig()
    requestSendDiagnostics('synthetic error')
    expect(f.request).not.toHaveBeenCalled()
    expect(f.upload).not.toHaveBeenCalled()
    await confirmSendDiagnostics()
    await confirmSendDiagnostics()
    expect(f.request).toHaveBeenCalledExactlyOnceWith(
      'diagnostics.collect',
      {
        error_context: 'synthetic error',
        extra_files: { 'desktop.log': 'synthetic boot' }
      },
      120_000
    )
    expect(f.upload).toHaveBeenCalledExactlyOnceWith({
      bundle_base64: 'redacted-gzip',
      expected_user_id: '17',
      expected_generation: 4
    })
    expect($sendDiagnostics.get()).toMatchObject({ phase: 'done', result: { uploadId: receipt.id } })
  })
  it('does not collect for a signed-out account or missing native capability', async () => {
    const f = rig()
    f.scope.mockRejectedValue(new Error('authentication_required'))
    requestSendDiagnostics()
    await confirmSendDiagnostics()
    expect($sendDiagnostics.get()?.phase).toBe('error')
    expect(f.request).not.toHaveBeenCalled()
    expect(f.upload).not.toHaveBeenCalled()
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: undefined })
    requestSendDiagnostics()
    await confirmSendDiagnostics()
    expect($sendDiagnostics.get()?.phase).toBe('error')
    expect(f.request).not.toHaveBeenCalled()
  })
  it('does not fall back to Nous on collection or Aino upload failure', async () => {
    const f = rig()
    f.request.mockResolvedValueOnce({ ok: false, error: 'collection failed' })
    requestSendDiagnostics()
    await confirmSendDiagnostics()
    expect(f.upload).not.toHaveBeenCalled()
    expect($sendDiagnostics.get()).toMatchObject({ phase: 'error', error: 'collection failed' })
    f.upload.mockRejectedValueOnce(new Error('network_timeout'))
    requestSendDiagnostics()
    await confirmSendDiagnostics()
    expect(f.request.mock.calls.map(c => c[0])).toEqual(['diagnostics.collect', 'diagnostics.collect'])
    expect(f.upload).toHaveBeenCalledOnce()
    expect($sendDiagnostics.get()).toMatchObject({ phase: 'error', error: 'network_timeout' })
  })
  it('dismissal during collection prevents uploading', async () => {
    const f = rig()
    let resolve!: (value: unknown) => void
    f.request.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r
        })
    )
    requestSendDiagnostics()
    const pending = confirmSendDiagnostics()
    await vi.waitFor(() => expect(f.request).toHaveBeenCalled())
    dismissSendDiagnostics()
    resolve({ ok: true, bundle_base64: 'redacted-gzip' })
    await pending
    expect(f.upload).not.toHaveBeenCalled()
    expect($sendDiagnostics.get()).toBeNull()
  })
  it('ignores a late upload result after dismissal and a new dialog', async () => {
    const f = rig()
    let resolve!: (value: unknown) => void
    f.upload.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r
        })
    )
    requestSendDiagnostics()
    const pending = confirmSendDiagnostics()
    await vi.waitFor(() => expect(f.upload).toHaveBeenCalled())
    dismissSendDiagnostics()
    requestSendDiagnostics('fresh')
    resolve(receipt)
    await pending
    expect($sendDiagnostics.get()).toEqual({ phase: 'consent', errorContext: 'fresh' })
  })
  it('localizes the gateway-unavailable error', async () => {
    const f = rig()
    $gateway.set(null as never)
    requestSendDiagnostics()
    await confirmSendDiagnostics()
    expect($sendDiagnostics.get()).toMatchObject({ phase: 'error', error: 'Aino 网关不可用' })
    expect(f.upload).not.toHaveBeenCalled()
  })
})

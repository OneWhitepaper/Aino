import { gzipSync } from 'node:zlib'

import { describe, expect, it, vi } from 'vitest'

import { unwrapPlatformAccountIpc } from '../shared/platform-contract'

import { createPlatformAuth } from './platform-auth'
import { createPlatformClient } from './platform-client'
import { validateDiagnosticBundle } from './platform-diagnostics-contract'
import { registerPlatformIpc } from './platform-ipc'

const id = '22c5a21b-bfaa-476e-92fd-3e408c6effb8'

function bundle(redacted = true) {
  return gzipSync(
    JSON.stringify({
      format: 'hermes-debug-share/1',
      redacted,
      created: '2026-10-24T00:00:00Z',
      files: { report: 'synthetic diagnostics' }
    })
  ).toString('base64')
}

describe('Aino authenticated diagnostic uploads', () => {
  it('uploads only to the configured Aino API, with bearer auth and redirects disabled', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: {
            id,
            created_at: '2026-10-24T00:00:00Z',
            expires_at: '2026-11-07T00:00:00Z',
            size_bytes: 120
          }
        })
      )
    )

    const client = createPlatformClient({ origin: 'https://api.agentera.com.cn', fetchImpl })
    const result = await client.uploadDiagnostics('private-token', bundle())
    expect(result.id).toBe(id)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.agentera.com.cn/api/v1/desktop/diagnostics')
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      redirect: 'manual',
      headers: { authorization: 'Bearer private-token' }
    })
  })

  it('rejects redirects without a fallback request', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 307, headers: { location: 'https://portal.nousresearch.com' } }))
    const client = createPlatformClient({ origin: 'https://api.agentera.com.cn', fetchImpl })
    await expect(client.uploadDiagnostics('private-token', bundle())).rejects.toThrow('redirect_rejected')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('allows a slow upload past the ordinary account deadline but still times out', async () => {
    vi.useFakeTimers()

    try {
      const signals: AbortSignal[] = []

      const fetchImpl = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init!.signal!

            signals.push(signal)
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          })
      )

      const client = createPlatformClient({ origin: 'https://api.agentera.com.cn', fetchImpl })
      const ordinary = client.profile('private-token').catch(error => error.code)

      await vi.advanceTimersByTimeAsync(10_000)
      expect(await ordinary).toBe('network_timeout')

      const upload = client.uploadDiagnostics('private-token', bundle()).catch(error => error.code)

      await vi.advanceTimersByTimeAsync(10_000)
      expect(signals[1].aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(110_000)
      expect(await upload).toBe('network_timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects unredacted, malformed and oversized bundles before network I/O', async () => {
    const fetchImpl = vi.fn()
    const client = createPlatformClient({ origin: 'https://api.agentera.com.cn', fetchImpl })

    for (const value of [bundle(false), 'bad-base64', gzipSync('x'.repeat(16 * 1024 * 1024 + 1)).toString('base64')]) {
      await expect(client.uploadDiagnostics('private-token', value)).rejects.toThrow('invalid_diagnostics_bundle')
    }

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(validateDiagnosticBundle(bundle())).toBeTruthy()
  })

  it('fences the trusted IPC to the account generation captured before collection', async () => {
    const fetchImpl = vi.fn(
      async (url: string | URL | Request) =>
        new Response(
          JSON.stringify({
            code: 0,
            message: 'ok',
            data: String(url).endsWith('/user/profile')
              ? { id: 17, username: 'test', email: '' }
              : { id, created_at: '2026-10-24T00:00:00Z', expires_at: '2026-11-07T00:00:00Z', size_bytes: 120 }
          })
        )
    )

    const client = createPlatformClient({ origin: 'https://api.agentera.com.cn', fetchImpl })

    const auth = createPlatformAuth({
      client,
      now: Date.now,
      tokenStore: {
        load: async () => ({
          accessToken: 'test-token',
          refreshToken: 'test-refresh',
          expiresAt: Date.now() + 100_000
        }),
        save: async () => 'encrypted',
        clear: async () => {}
      }
    })

    await auth.initialize()
    const handlers = new Map<string, (...args: any[]) => any>()
    const frame = { url: 'file:///test/index.html' }
    const sender = { mainFrame: frame }
    const win = { isDestroyed: () => false, webContents: { isDestroyed: () => false, mainFrame: frame, send: vi.fn() } }

    const ipc = registerPlatformIpc({
      ipc: {
        handle: (name, handler) => {
          handlers.set(name, handler)
        }
      },
      auth,
      fromWebContents: () => win,
      trustedRendererUrl: frame.url,
      captcha: { acquire: vi.fn() }
    })

    ipc.registerWindow(win)
    const event = { sender, senderFrame: frame }
    const call = async (input: unknown, source = event) =>
      unwrapPlatformAccountIpc(await handlers.get('aino:platform-diagnostics:upload')!(source, input))
    const owner = { expected_user_id: '17', expected_generation: auth.generation(), bundle_base64: bundle() }
    await expect(call(owner, { ...event, senderFrame: { url: 'https://untrusted.test/' } })).rejects.toMatchObject({
      code: 'unauthorized_platform_ipc'
    })
    await expect(call({ ...owner, expected_generation: -1 })).rejects.toMatchObject({
      code: 'platform_account_changed'
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(await call(owner)).toMatchObject({ id })
    await auth.logout()
    const count = fetchImpl.mock.calls.length
    await expect(call(owner)).rejects.toMatchObject({ code: 'authentication_required' })
    expect(fetchImpl).toHaveBeenCalledTimes(count)
  })
})

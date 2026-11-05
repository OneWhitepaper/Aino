/**
 * Tests for electron/mcp-oauth-callback-ipc.ts — the client-side one-shot
 * loopback listener MCP OAuth uses against remote backends. Uses a REAL
 * ephemeral http listener (it binds 127.0.0.1:0, no fixed ports) with the
 * electron ipcMain mocked, and drives synthetic browser hits with fetch.
 *
 * Run with: vitest run --project electron mcp-oauth-callback-ipc
 */

import assert from 'node:assert/strict'

import { test, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  }
}))

const { registerMcpOauthCallbackIpc } = await import('./mcp-oauth-callback-ipc')

const disposeAll = registerMcpOauthCallbackIpc()

const invokeFrom = (senderId: number, channel: string, ...args: unknown[]) => {
  const fn = handlers.get(channel)

  assert.ok(fn, `handler registered for ${channel}`)

  return fn!({ sender: { id: senderId } }, ...args)
}

const invoke = (channel: string, ...args: unknown[]) => invokeFrom(1, channel, ...args)

test('listen binds a loopback listener and wait resolves with the redirect params', async () => {
  const { id, redirectUri } = (await invoke('hermes:mcp-oauth:listen')) as { id: string; redirectUri: string }

  assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/)

  const waitPromise = invoke('hermes:mcp-oauth:wait', id, 5000) as Promise<{
    code: null | string
    error: null | string
    state: null | string
  }>

  const res = await fetch(`${redirectUri}?code=abc123&state=st-1`)

  assert.equal(res.status, 200)

  const result = await waitPromise

  assert.equal(result.code, 'abc123')
  assert.equal(result.state, 'st-1')
  assert.equal(result.error, null)

  // Listener is one-shot: the port must be closed after the callback.
  await assert.rejects(fetch(`${redirectUri}?code=again&state=st-1`))
})

test('wait relays the RFC 9207 iss parameter from the redirect', async () => {
  // mcp 2.x rejects an authorization response omitting `iss` when the server
  // advertised `authorization_response_iss_parameter_supported` (Cloudflare,
  // Resend), so the listener must not drop it.
  const { id, redirectUri } = (await invoke('hermes:mcp-oauth:listen')) as { id: string; redirectUri: string }

  const waitPromise = invoke('hermes:mcp-oauth:wait', id, 5000) as Promise<{
    code: null | string
    iss: null | string
    state: null | string
  }>

  await fetch(`${redirectUri}?code=abc123&state=st-1&iss=${encodeURIComponent('https://mcp.cloudflare.com')}`)

  const result = await waitPromise

  assert.equal(result.code, 'abc123')
  assert.equal(result.iss, 'https://mcp.cloudflare.com')
})

test('a redirect without iss reports it as null rather than undefined', async () => {
  // Providers that do not advertise RFC 9207 keep working unchanged.
  const { id, redirectUri } = (await invoke('hermes:mcp-oauth:listen')) as { id: string; redirectUri: string }

  const waitPromise = invoke('hermes:mcp-oauth:wait', id, 5000) as Promise<{ iss: null | string }>

  await fetch(`${redirectUri}?code=abc123&state=st-1`)

  assert.equal((await waitPromise).iss, null)
})

test('non-callback noise (favicon) does not settle the listener', async () => {
  const { id, redirectUri } = (await invoke('hermes:mcp-oauth:listen')) as { id: string; redirectUri: string }
  const origin = redirectUri.replace(/\/callback$/, '')

  const res = await fetch(`${origin}/favicon.ico`)

  assert.equal(res.status, 200)

  const waitPromise = invoke('hermes:mcp-oauth:wait', id, 5000) as Promise<{ code: null | string }>

  await fetch(`${redirectUri}?code=late-code&state=s`)

  const result = await waitPromise

  assert.equal(result.code, 'late-code')
})

test('provider error param is forwarded', async () => {
  const { id, redirectUri } = (await invoke('hermes:mcp-oauth:listen')) as { id: string; redirectUri: string }

  const waitPromise = invoke('hermes:mcp-oauth:wait', id, 5000) as Promise<{
    code: null | string
    error: null | string
  }>

  await fetch(`${redirectUri}?error=access_denied&state=s`)

  const result = await waitPromise

  assert.equal(result.code, null)
  assert.equal(result.error, 'access_denied')
})

test('cancel tears the listener down and wait reports listener not found afterwards', async () => {
  const { id, redirectUri } = (await invoke('hermes:mcp-oauth:listen')) as { id: string; redirectUri: string }

  assert.equal(await invoke('hermes:mcp-oauth:cancel', id), true)

  await assert.rejects(fetch(`${redirectUri}?code=x&state=s`))

  const result = (await invoke('hermes:mcp-oauth:wait', id, 100)) as { error: null | string }

  assert.equal(result.error, 'listener not found')
})

test('wait times out when no callback arrives', async () => {
  const { id } = (await invoke('hermes:mcp-oauth:listen')) as { id: string }

  const result = (await invoke('hermes:mcp-oauth:wait', id, 1000)) as { code: null | string; error: null | string }

  assert.equal(result.code, null)
  assert.match(String(result.error), /timeout/)
})

test('only the originating renderer can cancel or collect its OAuth callback', async () => {
  const { id, redirectUri } = (await invoke('hermes:mcp-oauth:listen')) as { id: string; redirectUri: string }

  try {
    assert.equal(await invokeFrom(2, 'hermes:mcp-oauth:cancel', id), false)
    await fetch(`${redirectUri}?code=private-code&state=private-state`)

    assert.deepEqual(await invokeFrom(2, 'hermes:mcp-oauth:wait', id, 1000), {
      code: null,
      error: 'listener not found',
      iss: null,
      state: null
    })
    assert.deepEqual(await invoke('hermes:mcp-oauth:wait', id, 1000), {
      code: 'private-code',
      error: null,
      iss: null,
      state: 'private-state'
    })
  } finally {
    await invoke('hermes:mcp-oauth:cancel', id)
  }
})

test('retiring an account cancels every callback, including a listener still starting', async () => {
  const first = (await invoke('hermes:mcp-oauth:listen')) as { id: string; redirectUri: string }
  const second = (await invokeFrom(2, 'hermes:mcp-oauth:listen')) as { id: string; redirectUri: string }

  const starting = Promise.resolve(invoke('hermes:mcp-oauth:listen')).then(
    value => ({ value }) as { error?: Error; value?: { id: string } },
    error => ({ error }) as { error?: Error; value?: { id: string } }
  )

  const firstWait = invoke('hermes:mcp-oauth:wait', first.id, 1000)
  const secondWait = invokeFrom(2, 'hermes:mcp-oauth:wait', second.id, 1000)

  try {
    disposeAll()

    for (const result of await Promise.all([firstWait, secondWait])) {
      assert.deepEqual(result, { code: null, error: 'cancelled', iss: null, state: null })
    }

    await assert.rejects(fetch(`${first.redirectUri}?code=old-code`))
    await assert.rejects(fetch(`${second.redirectUri}?code=old-code`))
    assert.match(String((await starting).error), /cancelled/)
    assert.equal(
      ((await invoke('hermes:mcp-oauth:wait', first.id, 1000)) as { error: string }).error,
      'listener not found'
    )

    const current = (await invoke('hermes:mcp-oauth:listen')) as { id: string; redirectUri: string }

    await fetch(`${current.redirectUri}?code=current-code`)
    assert.equal(((await invoke('hermes:mcp-oauth:wait', current.id, 1000)) as { code: string }).code, 'current-code')
  } finally {
    await invoke('hermes:mcp-oauth:cancel', first.id)
    await invokeFrom(2, 'hermes:mcp-oauth:cancel', second.id)

    const started = await starting

    if (started.value) {
      await invoke('hermes:mcp-oauth:cancel', started.value.id)
    }
  }
})

import { type BrowserContext, request as playwrightRequest, type Route } from '@playwright/test'
import { expect, test } from 'vitest'

import { startWebappAccountFixture } from './webapp-account-fixture'

const PLATFORM_PRODUCTION_ORIGIN = 'https://api.agentera.com.cn'

async function rig() {
  const account = await startWebappAccountFixture()
  const api = await playwrightRequest.newContext()
  let matches!: (url: URL) => boolean
  let handle!: (route: Route) => Promise<void>
  const forwarded: Array<Record<string, string>> = []

  const context = {
    async route(match: typeof matches, handler: typeof handle) {
      matches = match
      handle = handler
    }
  } as unknown as BrowserContext

  await account.install(context)

  return {
    matches: (url: string) => matches(new URL(url)),
    forwarded,
    async send(method: string, path: string, body?: object, token?: string) {
      const headers = {
        origin: 'http://127.0.0.1:43210',
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: 'gateway-cookie=must-not-forward',
        'x-hermes-session-token': 'gateway-grant-must-not-forward',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }

      let fulfilled: Parameters<Route['fulfill']>[0] | undefined
      await handle({
        request: () => ({
          url: () => `${PLATFORM_PRODUCTION_ORIGIN}${path}`,
          method: () => method,
          headers: () => headers
        }),
        async fetch(options: Parameters<Route['fetch']>[0]) {
          const upstreamHeaders = options?.headers ?? {}
          forwarded.push(upstreamHeaders)

          return api.fetch(options!.url!, {
            method,
            data: body,
            headers: upstreamHeaders,
            maxRedirects: options?.maxRedirects
          })
        },
        async fulfill(options: Parameters<Route['fulfill']>[0]) {
          fulfilled = options
        }
      } as unknown as Route)

      if (!fulfilled) {
        throw new Error('platform fixture did not fulfill the request')
      }

      return {
        status: fulfilled.status ?? fulfilled.response?.status(),
        headers: fulfilled.headers,
        data: fulfilled.response ? await fulfilled.response.json() : null
      }
    },
    async close() {
      await api.dispose()
      await account.close()
    }
  }
}

test('the scoped platform fixture never matches gateway, relay, other-host, or non-API requests', async () => {
  const fixture = await rig()

  try {
    expect(fixture.matches(`${PLATFORM_PRODUCTION_ORIGIN}/api/v1/settings/public`)).toBe(true)

    for (const url of [
      'http://127.0.0.1:43210/api/ws',
      'http://127.0.0.1:43210/api/relay/id/api/profiles',
      'https://unrelated.invalid/api/v1/settings/public',
      'https://api.agentera.com.cn.evil.invalid/api/v1/settings/public',
      'http://api.agentera.com.cn/api/v1/settings/public',
      `${PLATFORM_PRODUCTION_ORIGIN}/api/ws`,
      `${PLATFORM_PRODUCTION_ORIGIN}/api/v10/settings/public`
    ]) {
      expect(fixture.matches(url), url).toBe(false)
    }

    const preflight = await fixture.send('OPTIONS', '/api/v1/auth/phone/verify')
    expect(preflight.status).toBe(204)
    expect(preflight.headers?.['access-control-allow-origin']).toBe('http://127.0.0.1:43210')
    expect(fixture.forwarded).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('the live platform fixture still requires an issued challenge and authenticated bearer profile', async () => {
  const fixture = await rig()

  const input = {
    phone: '+8613800138000',
    challenge_id: 'native-challenge',
    code: '246810',
    agreement_revision: 'native-terms-1'
  }

  try {
    expect((await fixture.send('GET', '/api/v1/user/profile')).status).toBe(401)
    expect((await fixture.send('POST', '/api/v1/auth/phone/verify', input)).status).toBe(401)
    expect((await fixture.send('POST', '/api/v1/auth/phone/send-code', { phone: input.phone })).status).toBe(200)
    expect((await fixture.send('POST', '/api/v1/auth/phone/verify', { ...input, code: '000000' })).status).toBe(401)
    const verified = await fixture.send('POST', '/api/v1/auth/phone/verify', input)
    expect(verified.status).toBe(200)
    expect((await fixture.send('POST', '/api/v1/auth/phone/verify', input)).status).toBe(401)
    const profile = await fixture.send('GET', '/api/v1/user/profile', undefined, verified.data.data.access_token)
    expect(profile.status).toBe(200)
    expect(profile.data.data.id).toBe(17)
    expect(profile.headers?.['access-control-allow-origin']).toBe('http://127.0.0.1:43210')
    expect(fixture.forwarded.at(-1)?.authorization).toBe('Bearer native-access-token')

    for (const headers of fixture.forwarded) {
      expect(headers).not.toHaveProperty('cookie')
      expect(headers).not.toHaveProperty('x-hermes-session-token')
    }
  } finally {
    await fixture.close()
  }
})

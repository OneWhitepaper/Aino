import { type BrowserContext, expect, type Page } from '@playwright/test'

import { startPlatformServer } from '../../../../tests-js/scripts/platform-account-fixture'

const PLATFORM_ORIGIN = 'https://api.agentera.com.cn'

/** Only the external account service is a fixture; the browser bridge and gateway stay real. */
export async function startWebappAccountFixture() {
  const platform = await startPlatformServer()

  return {
    async install(context: BrowserContext): Promise<void> {
      await context.route(
        url => url.origin === PLATFORM_ORIGIN && url.pathname.startsWith('/api/v1/'),
        async route => {
          const request = route.request()
          const headers = request.headers()

          const cors = {
            'access-control-allow-origin': headers.origin || '*',
            'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'access-control-allow-headers': 'accept, authorization, content-type'
          }

          if (request.method() === 'OPTIONS') {
            await route.fulfill({ status: 204, headers: cors })

            return
          }

          const url = new URL(request.url())

          const response = await route.fetch({
            url: `${platform.origin}${url.pathname}${url.search}`,
            maxRedirects: 0,
            headers: Object.fromEntries(
              Object.entries(headers).filter(([key]) => ['accept', 'authorization', 'content-type'].includes(key))
            )
          })

          await route.fulfill({ response, headers: { ...response.headers(), ...cors } })
        }
      )
    },

    /** Every new document signs in explicitly: browser platform tokens are memory-only. */
    async signIn(page: Page): Promise<void> {
      const start = platform.requests.length
      // The one-use launch document redirects before installing the real bridge.
      // Follow that document replacement, not a poll of the discarded context.
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.hermesDesktopHost === 'browser' &&
          (window as Window & { hermesDesktop?: { accountAdapter?: string } }).hermesDesktop?.accountAdapter ===
            'platform',
        undefined,
        { timeout: 60_000 }
      )
      await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+8613800138000')
      await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
      await page.getByRole('button', { name: 'Send code', exact: true }).click()
      await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('246810')
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const bridge = (
              window as unknown as {
                hermesDesktop: {
                  platformAccount: {
                    status(): Promise<{
                      phase: string
                      account: null | { id: string | number }
                      mode: string
                      remember_state: string
                      error: unknown
                    }>
                  }
                }
              }
            ).hermesDesktop

            const state = await bridge.platformAccount.status()

            return {
              phase: state.phase,
              userId: String(state.account?.id ?? ''),
              mode: state.mode,
              remember: state.remember_state,
              error: state.error
            }
          })
        )
        .toEqual({
          phase: 'signed_in',
          userId: '17',
          mode: 'production',
          remember: 'session_only',
          error: null
        })
      await expect(page.locator('[data-account-login-page]')).toHaveCount(0)

      const savedTokens = await page.evaluate(() =>
        [localStorage, sessionStorage].some(storage =>
          Object.values(storage).some(value => /native-(?:access|refresh)-token/.test(value))
        )
      )

      expect(savedTokens, 'browser platform credentials remain memory-only').toBe(false)
      const requests = platform.requests.slice(start)
      expect(requests.filter(row => row.method === 'POST' && row.path === '/api/v1/auth/phone/verify')).toHaveLength(1)
      expect(requests.some(row => row.authenticatedProfile === true)).toBe(true)
    },

    close: platform.close
  }
}

export type WebappAccountFixture = Awaited<ReturnType<typeof startWebappAccountFixture>>

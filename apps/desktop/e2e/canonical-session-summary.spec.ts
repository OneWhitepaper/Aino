/** Native Electron → canonical owner → cited summary inference and accounting. */
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { restartMockServer } from '../../../tests-js/scripts/mock-server'

import { setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

test('native semantic summary reuses the conversation route and records auxiliary usage', async () => {
  test.setTimeout(180_000)
  restartMockServer()
  const requests: Array<Record<string, unknown>> = []

  const fixture = await setupMockBackend({
    nativeGateway: true,
    extraConfig: 'account:\n  dev_mode: true',
    mockServer: {
      onRequest: request => requests.push(request),
      replyForPrompt: prompt => {
        if (prompt.startsWith('[{"id":')) {
          const rows = JSON.parse(prompt) as Array<{ id: number }>

          return JSON.stringify({
            objective: { text: 'Verify the native session summary.', message_ids: [rows[0].id] },
            completed: [],
            conclusions: [],
            open_questions: []
          })
        }

        return 'The native summary witness is ready. '.repeat(30)
      }
    }
  })

  try {
    const { page } = fixture
    await page.getByRole('textbox', { name: /^(?:手机号|Phone number)$/ }).fill('13800000119')
    await page
      .getByRole('checkbox', { name: /^(?:同意用户协议和隐私政策|Agree to the user agreement and privacy policy)$/ })
      .check()
    await page.getByRole('button', { name: /^(?:发送验证码|Send code)$/ }).click()
    await page.getByRole('textbox', { name: /^(?:验证码|Verification code)$/ }).fill('1234')
    await page.getByRole('button', { name: /^(?:登录|Sign in)$/ }).click()
    await waitForAppReady(fixture, 120_000)
    const editor = page.locator('[data-slot="composer-rich-input"]:visible')
    await editor.fill('Verify the native semantic summary and preserve the conversation model. '.repeat(30))
    await editor.press('Enter')
    await expect(page.getByText(/The native summary witness is ready\./).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('button', { name: /^(?:停止|Stop)$/ })).toHaveCount(0, { timeout: 60_000 })

    const proof = await page.evaluate(async () => {
      const bridge = (window as unknown as {
        hermesDesktop: {
          profile: { get: () => Promise<{ profile: string }> }
          getGatewayWsUrl: (profile?: string) => Promise<string | { ok: boolean; wsUrl: string }>
        }
      }).hermesDesktop

      const active = await bridge.profile.get()
      const minted = await bridge.getGatewayWsUrl(active.profile)
      const url = new URL(typeof minted === 'string' ? minted : minted.wsUrl)

      if (!url.searchParams.has('native_dial')) {throw new Error('The fixture did not start a canonical native owner')}
      const ticket = url.searchParams.get('ticket')
      url.searchParams.delete('ticket')
      const ws = new WebSocket(url, ['hermes-gateway-v1', `hermes-gateway-ticket.${ticket}`])

      try {
        await new Promise<void>((resolve, reject) => {
          ws.addEventListener('open', () => resolve(), { once: true })
          ws.addEventListener('error', () => reject(new Error('Native summary socket failed')), { once: true })
        })

        const call = (id: string, method: string, params: Record<string, unknown>) =>
          new Promise<Record<string, unknown>>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Native summary reply timed out')), 45_000)

            const onMessage = (event: MessageEvent) => {
              const frame = JSON.parse(String(event.data)) as { id?: string }

              if (frame.id === id) {
                clearTimeout(timer)
                ws.removeEventListener('message', onMessage)
                resolve(frame)
              }
            }

            ws.addEventListener('message', onMessage)
            ws.send(JSON.stringify({ id, method, params }))
          })

        const listed = await call('native-summary-list', 'session.list', { scope: 'live', include_hidden: true })
        const sessions = (listed.result as { sessions: Array<{ session_id: string; message_count: number }> }).sessions
        const session = sessions.find(item => item.message_count >= 2)

        if (!session) {throw new Error(`Native conversation is missing from ${active.profile}: ${JSON.stringify(listed)}`)}

        return await call('native-summary', 'session.summary', { session_id: session.session_id, language: 'en' })
      } finally {
        ws.close()
      }
    })

    expect(proof).toMatchObject({ result: { summary: { objective: { text: 'Verify the native session summary.' } } } })
    expect(requests.some(request => JSON.stringify(request.messages).includes('Write a concise session summary'))).toBe(true)
    const db = new DatabaseSync(path.join(fixture.sandbox.hermesHome, 'state.db'), { readOnly: true })

    try {
      const usage = db.prepare('SELECT input_tokens, output_tokens FROM session_model_usage WHERE task=?').all('session_summary')
      expect(usage).toHaveLength(1)
      expect(Number(usage[0].input_tokens)).toBeGreaterThan(0)
      expect(Number(usage[0].output_tokens)).toBeGreaterThan(0)
      await test.info().attach('native-summary-receipt', {
        body: JSON.stringify({ proof, usage }, null, 2), contentType: 'application/json'
      })
    } finally {
      db.close()
    }
  } finally {
    await fixture.cleanup()
  }
})

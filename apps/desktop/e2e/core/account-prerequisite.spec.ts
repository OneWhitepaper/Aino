/** Fresh core sandboxes authenticate before chat; later account failures stay failures. */
import { expect, type Page, test } from '@playwright/test'

import {
  coreAppEnv,
  createCoreSandbox,
  currentSessionId,
  launchCoreApp,
  recordWebSockets,
  send,
  signInCoreAccount,
  storedSessionForMarker,
  waitForInteractive,
  writeProviderHome
} from './harness'
import { assertTranscriptOracle, installDuplicateSampler } from './oracle'
import { startScriptedProvider } from './provider'

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^My account · / }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('dialog', { name: 'Sign out', exact: true })
    .getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.locator('[data-account-login-card]')).toBeVisible()
}

test('fresh core login is recorded before the first chat, never retried after reload or logout', async () => {
  const sandbox = createCoreSandbox('account-prerequisite')
  const provider = await startScriptedProvider()
  writeProviderHome(sandbox.hermesHome, provider.url)
  const { app, page } = await launchCoreApp(coreAppEnv(sandbox))
  const ws = recordWebSockets(page)
  const nonce = Math.random().toString(36).slice(2, 8)
  const marker = `U1-${nonce}`

  try {
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(false)
    await expect(page.locator('[data-account-login-card]')).toBeVisible()
    await waitForInteractive(app, page, 60_000)
    expect(await page.evaluate(() => (window as Window & {
      hermesDesktop?: { accountAdapter?: string }
    }).hermesDesktop?.accountAdapter)).toBe('legacy-development')
    expect(app.windows(), 'development login stays in the recorded window').toEqual([page])
    expect(ws.sent.filter(frame => frame.method === 'account.verify_code')).toHaveLength(1)
    await installDuplicateSampler(page)

    provider.script(marker, [{ text: [`A1-${nonce} `, 'authenticated first reply'] }])
    await send(page, `${marker} hello`, 'Enter', ws)
    await expect.poll(() => provider.completions.some(c => c.marker === marker && c.finished)).toBe(true)
    await expect.poll(() => currentSessionId(page)).not.toBe('')
    const sessionId = await currentSessionId(page)
    await expect.poll(() => storedSessionForMarker(sandbox, 'default', marker)).toBe(sessionId)
    await assertTranscriptOracle(page, ws, provider, { sessionId, expectUserMarkers: [marker] }, 'fresh account first chat')

    await page.reload()
    await waitForInteractive(app, page, 60_000)
    await installDuplicateSampler(page)
    await expect.poll(() => currentSessionId(page)).toBe(sessionId)
    await assertTranscriptOracle(page, ws, provider, { sessionId, expectUserMarkers: [marker] }, 'account reload')
    expect(ws.sent.filter(frame => frame.method === 'account.verify_code'), 'reload restores without signing in').toHaveLength(1)

    await signOut(page)
    await expect(waitForInteractive(app, page, 1_000)).rejects.toThrow('app never became interactive')
    await expect(page.locator('[data-account-login-card]')).toBeVisible()
    expect(ws.sent.filter(frame => frame.method === 'account.verify_code'), 'readiness must not undo logout').toHaveLength(1)
  } finally {
    await app.close().catch(() => undefined)
    await provider.close()
    sandbox.cleanup()
  }
})

test('explicit login and cold relaunch do not grant a new automatic sign-in attempt', async () => {
  const sandbox = createCoreSandbox('account-relaunch')
  const provider = await startScriptedProvider()
  writeProviderHome(sandbox.hermesHome, provider.url)
  let live: Awaited<ReturnType<typeof launchCoreApp>> | undefined

  try {
    live = await launchCoreApp(coreAppEnv(sandbox))
    const ws = recordWebSockets(live.page)
    await signInCoreAccount(live.page)
    await waitForInteractive(live.app, live.page, 60_000)
    expect(ws.sent.filter(frame => frame.method === 'account.verify_code')).toHaveLength(1)
    await signOut(live.page)
    await live.app.close()

    live = await launchCoreApp(coreAppEnv(sandbox))
    const restored = recordWebSockets(live.page)
    await expect(live.page.locator('[data-account-login-card]')).toBeVisible()
    await expect(waitForInteractive(live.app, live.page, 1_000)).rejects.toThrow('app never became interactive')
    await expect(live.page.locator('[data-account-login-card]')).toBeVisible()
    expect(restored.sent.filter(frame => frame.method === 'account.verify_code'), 'a broken cold restore must stay red').toEqual([])
  } finally {
    await live?.app.close().catch(() => undefined)
    await provider.close()
    sandbox.cleanup()
  }
})

import * as fs from 'node:fs'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture | null = null

test.afterEach(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('reopens a closed macOS workspace without flashing login or resizing through a login window', async () => {
  test.skip(process.platform !== 'darwin', 'Dock reopen keeps the process alive on macOS.')
  test.slow()
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: zh',
    extraConfig:
      'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true\nauxiliary:\n  title_generation:\n    enabled: false',
    mockServer: { replyForPrompt: () => '关闭窗口前的进展已保存。' }
  })
  const { app } = fixture
  let page = fixture.page
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800000105')
  await page.getByRole('checkbox', { name: '同意用户协议和隐私政策', exact: true }).check()
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('1234')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
  await page.locator('[data-slot="composer-rich-input"]:visible').fill('关闭窗口再打开')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText('关闭窗口前的进展已保存。', { exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0)
  await expect(page.locator('[data-sidebar-session-row]')).toHaveCount(1)
  const route = await page.evaluate(() => location.hash)
  const errors: string[] = []
  await app.context().addInitScript(() => {
    const target = window as typeof window & { loginFrames: number }
    target.loginFrames = 0

    const observe = () => {
      if (document.querySelector('[data-account-login-page]')) {
        target.loginFrames += 1
      }
    }

    new MutationObserver(observe).observe(document, { childList: true, subtree: true })
  })

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 780))
    const closed = page.waitForEvent('close')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await closed
    await app.evaluate(({ app }) => {
      const target = globalThis as typeof globalThis & { reopenWidths: number[] }
      target.reopenWidths = []
      app.once('browser-window-created', (_event, window) => {
        const sample = () => target.reopenWidths.push(window.getBounds().width)
        sample()
        window.on('resize', sample)
      })
    })
    const reopened = app.waitForEvent('window')
    await app.evaluate(({ app }) => app.emit('activate'))
    page = await reopened
    fixture.page = page
    page.on('pageerror', error => errors.push(error.message))
    await waitForAppReady(fixture, 120_000)
    await expect(page.getByText('关闭窗口前的进展已保存。', { exact: true })).toBeVisible({ timeout: 30_000 })
    expect(await page.evaluate(() => location.hash)).toBe(route)
    const loginFrames = await page.evaluate(() => (window as typeof window & { loginFrames: number }).loginFrames)
    const widths = await app.evaluate(() => (globalThis as typeof globalThis & { reopenWidths: number[] }).reopenWidths)
    fs.writeFileSync(test.info().outputPath(`reopen-${cycle}.json`), JSON.stringify({ loginFrames, widths }))
    expect(loginFrames, 'the restored account must never render a login form').toBe(0)
    expect(Math.min(...widths), 'the native window must keep workspace bounds').toBeGreaterThanOrEqual(1100)
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  }

  await page.screenshot({ path: test.info().outputPath('reopened-workspace.png') })
  expect(errors).toEqual([])
})

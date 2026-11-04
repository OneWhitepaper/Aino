import * as fs from 'node:fs'

import type { Locator } from '@playwright/test'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture | null = null

test.afterEach(async () => {
  await fixture?.cleanup()
  fixture = null
})

async function fontSize(element: Locator) {
  return element.evaluate(node => parseFloat(getComputedStyle(node).fontSize))
}

async function captureWindow(name: string) {
  // Native capture includes Chromium zoom; Playwright's CSS-sized clip can
  // crop the right/bottom of a zoomed Electron window on Retina displays.
  const png = await fixture!.app.evaluate(async ({ BrowserWindow }) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()

    return image.toPNG().toString('base64')
  })

  fs.writeFileSync(test.info().outputPath(name), Buffer.from(png, 'base64'))
}

test('keeps navigation readable and scales the whole interface independently of chat text', async () => {
  test.slow()
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: zh',
    extraConfig:
      'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true\nauxiliary:\n  title_generation:\n    enabled: false',
    mockServer: { replyForPrompt: () => '字号验收回复。' }
  })
  const { app, page } = fixture
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800000104')
  await page.getByRole('checkbox', { name: '同意用户协议和隐私政策', exact: true }).check()
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('1234')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
  const editor = page.locator('[data-slot="composer-rich-input"]:visible')
  await editor.fill('字号验收')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText('字号验收回复。', { exact: true })).toBeVisible({ timeout: 90_000 })
  const chatRoute = await page.evaluate(() => window.location.hash)
  const navigation = page.locator('.aino-sidebar-nav-row:visible').first()
  const session = page.locator('[data-sidebar-session-row] .aino-sidebar-session-label:visible').first()
  const identity = page.locator('[data-slot="sidebar-identity-footer"] > [data-slot="button"]:visible')
  const baseFont = await fontSize(editor)

  // All three are primary reading targets; metadata keeps its smaller caption role.
  await expect.poll(() => fontSize(navigation)).toBe(baseFont)
  await expect.poll(() => fontSize(session)).toBe(baseFont)
  await expect.poll(() => fontSize(identity)).toBe(baseFont)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
  await expect.poll(() => fontSize(navigation)).toBe(baseFont)
  await captureWindow('typography-large.png')

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=config:appearance'
  })
  await page.getByRole('combobox', { name: '聊天文字大小', exact: true }).click()
  await page.getByRole('option', { name: '125%', exact: true }).click()
  await page.evaluate(route => {
    window.location.hash = route
  }, chatRoute)
  await expect.poll(() => fontSize(editor)).toBe(baseFont * 1.25)
  expect(await fontSize(navigation)).toBe(baseFont)

  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=config:appearance'
  })
  const globalScale = page.getByRole('combobox', { name: '全局界面缩放', exact: true })
  await globalScale.click()
  await page.getByRole('option', { name: '125%', exact: true }).click()
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()))
    .toBeCloseTo(1.25, 2)
  await expect(globalScale).toContainText('125%')
  await page.reload()
  await expect(globalScale).toContainText('125%', { timeout: 30_000 })
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()))
    .toBeCloseTo(1.25, 2)
  await captureWindow('typography-settings-global.png')

  await page.evaluate(route => {
    window.location.hash = route
  }, chatRoute)
  await expect.poll(() => fontSize(editor)).toBe(baseFont * 1.25)
  expect(await fontSize(navigation)).toBe(baseFont)
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.unmaximize()
    window.setSize(1000, 760)
  })
  await expect(editor).toBeInViewport()
  await expect(navigation).toBeInViewport()
  await expect(page.locator('[data-sidebar-session-row]:visible').first()).toBeInViewport()
  expect(
    await editor.evaluate(node => {
      const rect = node.getBoundingClientRect()

      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
    })
  ).toBe(true)
  await captureWindow('typography-compact.png')
  expect(errors).toEqual([])
})

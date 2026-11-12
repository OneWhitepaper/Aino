import { restartMockServer } from '../../../tests-js/scripts/mock-server'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

const reply = [
  '# 滚动位置验收',
  ...Array.from(
    { length: 32 },
    (_, index) =>
      `## 检查记录 ${index + 1}\n\n这是一段用于桌面滚动验收的测试内容。阅读历史消息时，回到最新消息的按钮应始终位于输入框上方。窗口变化与草稿增加都不应把按钮推到正文中间。`
  )
].join('\n\n')

let fixture: MockBackendFixture | null = null

test.afterEach(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('keeps the latest-message control above its composer as the pane and draft resize', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'The native Electron fixture uses Chromium.')
  test.setTimeout(300_000)
  restartMockServer()
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: zh',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true',
    mockServer: { replyForPrompt: () => reply }
  })
  const { app, page } = fixture
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('textbox', { name: '手机号', exact: true }).waitFor({ state: 'visible', timeout: 120_000 })
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800000108')
  await page.getByRole('checkbox', { name: '同意用户协议和隐私政策', exact: true }).check()
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('1234')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960))
  await page.emulateMedia({ reducedMotion: 'reduce' })

  const editor = page.locator('[data-slot="composer-rich-input"]:visible')
  await editor.fill('请输出用于滚动位置验收的长回复。')
  await editor.press('Enter')
  await expect(page.getByRole('heading', { name: '滚动位置验收', exact: true })).toHaveCount(1, { timeout: 60_000 })
  await expect(page.getByRole('button', { name: /^(停止|Stop)$/ })).toHaveCount(0, { timeout: 60_000 })

  const viewport = page.locator('[data-slot="aui_thread-viewport"]:visible')
  const jump = page.locator('.thread-jump-button[aria-hidden="false"]:visible')

  const readGeometry = () =>
    jump.evaluate(button => {
      const chat = button.closest('[data-chat-surface]')!
      const bounds = chat.querySelector('[data-slot="composer-bounds"]')!.getBoundingClientRect()
      const dock = chat.querySelector('[data-slot="composer-dock"]')!.getBoundingClientRect()
      const composer = chat.querySelector('[data-slot="composer-surface"]')!.getBoundingClientRect()
      const rect = button.getBoundingClientRect()

      return {
        gap: bounds.bottom - rect.bottom,
        dockGap: dock.top - rect.bottom,
        centerError: Math.abs(rect.left + rect.width / 2 - (composer.left + composer.width / 2)),
        receivesPointer: button.contains(
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        )
      }
    })

  const checkPosition = async (scene: string) => {
    await viewport.hover()
    await page.mouse.wheel(0, -520)
    await expect(jump).toBeVisible()
    await expect
      .poll(
        async () => {
          const geometry = await readGeometry()

          return Math.max(Math.abs(geometry.gap - 12), Math.abs(geometry.dockGap - 12), geometry.centerError)
        },
        { message: scene }
      )
      .toBeLessThanOrEqual(2)
    expect((await readGeometry()).receivesPointer, scene).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`jump-${scene}.png`), scale: 'css' })
  }

  await checkPosition('desktop')
  await page.getByRole('button', { name: '显示右侧栏', exact: true }).click()
  await expect(page.locator('[data-tool-panel]:visible')).toBeVisible()
  await checkPosition('with-tools')

  const draft = Array.from({ length: 8 }, (_, index) => `第 ${index + 1} 行：保留这段尚未发送的草稿。`).join('\n')
  await editor.fill(draft)
  await checkPosition('multiline-draft')
  await page.getByRole('button', { name: '隐藏右侧栏', exact: true }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 800))
  await checkPosition('narrow')

  await jump.click()
  await expect(viewport).toHaveAttribute('data-following', 'true')
  await expect(jump).toHaveCount(0)
  await expect(editor).toHaveText(draft, { useInnerText: true })
  expect(errors).toEqual([])
})

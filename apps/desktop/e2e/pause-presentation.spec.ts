/** Paused tasks resume from the primary composer button without a visual status banner. */
import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

const REQUEST = 'E2E_PAUSE_PRESENTATION'
const PROGRESS = '已经核对首个文件。'
let fixture: MockBackendFixture | null = null

test.afterEach(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('resumes preserved progress from the primary composer button without a pause banner', async () => {
  test.slow()
  const testInfo = test.info()
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: zh',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true\nauxiliary:\n  title_generation:\n    enabled: false',
    mockServer: {
      holdFirstStreamForPrompt: REQUEST,
      replyForPrompt: prompt => prompt.includes(REQUEST) ? `${PROGRESS} ${'后续检查 '.repeat(300)}` : '已继续处理剩余步骤。'
    }
  })
  const { app, page, mock } = fixture
  const rendererErrors: string[] = []
  page.on('pageerror', error => rendererErrors.push(error.message))
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800000101')
  await page.getByRole('checkbox', { name: '同意用户协议和隐私政策', exact: true }).check()
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('1234')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await waitForAppReady(fixture, 120_000)

  const composer = page.locator('[data-slot="composer-surface"]:visible')
  await composer.locator('[data-slot="composer-rich-input"]').fill(REQUEST)
  await composer.getByRole('button', { name: '发送', exact: true }).click()
  await mock.waitForHeldStream()
  await expect(page.getByText(PROGRESS, { exact: true })).toBeVisible()
  await composer.getByRole('button', { name: '停止', exact: true }).click()
  mock.releaseHeldStream()

  const notice = page.locator('[data-slot="aui_assistant-message-stopped"]')
  await expect(notice).toHaveText('已暂停，当前进展已保留。')
  await expect(notice).toHaveAttribute('role', 'status')
  expect((await notice.boundingBox())!.height).toBeLessThanOrEqual(1)
  await expect(page.getByText('Response stopped', { exact: true })).toHaveCount(0)
  await expect(composer.locator('[data-slot="task-pause-notice"]')).toHaveCount(0)
  const continuation = composer.getByRole('button', { name: '继续', exact: true })

  await expect(continuation).toBeEnabled({ timeout: 30_000 })
  await expect(continuation).toHaveAttribute('type', 'button')
  const editor = composer.locator('[data-slot="composer-rich-input"]')

  await editor.fill('先检查另一个文件')
  await expect(composer.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await expect(continuation).toHaveCount(0)
  await editor.fill('')
  await expect(continuation).toBeEnabled()

  const geometry = await continuation.evaluate(element => {
    const button = element.getBoundingClientRect()
    const controls = element.closest('.aino-composer-controls')!.getBoundingClientRect()
    const style = getComputedStyle(element)

    return {
      square: Math.abs(button.width - button.height),
      radius: parseFloat(style.borderRadius),
      width: button.width,
      right: controls.right - button.right,
      glyph: element.querySelector('[data-aino-icon="PlayFilled"]') !== null
    }
  })

  expect(geometry.square).toBeLessThan(1)
  expect(geometry.radius).toBeGreaterThanOrEqual(geometry.width / 2)
  expect(geometry.right).toBeLessThanOrEqual(1)
  expect(geometry.glyph).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('paused-desktop.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 720))
  await expect(continuation).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('paused-compact.png') })

  await continuation.click()
  await expect(continuation).toHaveCount(0)
  await expect(page.getByText('已继续处理剩余步骤。', { exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(rendererErrors).toEqual([])
})

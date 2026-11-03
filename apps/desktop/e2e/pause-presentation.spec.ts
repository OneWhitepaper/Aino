/** Pause feedback stays in the transcript column and resumes through the existing continuation. */
import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

const REQUEST = 'E2E_PAUSE_PRESENTATION'
const PROGRESS = '已经核对首个文件。'
let fixture: MockBackendFixture | null = null

test.afterEach(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('shows a localized aligned pause notice and continues preserved progress', async () => {
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

  const notice = page.locator('[data-slot="aui_assistant-message-stopped"]:visible')
  await expect(notice).toHaveText('已暂停，当前进展已保留。')
  await expect(notice).toHaveAttribute('role', 'status')
  await expect(page.getByText('Response stopped', { exact: true })).toHaveCount(0)
  const paused = composer.locator('[data-slot="task-pause-notice"]')
  await expect(paused).toContainText('任务已暂停，可从已有进展继续。')
  const continuation = paused.getByRole('button', { name: '继续', exact: true })

  await expect(continuation).toBeEnabled({ timeout: 30_000 })

  const alignment = await notice.evaluate(element => {
    const body = element.closest('[data-slot="aui_assistant-message-content"]')!
    const notice = element.getBoundingClientRect()
    const content = body.getBoundingClientRect()

    return { left: notice.left - content.left, fits: notice.right <= content.right + 1 }
  })

  expect(alignment.left).toBeCloseTo(0)
  expect(alignment.fits).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('paused-desktop.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 720))
  await expect(notice).toBeVisible()
  await expect(continuation).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('paused-compact.png') })

  await continuation.click()
  await expect(paused).toHaveCount(0)
  await expect(page.getByText('已继续处理剩余步骤。', { exact: true })).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(rendererErrors).toEqual([])
})

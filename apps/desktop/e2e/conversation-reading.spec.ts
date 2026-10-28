import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

const REPLY = [
  '## 项目检查结果',
  '已经检查项目配置和现有组件。普通回复继续使用清晰的中文段落，执行过程与回复内容各有自己的层级。',
  '以下是这次检查的主要结果：',
  '- 项目对话可以正常使用。\n- 工具记录仍可展开查看。\n- 费用明细保留原有入口。',
  '| 检查项目 | 结果 |\n| --- | --- |\n| 会话与项目 | 可继续使用 |\n| 工具与审批 | 保留现有流程 |',
  '```python\nprint("Aino 项目检查完成")\n```',
  '需要核对执行细节时，可以展开回复下方的消耗详情。'
].join('\n\n')

let fixture: MockBackendFixture
const rendererErrors: string[] = []

test.beforeAll(async () => {
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: zh',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true',
    mockServer: {
      replyForPrompt: () => REPLY,
      streamUsage: { prompt_tokens: 1000, completion_tokens: 256, total_tokens: 1256 }
    }
  })
  const { page } = fixture
  page.on('console', message => {
    // Electron's unpackaged CSP warning is expected in the source test fixture.
    if (
      ['error', 'warning'].includes(message.type()) &&
      !message.text().includes('Electron Security Warning (Insecure Content-Security-Policy)')
    ) {
      rendererErrors.push(message.text())
    }
  })
  page.on('pageerror', error => rendererErrors.push(error.message))
  expect(
    await page.evaluate(
      () => (window as Window & { hermesDesktop?: { accountAdapter?: string } }).hermesDesktop?.accountAdapter
    )
  ).toBe('legacy-development')

  const agreement = page.getByRole('checkbox', {
    name: /^(同意用户协议和隐私政策|Agree to the user agreement and privacy policy)$/
  })

  await expect(agreement).toBeVisible({ timeout: 60_000 })
  await page.getByRole('textbox', { name: /^(手机号|Phone number)$/ }).fill('13800000106')
  await agreement.check()
  await page.getByRole('button', { name: /^(发送验证码|Send code)$/ }).click()
  await page.getByRole('textbox', { name: /^(验证码|Verification code)$/ }).fill('1234')
  await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click()
  await waitForAppReady(fixture, 120_000)
  const input = page.locator('[data-slot="composer-rich-input"]:visible')
  await input.fill('检查项目的显示与交互，保留现有功能。')
  await input.press('Enter')
  await expect(page.getByRole('heading', { name: '项目检查结果', exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /^(停止|Stop)$/ })).toHaveCount(0, { timeout: 60_000 })
})

test.afterAll(async () => {
  await fixture?.cleanup()
})

test('applies the shared reading role and remembered scale to prose, user text and the composer', async () => {
  const { page } = fixture

  for (const scale of [100, 110, 125]) {
    await page.evaluate(value => {
      localStorage.setItem('hermes.desktop.chat-text-scale.v1', String(value))
    }, scale)
    await page.reload()
    await waitForAppReady(fixture, 120_000)
    await expect(page.getByRole('heading', { name: '项目检查结果', exact: true })).toBeVisible()

    const typography = await page.evaluate(() => {
      const surface = document.querySelector('[data-chat-surface][data-conversation-layout]')!
      const prose = surface.querySelector('[data-slot="aui_assistant-message-content"] .aui-md p')!
      const user = surface.querySelector('.composer-human-message')!
      const input = surface.querySelector('[data-slot="composer-rich-input"]')!
      const footer = surface.querySelector('[data-slot="aui_reply-metrics"]')!
      const root = getComputedStyle(document.documentElement)

      return {
        role: parseFloat(root.getPropertyValue('--aino-text-body')) * parseFloat(root.fontSize),
        captionRole: parseFloat(root.getPropertyValue('--aino-text-caption')) * parseFloat(root.fontSize),
        prose: parseFloat(getComputedStyle(prose).fontSize),
        lineHeight: parseFloat(getComputedStyle(prose).lineHeight),
        user: parseFloat(getComputedStyle(user).fontSize),
        input: parseFloat(getComputedStyle(input).fontSize),
        footer: parseFloat(getComputedStyle(footer).fontSize)
      }
    })

    await page.screenshot({ path: test.info().outputPath(`reading-${scale}.png`) })
    expect(typography.prose, JSON.stringify(typography)).toBeCloseTo((typography.role * scale) / 100, 1)
    expect(typography.user).toBeCloseTo(typography.prose, 1)
    expect(typography.input).toBeCloseTo(typography.prose, 1)
    expect(typography.lineHeight / typography.prose).toBeCloseTo(1.6, 1)
    expect(typography.footer).toBeCloseTo(typography.captionRole, 1)
  }

  expect(rendererErrors).toEqual([])
})

test('keeps diagnostics keyboard-accessible and reply actions usable in a narrow chat', async () => {
  const { page, app } = fixture
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 800, false))
  const footer = page.locator('[data-slot="aui_assistant-footer"]').last()
  const details = footer.locator('details')
  const summary = details.locator('summary')

  await expect(summary).toBeVisible()
  await expect(summary).not.toContainText(/token|%/)
  await expect(details).not.toHaveAttribute('open')

  // Use real keyboard navigation: focus-follow intentionally redirects script
  // focus inside a chat unless Tab navigation owns the focus change.
  for (let step = 0; step < 60; step++) {
    await page.keyboard.press('Shift+Tab')

    if (await summary.evaluate(element => document.activeElement === element)) {
      break
    }
  }

  await expect(summary).toBeFocused()
  await summary.press('Enter')
  await expect(details).toHaveAttribute('open', '')
  await expect(details).toContainText('token')
  await page.screenshot({ path: test.info().outputPath('reading-details-narrow.png') })
  await summary.press('Enter')
  await expect(details).not.toHaveAttribute('open')

  await footer.hover()
  const copy = footer.getByRole('button', { name: /^(复制|Copy)$/ })
  await expect(copy).toBeVisible()
  await copy.click()
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(REPLY)

  const overflow = await footer.evaluate(element => ({
    client: element.clientWidth,
    scroll: element.scrollWidth
  }))

  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(rendererErrors).toEqual([])
  await page.screenshot({ path: test.info().outputPath('reading-narrow.png') })
})

test('uses one readable control scale across navigation, recent chats and composer selectors', async () => {
  const { page, app } = fixture
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960, false))
  await page.evaluate(() => localStorage.setItem('hermes.desktop.chat-text-scale.v1', '110'))
  await page.reload()
  await waitForAppReady(fixture, 120_000)
  await expect(page.locator('[data-sidebar-session-row]:visible').first()).toBeVisible()

  const sizes = await page.evaluate(() => {
    const size = (selector: string) => {
      const element = [...document.querySelectorAll<HTMLElement>(selector)].find(node => node.offsetHeight > 0)

      if (!element) {
        throw new Error('Missing typography surface: ' + selector)
      }

      return parseFloat(getComputedStyle(element).fontSize)
    }

    return {
      navigation: size('[data-aino-sidebar] [data-sidebar=menu-button]'),
      section: size('[data-tour=sessions-sidebar] [data-sidebar-section-label]'),
      session: size('.aino-sidebar-session-label'),
      timestamp: size('[data-sidebar-session-row] time'),
      project: size('[data-slot=composer-dock] [data-slot=dropdown-menu-trigger] .truncate'),
      model: size('[data-tour=model-pill] .truncate')
    }
  })

  await page.screenshot({ path: test.info().outputPath('global-typography.png') })
  expect(sizes.navigation, JSON.stringify(sizes)).toBe(14)
  expect(sizes.section).toBe(13)
  expect(sizes.session).toBe(sizes.navigation)
  expect(sizes.project).toBe(sizes.navigation)
  expect(sizes.model).toBe(sizes.navigation)
  expect(sizes.timestamp).toBe(12)

  await page.locator('[data-tour=model-pill]').click()
  const modelMenu = page.getByRole('menu')
  await expect(modelMenu).toBeVisible()
  expect(
    await modelMenu
      .getByRole('menuitem', { name: /Mock Model/ })
      .evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  ).toBe(sizes.navigation)
  expect(
    await modelMenu
      .getByRole('menuitem', { name: 'Mock', exact: true })
      .evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  ).toBe(13)
  await page.screenshot({ path: test.info().outputPath('global-typography-model-menu.png') })
  await page.keyboard.press('Escape')
  await expect(modelMenu).toHaveCount(0)

  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  const chatWorkspace = page.locator('[data-slot=summary-workspace]').locator('..')
  await expect(chatWorkspace).toHaveAttribute('inert')
  expect(await chatWorkspace.evaluate(element => element.contains(document.activeElement))).toBe(false)
  await page.getByRole('button', { name: '外观', exact: true }).click()
  const brightness = page.locator('[id="setting-field-appearance.theme"]')
  await expect(brightness.getByRole('button', { name: '暗色', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('global-typography-settings.png') })
  await brightness.getByRole('button', { name: '暗色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-hermes-mode', 'dark')
  await page.screenshot({ path: test.info().outputPath('global-typography-settings-dark.png') })
  await brightness.getByRole('button', { name: '明亮', exact: true }).click()
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await expect(chatWorkspace).not.toHaveAttribute('inert')
  await expect(page.getByRole('heading', { name: '项目检查结果', exact: true })).toBeVisible()
  expect(rendererErrors).toEqual([])
})

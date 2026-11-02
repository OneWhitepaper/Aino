import { mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

const REPLY = [
  '# 项目检查报告',
  '## 项目检查结果',
  '已经检查项目配置和现有组件。普通回复继续使用清晰的中文段落，执行过程与回复内容各有自己的层级。',
  '### 交互检查',
  '关键结论使用**适度强调**，配置名称如 `config.yaml` 保留等宽字体。',
  '#### 检查范围',
  '以下是这次检查的主要结果：',
  '- 项目对话可以正常使用。\n- 工具记录仍可展开查看。\n- 费用明细保留原有入口。',
  '| 检查项目 | 结果 |\n| --- | --- |\n| 会话与项目 | 可继续使用 |\n| 工具与审批 | 保留现有流程 |',
  '```python\nprint("Aino 项目检查完成")\n```',
  '需要核对执行细节时，可以展开回复下方的消耗详情。'
].join('\n\n')

let fixture: MockBackendFixture
let summaryReply = REPLY
const SUMMARY_PROMPT = '摘要布局验收'
const rendererErrors: string[] = []

test.beforeAll(async () => {
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: zh',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true',
    mockServer: {
      replyForPrompt: prompt => (prompt.includes(SUMMARY_PROMPT) ? summaryReply : REPLY),
      streamUsage: { prompt_tokens: 1000, completion_tokens: 256, total_tokens: 1256 }
    }
  })
  const { page } = fixture
  page.on('console', message => {
    // The isolated Electron fixture explicitly passes --disable-gpu; xterm
    // reports its supported DOM-renderer fallback when a terminal first opens.
    const expectedTerminalFallback =
      message.type() === 'warning' &&
      message.text().startsWith('[hermes-terminal] WebGL unavailable; falling back to DOM') &&
      message.text().includes('WebGL2 not supported')

    if (
      ['error', 'warning'].includes(message.type()) &&
      !message.text().includes('Electron Security Warning (Insecure Content-Security-Policy)') &&
      !expectedTerminalFallback
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
    await expect(page.locator('[data-slot="code-card-body"] pre code')).toBeVisible()

    const typography = await page.evaluate(() => {
      const surface = document.querySelector('[data-chat-surface][data-conversation-layout]')!
      const prose = surface.querySelector('[data-slot="aui_assistant-message-content"] .aui-md p')!
      const user = surface.querySelector('.composer-human-message')!
      const input = surface.querySelector('[data-slot="composer-rich-input"]')!
      const footer = surface.querySelector('[data-slot="aui_reply-metrics"]')!
      const root = getComputedStyle(document.documentElement)

      const style = (selector: string) => {
        const element = surface.querySelector(selector)

        if (!element) {
          throw new Error('Missing typography surface: ' + selector)
        }

        const computed = getComputedStyle(element)

        return {
          fontSize: parseFloat(computed.fontSize),
          lineHeight: parseFloat(computed.lineHeight),
          fontWeight: parseFloat(computed.fontWeight)
        }
      }

      return {
        role: parseFloat(root.getPropertyValue('--aino-text-body')) * parseFloat(root.fontSize),
        captionRole: parseFloat(root.getPropertyValue('--aino-text-caption')) * parseFloat(root.fontSize),
        prose: parseFloat(getComputedStyle(prose).fontSize),
        lineHeight: parseFloat(getComputedStyle(prose).lineHeight),
        user: parseFloat(getComputedStyle(user).fontSize),
        input: parseFloat(getComputedStyle(input).fontSize),
        footer: parseFloat(getComputedStyle(footer).fontSize),
        headings: ['h1', 'h2', 'h3', 'h4'].map(tag => style('.aui-md ' + tag)),
        strong: style('.aui-md [data-streamdown="strong"]'),
        inlineCode: style('.aui-md p code'),
        fencedCode: style('[data-slot="code-card-body"] pre code'),
        tableHeader: style('.aui-md-table th'),
        tableBody: style('.aui-md-table td')
      }
    })

    await page.screenshot({ path: test.info().outputPath(`reading-${scale}.png`) })
    expect(typography.role).toBe(14)
    expect(typography.prose, JSON.stringify(typography)).toBeCloseTo((typography.role * scale) / 100, 1)
    expect(typography.user).toBeCloseTo(typography.prose, 1)
    expect(typography.input).toBeCloseTo(typography.prose, 1)
    expect(typography.lineHeight / typography.prose).toBeCloseTo(1.65, 2)
    expect(typography.footer).toBeCloseTo(typography.captionRole, 1)

    for (const [index, baseSize] of [18, 16, 14, 14].entries()) {
      expect(typography.headings[index].fontSize).toBeCloseTo((baseSize * scale) / 100, 1)
      expect(typography.headings[index].fontWeight).toBe(600)
    }

    expect(typography.strong.fontSize).toBeCloseTo(typography.prose, 1)
    expect(typography.strong.fontWeight).toBe(600)
    expect(typography.inlineCode.fontSize).toBeCloseTo(typography.prose * 0.9, 1)
    expect(typography.fencedCode.fontSize).toBeCloseTo((13 * scale) / 100, 1)

    for (const cell of [typography.tableHeader, typography.tableBody]) {
      expect(cell.fontSize).toBeCloseTo(typography.prose, 1)
      expect(cell.lineHeight / cell.fontSize).toBeCloseTo(1.65, 2)
    }
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

test('keeps navigation readable and compact composer selectors at the caption scale', async () => {
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
  expect(sizes.navigation, JSON.stringify(sizes)).toBe(13)
  expect(sizes.section).toBe(12)
  expect(sizes.session).toBe(12)
  expect(sizes.project).toBe(sizes.timestamp)
  expect(sizes.model).toBe(sizes.timestamp)
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
      .getByText('自定义模型', { exact: true })
      .evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  ).toBe(sizes.section)
  await page.screenshot({ path: test.info().outputPath('global-typography-model-menu.png') })
  await page.keyboard.press('Escape')
  await expect(modelMenu).toHaveCount(0)

  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  const chatWorkspace = page.locator('[data-slot=layout-tree-root]').locator('..')
  await expect(chatWorkspace).toHaveAttribute('inert')
  await expect.poll(() => chatWorkspace.evaluate(element => element.contains(document.activeElement))).toBe(false)
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

test('keeps composer controls reachable across their height with short and scrolling drafts', async () => {
  const { page, app } = fixture

  const drafts = [
    '检查输入区的按钮是否可用。',
    Array.from({ length: 35 }, (_, index) => `第 ${index + 1} 行：保留草稿及现有工具。`).join('\n')
  ]

  for (const scene of ['conversation', 'home']) {
    if (scene === 'home') {
      await page.locator('[data-tour="sidebar-nav-new-session"]').click()
      await expect(page.locator('[data-chat-surface][data-home-layout]')).toBeVisible()
    }

    for (const width of [1440, 880]) {
      await app.evaluate(
        ({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setSize(value, 960, false),
        width
      )
      const input = page.locator('[data-slot="composer-rich-input"]:visible')

      for (const draft of drafts) {
        await input.fill(draft)
        // A real browser must prove the editor cannot receive pointer events
        // inside another control; DOM-only tests cannot expose grid overflow.
        await expect
          .poll(
            async () =>
              page.evaluate(() => {
                const composer = [...document.querySelectorAll<HTMLElement>('[data-slot="composer-surface"]')].find(
                  element => element.offsetHeight > 0
                )!

                const editor = composer.querySelector<HTMLElement>('[data-slot="composer-rich-input"]')!

                const rows = [
                  ...composer.querySelectorAll<HTMLElement>(
                    '[data-slot="composer-leading-controls"], [data-slot="composer-trailing-controls"]'
                  )
                ]

                const failures: string[] = []

                const controls = rows
                  .flatMap(row => [...row.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')])
                  .filter(button => button.offsetWidth > 0 && button.offsetHeight > 0)

                if (controls.length < 3) {
                  failures.push('Missing live composer controls')
                }

                if (
                  editor.getBoundingClientRect().bottom >
                  Math.min(...rows.map(row => row.getBoundingClientRect().top)) + 1
                ) {
                  failures.push('Editor overlaps the toolbar')
                }

                for (const button of controls) {
                  const bounds = button.getBoundingClientRect()
                  const label = button.getAttribute('aria-label') || button.textContent || 'button'

                  if (bounds.height < 28) {
                    failures.push(`${label}: insufficient target height`)
                  }

                  for (const ratio of [0.15, 0.5, 0.85]) {
                    const hit = document.elementFromPoint(
                      bounds.left + bounds.width / 2,
                      bounds.top + bounds.height * ratio
                    )

                    if (!hit || !button.contains(hit)) {
                      failures.push(`${label}: blocked at ${ratio}`)
                    }
                  }
                }

                return failures
              }),
            { message: `${scene}, width ${width}, ${draft.split('\n').length} draft lines` }
          )
          .toEqual([])

        const model = page.locator('[data-tour="model-pill"]:visible')
        const bounds = await model.boundingBox()
        await model.click({ position: { x: bounds!.width / 2, y: 5 } })
        await expect(page.getByRole('menu')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(input).toHaveText(draft, { useInnerText: true })
      }

      await page.screenshot({ path: test.info().outputPath(`composer-targets-${scene}-${width}.png`) })
      await input.fill('')
    }
  }

  expect(rendererErrors).toEqual([])
})

test('keeps the summary compact without replacing editable conversation work', async () => {
  test.setTimeout(120_000)
  const { page, app, mock, sandbox } = fixture
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960, false))
  await page.locator('[data-tour="sidebar-nav-new-session"]').click()
  const input = page.locator('[data-slot="composer-rich-input"]:visible')
  const toggle = page.getByRole('button', { name: '会话资源', exact: true })
  const rail = page.locator('[data-slot="summary-rail"]')
  const pane = page.getByRole('complementary', { name: '会话资源', exact: true })
  await expect(page.locator('[data-chat-surface][data-home-layout]')).toBeVisible()
  const homeInput = await input.elementHandle()
  await input.fill('保留未发送的草稿。')
  await toggle.click()
  await expect(pane).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(await input.evaluate((element, original) => element === original, homeInput)).toBe(true)
  await expect.poll(() => rail.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(320, 0)

  const homeGeometry = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[data-slot="summary-rail"]')!
    const card = rail.querySelector<HTMLElement>('[data-slot="summary-card"]')!
    const surface = document.querySelector<HTMLElement>('[data-chat-surface][data-home-layout]')!
    const style = getComputedStyle(card)

    return {
      railWidth: rail.getBoundingClientRect().width,
      cardWidth: card.getBoundingClientRect().width,
      background: getComputedStyle(rail).backgroundColor,
      canvasBackground: getComputedStyle(surface).backgroundColor,
      radius: parseFloat(style.borderRadius),
      shadow: style.boxShadow,
      mainRight: surface.getBoundingClientRect().right,
      railLeft: rail.getBoundingClientRect().left
    }
  })

  expect(homeGeometry.railWidth).toBeCloseTo(320, 0)
  expect(homeGeometry.cardWidth).toBeCloseTo(296, 0)
  expect(homeGeometry.background).toBe(homeGeometry.canvasBackground)
  expect(homeGeometry.radius).toBe(14)
  expect(homeGeometry.shadow).not.toBe('none')
  expect(homeGeometry.mainRight).toBeLessThanOrEqual(homeGeometry.railLeft + 1)
  await page.screenshot({ path: test.info().outputPath('summary-home.png') })
  await input.click()
  await page.keyboard.press('Escape')
  await expect(pane).toBeVisible()
  await toggle.click()
  await expect(rail).toHaveCount(0)
  await expect(input).toHaveText('保留未发送的草稿。')
  expect(await input.evaluate((element, original) => element === original, homeInput)).toBe(true)
  await toggle.click()

  const outputPath = path.join(sandbox.root, 'summary-report.md')
  writeFileSync(outputPath, ['# Summary report', 'Test-owned output.', ''].join(String.fromCharCode(10)))
  summaryReply = [REPLY, '', 'MEDIA:' + outputPath].join(String.fromCharCode(10))
  const sources = Array.from({ length: 6 }, (_, index) => 'https://example.com/summary-source-' + (index + 1))
  await input.fill(
    SUMMARY_PROMPT + '，请阅读这些来源：' + String.fromCharCode(10) + sources.join(String.fromCharCode(10))
  )
  await input.press('Enter')
  await expect(pane.getByRole('button', { name: '打开来源: summary-report.md', exact: true })).toBeVisible({
    timeout: 60_000
  })
  await expect(page.getByRole('button', { name: /^(停止|Stop)$/ })).toHaveCount(0, { timeout: 60_000 })

  const sourceSection = pane.locator('[data-slot="summary-section"]').filter({
    has: page.getByRole('heading', { name: '来源', exact: true })
  })

  await expect(sourceSection.locator('[data-slot="summary-resource-row"]')).toHaveCount(4)
  await sourceSection.getByRole('button', { name: '查看全部（6）', exact: true }).click()
  await expect(sourceSection.locator('[data-slot="summary-resource-row"]')).toHaveCount(6)
  await sourceSection.getByRole('button', { name: '收起', exact: true }).click()
  await expect(sourceSection.locator('[data-slot="summary-resource-row"]')).toHaveCount(4)

  const readingGeometry = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[data-slot="summary-rail"]')!
    const pane = rail.querySelector<HTMLElement>('[data-slot="summary-pane"]')!
    const card = rail.querySelector<HTMLElement>('[data-slot="summary-card"]')!
    const surface = document.querySelector<HTMLElement>('[data-chat-surface][data-conversation-layout]')!
    const row = pane.querySelector<HTMLElement>('[data-slot="summary-resource-row"]')!

    return {
      background: getComputedStyle(rail).backgroundColor,
      canvasBackground: getComputedStyle(surface).backgroundColor,
      rowSize: parseFloat(getComputedStyle(row).fontSize),
      rowWeight: getComputedStyle(row).fontWeight,
      headerSize: parseFloat(getComputedStyle(pane.querySelector('h2')!).fontSize),
      cardClient: card.clientWidth,
      cardScroll: card.scrollWidth
    }
  })

  expect(readingGeometry.background).toBe(readingGeometry.canvasBackground)
  expect(readingGeometry.rowSize).toBe(13)
  expect(readingGeometry.rowWeight).toBe('400')
  expect(readingGeometry.headerSize).toBe(12)
  expect(readingGeometry.cardScroll).toBeLessThanOrEqual(readingGeometry.cardClient + 1)
  const requests = mock.receivedPrompts.length
  await input.fill('继续保留这段未发送内容。')
  await pane.getByRole('button', { name: '创建文件或网页', exact: true }).click()
  await expect(input).toContainText('继续保留这段未发送内容。')
  await expect(input).toContainText('帮我创建文件或网页：')
  await expect(input).toBeFocused()
  expect(mock.receivedPrompts).toHaveLength(requests)
  const draft = await input.innerText()
  await page.screenshot({ path: test.info().outputPath('summary-resources.png') })

  await page.getByRole('button', { name: '打开设置', exact: true }).click()
  await expect(pane).not.toBeVisible()
  await page.getByRole('button', { name: '关闭设置', exact: true }).click()
  await expect(pane).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(input).toHaveText(draft, { useInnerText: true })
  await expect(pane.getByRole('button', { name: '打开来源: summary-report.md', exact: true })).toBeVisible()
  await expect(sourceSection.locator('[data-slot="summary-resource-row"]')).toHaveCount(4)
  const conversationInput = await input.elementHandle()

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 800, false))
  await expect(pane).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const workspace = document.querySelector<HTMLElement>('[data-slot="summary-workspace"]')!
        const main = workspace.querySelector<HTMLElement>('[data-slot="summary-workspace-main"]')!
        const rail = workspace.querySelector<HTMLElement>('[data-slot="summary-rail"]')!
        const card = rail.querySelector<HTMLElement>('[data-slot="summary-card"]')!
        const bounds = workspace.getBoundingClientRect()
        const railBounds = rail.getBoundingClientRect()
        const cardBounds = card.getBoundingClientRect()

        return (
          Math.abs(main.getBoundingClientRect().width - bounds.width) <= 1 &&
          Math.abs(railBounds.top - bounds.top) <= 1 &&
          Math.abs(railBounds.right - bounds.right) <= 1 &&
          railBounds.left >= bounds.left - 1 &&
          railBounds.width <= 320 + 1 &&
          railBounds.height > 0 &&
          Math.abs(cardBounds.width - (railBounds.width - 24)) <= 1 &&
          card.scrollWidth <= card.clientWidth + 1 &&
          cardBounds.bottom <= bounds.bottom + 1
        )
      })
    )
    .toBe(true)
  await expect(input).toHaveText(draft, { useInnerText: true })
  expect(await input.evaluate((element, original) => element === original, conversationInput)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('summary-right-overlay.png') })

  await page.locator('[data-tour="sidebar-nav-new-session"]').click()
  await expect(page.locator('[data-chat-surface][data-home-layout]')).toBeVisible()
  await expect(pane).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(pane.getByRole('heading', { name: '来源', exact: true })).toHaveCount(0)
  await expect(pane.getByRole('button', { name: '创建文件或网页', exact: true })).toBeVisible()
  expect(mock.receivedPrompts).toHaveLength(requests)
  await toggle.click()
  await expect(rail).toHaveCount(0)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(rendererErrors).toEqual([])
})

test('keeps the summary owned by the chat when files and their preview are open', async () => {
  test.setTimeout(120_000)
  const { app, page, sandbox, mock } = fixture
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(2000, 1000, false))
  const folder = path.join(sandbox.root, 'SummaryWorkspace')
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    path.join(folder, 'summary-layout.md'),
    ['# Independent file preview', '', 'The summary belongs to the conversation.', ''].join(String.fromCharCode(10))
  )
  await app.evaluate(({ dialog }, selectedFolder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFolder] })
  }, folder)
  await page.getByRole('button', { name: '打开文件夹为项目…', exact: true }).click()
  await expect(
    page.locator('[data-chat-surface]:visible').getByRole('button', { name: 'SummaryWorkspace', exact: true })
  ).toBeVisible({ timeout: 30_000 })
  const showFiles = page.getByRole('button', { name: '显示右侧栏', exact: true })

  if (await showFiles.isVisible()) {
    await showFiles.click()
  }

  await page.locator('[data-tool-chooser]:visible').getByRole('button', { name: '文件', exact: true }).click()

  const tree = page.locator('[data-project-tree]:visible')
  const file = tree.getByText('summary-layout.md', { exact: true })
  await expect(file).toBeVisible()
  const input = page.locator('[data-slot="composer-rich-input"]:visible')
  summaryReply = [REPLY, '', 'MEDIA:' + path.join(folder, 'summary-layout.md')].join(String.fromCharCode(10))
  const sources = Array.from({ length: 12 }, (_, index) => 'https://example.com/chat-owned-summary-' + (index + 1))
  await input.fill(
    SUMMARY_PROMPT + '，文件与摘要分别显示。来源：' + String.fromCharCode(10) + sources.join(String.fromCharCode(10))
  )
  await input.press('Enter')
  await expect(page.getByRole('heading', { name: '项目检查结果', exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /^(停止|Stop)$/ })).toHaveCount(0, { timeout: 60_000 })
  const editor = await input.elementHandle()
  const requests = mock.receivedPrompts.length
  await input.fill('文件与摘要分别查看，这段草稿继续保留。')
  const toggle = page.getByRole('button', { name: '会话资源', exact: true })

  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click()
  }

  const rail = page.locator('[data-slot="summary-rail"]:visible')

  const readSummaryGeometry = () =>
    rail.evaluate(element => {
      const workspace = element.closest<HTMLElement>('[data-slot="summary-workspace"]')!
      const main = workspace.querySelector<HTMLElement>('[data-slot="summary-workspace-main"]')!
      const card = element.querySelector<HTMLElement>('[data-slot="summary-card"]')!
      const input = main.querySelector<HTMLElement>('[data-slot="composer-rich-input"]')!
      const files = document.querySelector<HTMLElement>('[data-tool-panel]')!

      return {
        viewport: { width: innerWidth, height: innerHeight },
        workspace: workspace.getBoundingClientRect().toJSON(),
        main: main.getBoundingClientRect().toJSON(),
        rail: element.getBoundingClientRect().toJSON(),
        card: card.getBoundingClientRect().toJSON(),
        input: input.getBoundingClientRect().toJSON(),
        composer: input.closest('[data-slot="composer-dock"]')!.getBoundingClientRect().toJSON(),
        tool: files.getBoundingClientRect().toJSON(),
        cardOverflowY: getComputedStyle(card).overflowY,
        cardScrollHeight: card.scrollHeight,
        cardClientHeight: card.clientHeight,
        cardScrollWidth: card.scrollWidth,
        cardClientWidth: card.clientWidth,
        chatOwned: element.closest('[data-tree-group]') === main.closest('[data-tree-group]'),
        toolOwned: Boolean(element.closest('[data-tool-panel]'))
      }
    })

  const assertRightSummary = async (mode: 'reserved' | 'overlay') => {
    const geometry = await readSummaryGeometry()
    writeFileSync(test.info().outputPath('summary-files-' + mode + '-geometry.json'), JSON.stringify(geometry, null, 2))
    await page.screenshot({ path: test.info().outputPath('summary-files-' + mode + '.png') })
    expect(geometry.chatOwned).toBe(true)
    expect(geometry.toolOwned).toBe(false)
    expect(geometry.rail.top, 'Summary must begin at the chat top, never below the composer').toBeCloseTo(
      geometry.workspace.top,
      0
    )
    expect(geometry.rail.right).toBeCloseTo(geometry.workspace.right, 0)
    expect(geometry.rail.left).toBeGreaterThanOrEqual(geometry.workspace.left - 1)
    expect(geometry.rail.right).toBeLessThanOrEqual(geometry.tool.left + 1)
    expect(geometry.rail.bottom).toBeLessThanOrEqual(geometry.workspace.bottom + 1)
    expect(geometry.rail.width).toBeGreaterThan(200)
    expect(geometry.rail.width).toBeLessThanOrEqual(321)
    expect(geometry.card.top).toBeLessThan(geometry.input.top)
    expect(geometry.card.top).toBeGreaterThanOrEqual(geometry.workspace.top)
    expect(geometry.card.right).toBeLessThanOrEqual(geometry.workspace.right)
    expect(geometry.card.bottom).toBeLessThanOrEqual(geometry.workspace.bottom)
    expect(geometry.cardScrollWidth).toBeLessThanOrEqual(geometry.cardClientWidth + 1)

    if (mode === 'reserved') {
      expect(geometry.workspace.width).toBeGreaterThanOrEqual(960)
      expect(geometry.main.right).toBeLessThanOrEqual(geometry.rail.left + 1)
    } else {
      expect(geometry.viewport.width).toBeGreaterThan(640)
      expect(geometry.workspace.width).toBeLessThan(960)
      expect(geometry.main.width).toBeCloseTo(geometry.workspace.width, 0)
      expect(geometry.main.height).toBeCloseTo(geometry.workspace.height, 0)
      expect(geometry.card.bottom, 'Long Summary must leave the composer unobstructed').toBeLessThanOrEqual(
        geometry.composer.top
      )
    }

    await expect(input).toHaveText('文件与摘要分别查看，这段草稿继续保留。')
    expect(await input.evaluate((element, original) => element === original, editor)).toBe(true)
    expect(mock.receivedPrompts).toHaveLength(requests)
    expect(rendererErrors).toEqual([])

    return geometry
  }

  await expect(rail).toBeVisible()
  await assertRightSummary('reserved')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const surface = [...document.querySelectorAll<HTMLElement>('[data-chat-surface]')].find(
          candidate => candidate.offsetHeight > 0 && !candidate.closest('[data-pane-hidden]')
        )!

        const chat = surface.closest('[data-tree-group]')
        const rail = document.querySelector<HTMLElement>('[data-slot="summary-rail"]')!
        const files = document.querySelector<HTMLElement>('[data-project-tree]')!.closest('[data-tree-group]')
        const workspace = rail.closest('[data-slot="summary-workspace"]')

        return Boolean(
          chat && files && chat !== files && rail.closest('[data-tree-group]') === chat && workspace?.contains(surface)
        )
      })
    )
    .toBe(true)
  await expect
    .poll(() =>
      rail.evaluate(element => {
        const files = document.querySelector<HTMLElement>('[data-project-tree]')!.closest('[data-tree-group]')!
        const bounds = element.getBoundingClientRect()

        return bounds.width > 0 && bounds.right <= files.getBoundingClientRect().left + 1
      })
    )
    .toBe(true)
  expect(await input.evaluate((element, original) => element === original, editor)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('summary-chat-with-files.png') })
  await file.dblclick()
  await expect(page.getByRole('heading', { name: 'Independent file preview', exact: true })).toBeVisible()
  await expect(rail).toBeVisible()
  expect(
    await rail.evaluate(element => {
      const surface = [...document.querySelectorAll<HTMLElement>('[data-chat-surface]')].find(
        candidate => candidate.offsetHeight > 0 && !candidate.closest('[data-pane-hidden]')
      )!

      const heading = [...document.querySelectorAll<HTMLElement>('h1')].find(
        candidate => candidate.textContent === 'Independent file preview'
      )!

      return (
        element.closest('[data-tree-group]') === surface.closest('[data-tree-group]') &&
        element.closest('[data-tree-group]') !== heading.closest('[data-tree-group]')
      )
    })
  ).toBe(true)
  await expect(input).toHaveText('文件与摘要分别查看，这段草稿继续保留。')
  // File previews share the tool group; Summary toggles keep the chat editor mounted.
  const previewEditor = await input.elementHandle()
  await page.screenshot({ path: test.info().outputPath('summary-chat-with-file-preview.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 640, false))
  await expect.poll(async () => (await readSummaryGeometry()).workspace.width).toBeLessThan(960)
  await assertRightSummary('overlay')
  const pane = rail.getByRole('complementary', { name: '会话资源', exact: true })

  const sourcesSection = pane.locator('[data-slot="summary-section"]').filter({
    has: page.getByRole('heading', { name: '来源', exact: true })
  })

  await sourcesSection.getByRole('button', { name: '查看全部（12）', exact: true }).click()
  const card = rail.locator('[data-slot="summary-card"]')
  await expect.poll(() => card.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
  await card.hover()
  await page.mouse.wheel(0, 1200)
  await expect.poll(() => card.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

  const finalSource = pane.getByRole('button', {
    name: '打开来源: https://example.com/chat-owned-summary-12',
    exact: true
  })

  await expect(finalSource).toBeVisible()
  await expect
    .poll(() =>
      finalSource.evaluate(element => {
        const row = element.getBoundingClientRect()
        const card = element.closest('[data-slot="summary-card"]')!.getBoundingClientRect()

        return Math.max(0, Math.min(row.bottom, card.bottom, innerHeight) - Math.max(row.top, card.top, 0))
      })
    )
    .toBeGreaterThan(0)
  const overlayOpen = await readSummaryGeometry()
  writeFileSync(test.info().outputPath('summary-right-overlay-scroll.json'), JSON.stringify(overlayOpen, null, 2))
  await page.screenshot({ path: test.info().outputPath('summary-right-overlay-scrolled.png') })
  await toggle.click()
  await expect(rail).toHaveCount(0)

  const closedMain = await input.evaluate(element =>
    element.closest('[data-slot="summary-workspace-main"]')!.getBoundingClientRect().toJSON()
  )

  expect(closedMain).toEqual(overlayOpen.main)
  expect(await input.boundingBox()).toMatchObject({
    x: overlayOpen.input.x,
    y: overlayOpen.input.y,
    width: overlayOpen.input.width,
    height: overlayOpen.input.height
  })
  await expect(input).toHaveText('文件与摘要分别查看，这段草稿继续保留。')
  expect(await input.evaluate((element, original) => element === original, previewEditor)).toBe(true)
  await toggle.click()
  await expect(rail).toHaveCount(1)
  await assertRightSummary('overlay')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(2000, 1000, false))
  await expect.poll(async () => (await readSummaryGeometry()).workspace.width).toBeGreaterThanOrEqual(960)
  await assertRightSummary('reserved')
  await toggle.click()
  await expect(rail).toHaveCount(0)
  await toggle.click()
  await expect(rail).toHaveCount(1)
  await expect
    .poll(() =>
      rail.evaluate(element => {
        const bounds = element.getBoundingClientRect()

        return bounds.width > 0 && bounds.height > 0
      })
    )
    .toBe(true)
  await expect(rail).toBeVisible()
  await page.getByRole('button', { name: '隐藏右侧栏', exact: true }).click()
  await expect(tree).not.toBeVisible()
  await expect(rail).toBeVisible()
  await expect(input).toHaveText('文件与摘要分别查看，这段草稿继续保留。')
  expect(await input.evaluate((element, original) => element === original, previewEditor)).toBe(true)
  expect(mock.receivedPrompts).toHaveLength(requests)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(rendererErrors).toEqual([])
})

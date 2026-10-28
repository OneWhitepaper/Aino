import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

const BOT_REPLY = '这是 Agent Hub 的独立会话，普通聊天不应出现在这里。'
const SESSION_REPLY = '这是普通会话的独立回复。'
let fixture: MockBackendFixture

const reply = (text: string) =>
  fixture.page.locator('[data-slot=aui_assistant-message-content]:visible').getByText(text, { exact: true })

test.beforeAll(async () => {
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: zh',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true',
    mockServer: { replyForPrompt: prompt => (prompt.includes('普通会话的消息') ? SESSION_REPLY : BOT_REPLY) }
  })

  const { page } = fixture
  const agreement = page.getByRole('checkbox', { name: '同意用户协议和隐私政策', exact: true })

  await expect(agreement).toBeVisible({ timeout: 60_000 })
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800000106')
  await agreement.check()
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('1234')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
})

test('switches the main transcript with Agent Hub and restores the ordinary chat and its draft', async () => {
  const { page } = fixture
  const input = page.locator('[data-slot=composer-rich-input]:visible')

  await input.fill('普通会话的消息')
  await input.press('Enter')
  await expect(reply(SESSION_REPLY)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0)
  const sessionUrl = page.url()
  const draft = '保留在普通会话中的未发送草稿'

  await input.fill(draft)
  await page.getByRole('tab', { name: /^Agent Hub$/i }).click()
  await expect(page.getByRole('button', { name: /@hermes/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Aino', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(page).toHaveURL(sessionUrl)
  await expect(reply(SESSION_REPLY)).not.toBeVisible()
  await expect(input).not.toHaveText(draft)
  await page.screenshot({ path: test.info().outputPath('agent-hub-first-open.png') })

  await input.fill('机器人的消息')
  await input.press('Enter')
  await expect(reply(BOT_REPLY)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('agent-hub-chat.png') })

  await page.getByRole('tab', { name: '会话', exact: true }).click()
  await expect(page).toHaveURL(sessionUrl)
  await expect(reply(SESSION_REPLY)).toBeVisible()
  await expect(reply(BOT_REPLY)).not.toBeVisible()
  await expect(input).toHaveText(draft)
  await page.screenshot({ path: test.info().outputPath('ordinary-chat-restored.png') })

  await page.getByRole('tab', { name: /^Agent Hub$/i }).click()
  await expect(reply(BOT_REPLY)).toBeVisible()
  await expect(reply(SESSION_REPLY)).not.toBeVisible()
})

test('persists the default bot name and description after reopening and reloading', async () => {
  const { page } = fixture
  const description = 'Aino 是你的默认 AI 助手，帮助你整理资料、撰写内容和推进项目。'

  const openEditor = async () => {
    await page.getByRole('button', { name: /@hermes/ }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: '编辑…', exact: true }).click()

    return page.getByRole('dialog', { name: '编辑机器人', exact: true })
  }

  await page.getByRole('tab', { name: /^Agent Hub$/i }).click()
  let editor = await openEditor()

  await editor.getByRole('textbox').first().fill('Aino 验收助手')
  await editor.getByPlaceholder('这个机器人应该帮你做什么？').fill(description)
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await expect(page.getByRole('button', { name: /^Aino 验收助手 · @hermes/ })).toBeVisible()
  editor = await openEditor()
  await expect(editor.getByRole('textbox').first()).toHaveValue('Aino 验收助手')
  await expect(editor.getByPlaceholder('这个机器人应该帮你做什么？')).toHaveValue(description)
  await editor.getByPlaceholder('这个机器人应该帮你做什么？').fill('')
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor).not.toBeVisible()
  editor = await openEditor()
  await expect(editor.getByPlaceholder('这个机器人应该帮你做什么？')).toHaveValue('')

  await editor.getByRole('textbox').first().fill('Aino')
  await editor.getByPlaceholder('这个机器人应该帮你做什么？').fill(description)
  await editor.getByRole('button', { name: '保存', exact: true }).click()
  await expect(editor).not.toBeVisible()
  await page.reload()
  await waitForAppReady(fixture, 120_000)
  await page.getByRole('tab', { name: /^Agent Hub$/i }).click()
  await expect(page.getByRole('button', { name: /^Aino · @hermes/ })).toBeVisible()
  editor = await openEditor()
  await expect(editor.getByRole('textbox').first()).toHaveValue('Aino')
  await expect(editor.getByPlaceholder('这个机器人应该帮你做什么？')).toHaveValue(description)
  await page.screenshot({ path: test.info().outputPath('aino-bot-profile.png') })
  await editor.getByRole('button', { name: '取消', exact: true }).click()
})

test('shows a Chinese bot name in workspace navigation and keeps its ID in advanced details', async () => {
  const { page } = fixture
  const internalId = 'u90ae-u4ef6-u52a9-u624b'

  await page.getByRole('tab', { name: /^Agent Hub$/i }).click()
  await page.getByRole('button', { name: '新建机器人或群聊', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建机器人', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建机器人', exact: true })

  await create.getByPlaceholder('起个不重复的名字，用来区分不同机器人').fill('邮件助手')
  await create.getByRole('button', { name: '创建机器人', exact: true }).click()
  await expect(create).not.toBeVisible({ timeout: 30_000 })
  const bot = page.getByRole('button', { name: /^邮件助手 · @/ })

  await expect(bot).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: '停止', exact: true })).toHaveCount(0, { timeout: 60_000 })
  await bot.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '编辑…', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑机器人', exact: true })

  await expect(editor.locator('[data-slot=dialog-description]')).toContainText('邮件助手')
  await expect(editor).not.toContainText(internalId)
  await editor.getByRole('button', { name: /^高级/ }).click()
  await expect(editor.getByText(internalId, { exact: true })).toBeVisible()
  await editor.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('tab', { name: '会话', exact: true }).click()
  await page.getByRole('button', { name: '工作区', exact: true }).click()
  const workspaces = page.getByRole('region', { name: '工作区', exact: true })
  const mailCard = workspaces.locator(`[data-panel-row="${internalId}"] [data-slot=row-button]`)
  const ainoCard = workspaces.locator('[data-panel-row=default] [data-slot=row-button]')

  await page.setViewportSize({ width: 1600, height: 1000 })
  await mailCard.click()
  await expect(workspaces.getByRole('heading', { name: '邮件助手', exact: true })).toBeVisible()
  await expect(mailCard).toHaveAttribute('aria-current', 'true')

  await ainoCard.click()
  await expect(ainoCard).not.toHaveAttribute('aria-current')
  await expect(mailCard).toHaveAttribute('aria-current', 'true')
  await workspaces.getByRole('button', { name: '切换到 Aino', exact: true }).click()
  await expect(workspaces).not.toBeVisible()
  await page.getByRole('button', { name: '工作区', exact: true }).click()
  await expect(ainoCard).toHaveAttribute('aria-current', 'true')

  await mailCard.click()
  await expect(mailCard).not.toHaveAttribute('aria-current')
  await expect(ainoCard).toHaveAttribute('aria-current', 'true')
  await expect(workspaces.getByRole('button', { name: '切换到 邮件助手', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('workspace-preview-before-switch.png') })
  await workspaces.getByRole('button', { name: '切换到 邮件助手', exact: true }).click()
  await expect(workspaces).not.toBeVisible()
  await page.getByRole('button', { name: '工作区', exact: true }).click()
  await expect(mailCard).toHaveAttribute('aria-current', 'true')

  await workspaces.getByPlaceholder('搜索工作区…').fill('邮件')
  await expect(workspaces.getByRole('button', { name: '邮件助手', exact: true }).first()).toBeVisible()
  await expect(workspaces.getByRole('button', { name: 'Aino', exact: true })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('workspace-friendly-name.png') })
  await page.setViewportSize({ width: 900, height: 1000 })
  await expect(workspaces.getByRole('heading', { name: '邮件助手', exact: true })).toBeVisible()
  await expect
    .poll(async () => {
      const controls = await workspaces.locator('[data-workspace-profile-controls]').boundingBox()
      const inspector = await workspaces.getByRole('complementary', { name: '邮件助手', exact: true }).boundingBox()

      return Boolean(controls && inspector && inspector.y >= controls.y + controls.height)
    })
    .toBe(true)
  await page.screenshot({ path: test.info().outputPath('workspace-narrow.png') })
  await workspaces.getByRole('button', { name: '保存 SOUL.md', exact: true }).scrollIntoViewIfNeeded()
  await expect(workspaces.getByRole('button', { name: '保存 SOUL.md', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('workspace-narrow-inspector.png') })
})

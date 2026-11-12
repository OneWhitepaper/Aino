/** Real delegate_task lifecycle over an isolated native gateway and a local inference fixture. */
import fs from 'node:fs'

import { restartMockServer } from '../../../tests-js/scripts/mock-server'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture | null = null
const goal = 'Summarize the test results'
const heldChildContext = 'This is a test subagent for the sidebar states E2E test.'

async function placementMetrics(page: MockBackendFixture['page']) {
  return page.evaluate(() => {
    const rect = (element: Element | null) => element?.getBoundingClientRect().toJSON()
    const center = document.querySelector('[data-titlebar-slot="titleBar.center"]')
    const trigger = document.querySelector('.cc-trigger')!
    const header = trigger.getBoundingClientRect()
    const style = getComputedStyle(document.documentElement)

    const collisions = [...document.querySelectorAll('[data-titlebar-cluster="right"] button')].flatMap(element => {
      const other = element.getBoundingClientRect()

      return other.width &&
        header.left < other.right &&
        header.right > other.left &&
        header.top < other.bottom &&
        header.bottom > other.top
        ? [{ text: element.getAttribute('aria-label'), rect: other.toJSON() }]
        : []
    })

    return {
      viewport: [innerWidth, innerHeight],
      workspace: [style.getPropertyValue('--workspace-left'), style.getPropertyValue('--workspace-right')],
      slot: {
        rect: rect(center),
        display: center && getComputedStyle(center).display,
        children: [...(center?.children ?? [])].map(element => ({
          rect: rect(element),
          html: element.outerHTML.slice(0, 500)
        }))
      },
      anchor: rect(document.querySelector('.collaboration-capsule-anchor')),
      content: rect(document.querySelector('[data-titlebar-content]')),
      titlebar: rect(document.querySelector('[data-slot="app-titlebar"]')),
      trigger: header.toJSON(),
      collisions
    }
  })
}

async function launch(extraConfig = '') {
  restartMockServer()
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: zh',
    extraConfig: `desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true\n${extraConfig}`,
    mockServer: { holdFirstCompletionContaining: heldChildContext }
  })
  const { page, app } = fixture
  page.on('pageerror', error => console.error(`[capsule renderer] ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') {
      console.error(`[capsule console] ${message.text()}`)
    }
  })
  await page.getByRole('textbox', { name: '手机号', exact: true }).waitFor({ state: 'visible', timeout: 120_000 })
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800000101')
  await page.getByRole('checkbox', { name: '同意用户协议和隐私政策', exact: true }).check()
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('1234')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960))
  await page.emulateMedia({ reducedMotion: 'reduce' })

  return fixture
}

test.afterEach(async () => {
  fixture?.mock.releaseHeldStream()
  await fixture?.cleanup()
  fixture = null
})

test('real delegated work follows its original conversation and preserves another draft', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron uses Chromium.')
  test.slow()
  const { page, app, mock } = await launch()
  const capsule = page.locator('.collaboration-capsule')
  const trigger = capsule.locator('.cc-trigger')
  const editor = page.locator('[data-slot="composer-rich-input"]:visible')
  await expect(capsule).toHaveCount(0)
  await editor.fill('E2E_SIDEBAR_TRIGGER')
  await editor.press('Enter')
  await expect.poll(() => mock.heldCompletionCount(), { timeout: 90_000 }).toBe(1)
  await expect(trigger).toBeVisible({ timeout: 30_000 })
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(trigger).toContainText('协作中')
  const collapsed = await capsule.boundingBox()
  expect(collapsed!.width).toBe(286)
  expect(collapsed!.height).toBe(42)
  expect(collapsed!.y).toBe(15)

  const centerDelta = () =>
    trigger.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(document.documentElement)
      const left = parseFloat(style.getPropertyValue('--workspace-left')) || 0
      const right = parseFloat(style.getPropertyValue('--workspace-right')) || 0

      return Math.abs(rect.left + rect.width / 2 - (left + innerWidth - right) / 2)
    })

  try {
    await expect.poll(centerDelta).toBeLessThan(1)
  } finally {
    const path = testInfo.outputPath('capsule-placement-1440.json')
    fs.writeFileSync(path, JSON.stringify(await placementMetrics(page), null, 2))
    await testInfo.attach('capsule-placement-1440', {
      path,
      contentType: 'application/json'
    })
  }

  await page.screenshot({ path: testInfo.outputPath('capsule-collapsed.png'), scale: 'css' })
  await trigger.click()
  await expect(capsule.getByRole('region', { name: '协作', exact: true })).toBeVisible()

  const geometry = await capsule.evaluate(element => {
    const style = getComputedStyle(element)
    const trigger = element.querySelector('.cc-trigger')!
    const panel = element.querySelector('.cc-panel')!
    const outer = element.getBoundingClientRect()
    const inner = panel.getBoundingClientRect()

    return {
      width: outer.width,
      header: trigger.getBoundingClientRect().height,
      radius: parseFloat(style.borderRadius),
      leftRim: inner.left - outer.left,
      rightRim: outer.right - inner.right,
      bottomRim: outer.bottom - inner.bottom
    }
  })

  expect(geometry).toEqual({ width: 436, header: 54, radius: 22, leftRim: 4, rightRim: 4, bottomRim: 4 })
  await expect(capsule.locator('.cc-source-link')).toContainText('E2E_SIDEBAR_TRIGGER')
  await page.screenshot({ path: testInfo.outputPath('capsule-expanded-overview.png'), scale: 'css' })
  const task = capsule.locator('[data-collaboration-task]').filter({ hasText: goal })
  await expect(task).toHaveCount(1)
  await task.locator('.cc-task-button').click()
  await expect(task.locator('.cc-task-goal')).toHaveText(goal)
  await expect(task.getByRole('button', { name: '停止此任务', exact: true })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('capsule-expanded-light.png'), scale: 'css' })
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.screenshot({ path: testInfo.outputPath('capsule-expanded-dark.png'), scale: 'css' })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  const panelToggle = page.locator('[data-tour="right-pane-toggle"]')

  if (await panelToggle.isVisible()) {
    await panelToggle.click()
    await expect.poll(centerDelta).toBeLessThan(1)
    await page.screenshot({ path: testInfo.outputPath('capsule-right-panel.png'), scale: 'css' })
    await panelToggle.click()
  }

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 800))
  await expect.poll(async () => (await placementMetrics(page)).collisions).toEqual([])
  const mediumPath = testInfo.outputPath('capsule-placement-1100.json')
  fs.writeFileSync(mediumPath, JSON.stringify(await placementMetrics(page), null, 2))
  await page.screenshot({ path: testInfo.outputPath('capsule-expanded-1100.png'), scale: 'css' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 720))
  await expect(capsule).toBeInViewport()

  const fits = await capsule.evaluate(element => {
    const rect = element.getBoundingClientRect()

    return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight
  })

  expect(fits).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('capsule-expanded-narrow.png'), scale: 'css' })
  const narrow = await placementMetrics(page)
  const narrowPath = testInfo.outputPath('capsule-placement-760.json')
  fs.writeFileSync(narrowPath, JSON.stringify(narrow, null, 2))
  await testInfo.attach('capsule-placement-760', {
    path: narrowPath,
    contentType: 'application/json'
  })
  expect(narrow.collisions).toEqual([])
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960))

  await page.locator('[data-tour="sidebar-nav-new-session"]').click()
  const draft = '保留在新会话中的未发送草稿'
  await editor.fill(draft)
  const draftTarget = await page.locator('[data-chat-surface]:visible').getAttribute('data-composer-target')
  await expect(trigger).toContainText('协作中')
  await trigger.click()
  await expect(capsule.locator('.cc-source-badge')).toHaveText('普通会话')
  await capsule.locator('.cc-source-link').click()
  const source = page.locator('[data-chat-surface]:visible').filter({ hasText: 'E2E_SIDEBAR_TRIGGER' })
  await expect(source).toHaveCount(1)
  await expect(source.getByText('E2E_SIDEBAR_TRIGGER', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(
    page.locator(`[data-chat-surface][data-composer-target="${draftTarget}"] [data-slot="composer-rich-input"]`)
  ).toHaveText(draft)
  await expect(capsule.locator('.cc-source-badge')).toHaveText('当前会话')
  await page.screenshot({ path: testInfo.outputPath('capsule-returned-to-source.png'), scale: 'css' })
  mock.releaseHeldStream()
  await expect(task.locator('.cc-task-right')).toHaveAttribute('data-state', 'completed', { timeout: 60_000 })
  await expect(trigger).toContainText('协作已完成')
  await page.screenshot({ path: testInfo.outputPath('capsule-completed.png'), scale: 'css' })
  await trigger.focus()
  await page.keyboard.press('Escape')
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(capsule).toHaveCount(0, { timeout: 10_000 })
})

test('Bot work stays discoverable from ordinary chat and stops the exact real child', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron uses Chromium.')
  test.slow()
  const { page, mock } = await launch()
  const editor = page.locator('[data-slot="composer-rich-input"]:visible')
  const draft = '普通会话草稿不应被机器人导航覆盖'
  await editor.fill(draft)
  const ordinaryTarget = await page.locator('[data-chat-surface]:visible').getAttribute('data-composer-target')
  await page.locator('[data-sidebar-mode-header] button').click()
  await page.getByRole('menuitemradio', { name: /^Bot(?:\s|$)/ }).click()
  await expect(page.getByRole('button', { name: /@hermes/ }).first()).toBeVisible({ timeout: 30_000 })
  await editor.fill('E2E_SIDEBAR_TRIGGER')
  await editor.press('Enter')
  await expect.poll(() => mock.heldCompletionCount(), { timeout: 90_000 }).toBe(1)
  const sourceAnchor = await page.locator('[data-chat-surface]:visible').getAttribute('data-session-anchor')
  const capsule = page.locator('.collaboration-capsule')
  const trigger = capsule.locator('.cc-trigger')
  await expect(trigger).toBeVisible()
  await page.locator('[data-sidebar-mode-header] button').click()
  await page.getByRole('menuitemradio', { name: /^Aino(?:\s|$)/ }).click()
  await expect(editor).toHaveText(draft)
  await trigger.click()
  await expect(capsule.locator('.cc-source-badge')).toHaveText('Bot 会话')
  await page.screenshot({ path: testInfo.outputPath('capsule-background-bot.png'), scale: 'css' })
  await capsule.locator('.cc-source-link').click()
  await expect(page.locator('[data-chat-surface]:visible')).toHaveAttribute('data-session-anchor', sourceAnchor!)
  await expect(page.locator('[data-sidebar-mode-header]')).toContainText('Bot')
  const task = capsule.locator('[data-collaboration-task]').filter({ hasText: goal })
  await task.locator('.cc-task-button').click()
  await task.getByRole('button', { name: '停止此任务', exact: true }).click()
  mock.releaseHeldStream()
  await expect(task.locator('.cc-task-right')).toHaveAttribute('data-state', 'interrupted', { timeout: 60_000 })
  await expect(trigger).toContainText('协作已停止')
  await expect(
    page.locator(`[data-chat-surface][data-composer-target="${ordinaryTarget}"] [data-slot="composer-rich-input"]`)
  ).toHaveText(draft)
  await page.screenshot({ path: testInfo.outputPath('capsule-bot-stopped.png'), scale: 'css' })
})

test('group delegation names its room and returns there without exposing an internal member chat', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'Electron uses Chromium.')
  test.setTimeout(360_000)
  const { page, mock } = await launch('gateway:\n  multiplex_profiles: true')
  const ordinaryDraft = '群聊协作期间保留的普通会话草稿'
  await page.locator('[data-slot="composer-rich-input"]:visible').fill(ordinaryDraft)
  await page.locator('[data-sidebar-mode-header] button').click()
  await page.getByRole('menuitemradio', { name: /^Bot(?:\s|$)/ }).click()
  await page.getByRole('button', { name: '新建机器人或群聊', exact: true }).click()
  await page.getByRole('menuitem', { name: /新建机器人/ }).click()
  const bot = page.getByRole('dialog', { name: '新建机器人', exact: true })
  await bot.getByPlaceholder('起个不重复的名字，用来区分不同机器人').fill('capsule-reviewer')
  await bot.getByPlaceholder('界面上显示的称呼，不填就用上面的名字').fill('Capsule Reviewer')
  await bot.getByRole('button', { name: '创建机器人', exact: true }).click()
  await expect(bot).toBeHidden({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: /Capsule Reviewer/ }).first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '新建机器人或群聊', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建群聊', exact: true }).click()
  const create = page.getByRole('dialog', { name: '新建群聊', exact: true })
  const choices = create.locator('.aino-group-create-member')
  await expect(choices).toHaveCount(2)

  for (const choice of await choices.all()) {
    await choice.getByRole('checkbox').click()
  }

  const roomName = '协作验收小组'
  await create.getByRole('textbox', { name: '群组名称', exact: true }).fill(roomName)
  await create.getByRole('button', { name: '新建群聊 (2)', exact: true }).click()
  await expect(create).toBeHidden({ timeout: 30_000 })
  const roomComposer = page.getByRole('textbox', { name: '群组消息', exact: true }).filter({ visible: true })
  await expect(roomComposer).toBeEnabled({ timeout: 30_000 })
  // Expire the creation-time discovery window: this send must re-open it on a genuinely idle room.
  await page.waitForTimeout(11_000)
  const groupGoal = 'Review the delegated room work'
  await roomComposer.fill(
    `@hermes E2E_CALL(delegate_task)[${JSON.stringify({ goal: groupGoal, context: heldChildContext })}]`
  )
  await roomComposer.press('Enter')
  await expect.poll(() => mock.heldCompletionCount(), { timeout: 90_000 }).toBe(1)
  const capsule = page.locator('.collaboration-capsule')
  const trigger = capsule.locator('.cc-trigger')
  // The existing active-room status drives a targeted two-second roster hydration.
  await expect(trigger).toBeVisible({ timeout: 8_000 })
  await trigger.click()
  await expect(capsule.locator('.cc-source-link')).toHaveText(roomName)
  await expect(capsule.locator('.cc-source-badge')).toHaveText('群聊')
  const task = capsule.locator('[data-collaboration-task]').filter({ hasText: groupGoal })
  await expect(task).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath('capsule-group-running.png'), scale: 'css' })
  const groupDraft = '群聊尚未发送的补充说明'
  await roomComposer.fill(groupDraft)
  await page.locator('[data-sidebar-mode-header] button').click()
  await page.getByRole('menuitemradio', { name: /^Aino(?:\s|$)/ }).click()
  await expect(page.locator('[data-slot="composer-rich-input"]:visible')).toHaveText(ordinaryDraft)
  await trigger.click()
  await capsule.locator('.cc-source-link').click()
  await expect(page.locator('[data-sidebar-mode-header]')).toContainText('Bot')
  await expect(roomComposer).toBeVisible({ timeout: 30_000 })
  await expect(roomComposer).toHaveValue(groupDraft)
  await expect(page.locator('[role="tab"]').filter({ hasText: /^Group: / })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('capsule-returned-to-group.png'), scale: 'css' })
  mock.releaseHeldStream()
  await expect
    .poll(() => mock.receivedPrompts.some(text => text.includes('ASYNC DELEGATION BATCH COMPLETE')), {
      timeout: 60_000
    })
    .toBe(true)
  // Group snapshots are read-only. Clearing the task proves settlement without inventing a terminal
  // event; a panel the user left open stays available until they collapse it.
  await expect(task).toHaveCount(0, { timeout: 30_000 })
  await page.screenshot({ path: testInfo.outputPath('capsule-group-settled.png'), scale: 'css' })
  await trigger.focus()
  await page.keyboard.press('Escape')
  await expect(capsule).toHaveCount(0, { timeout: 30_000 })
})

import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Child inspection uses the shared tool tab without replacing the parent conversation. */
import { restartMockServer } from '../../../tests-js/scripts/mock-server'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture | null = null
const name = '资料核验'
const goal = 'Inspect delegated sources and report the results. Preserve the original task instructions and evidence.'
const heldContext = 'This is a test subagent for the sidebar states E2E test.'

async function launch() {
  restartMockServer()
  fixture = await setupMockBackend({
    nativeGateway: true,
    extraDisplayConfig: '  language: zh',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true',
    mockServer: { holdFirstCompletionContaining: heldContext }
  })
  const { page, app } = fixture
  page.on('pageerror', error => console.error(`[subagent startup] ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') {
      console.error(`[subagent console] ${message.text()}`)
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

test('named delegated work opens once in a tool tab, shares its avatar and follows its conversation', async ({
  browserName
}, testInfo) => {
  test.skip(browserName !== 'chromium', 'The native Electron fixture uses Chromium.')
  test.setTimeout(300_000)
  const { app, page, mock } = await launch()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  const initialWindows = await windows()
  const editor = page.locator('[data-slot="composer-rich-input"]:visible')
  const request = `E2E_CALL(delegate_task)[${JSON.stringify({ tasks: [{ display_name: name, goal, context: heldContext }] })}]`
  await editor.fill(request)
  await editor.press('Enter')
  await expect.poll(() => mock.heldCompletionCount(), { timeout: 90_000 }).toBe(1)
  const parentAnchor = await page.locator('[data-chat-surface]:visible').getAttribute('data-session-anchor')
  const delegate = page.locator('[data-delegate-card]:visible [data-slot="delegate-open"]').filter({ hasText: name })
  await expect(delegate).toHaveCount(1, { timeout: 30_000 })
  await expect(delegate).not.toContainText(goal)
  const avatar = await delegate.locator('[data-slot="subagent-avatar"]').getAttribute('src')
  expect(avatar).toMatch(/^data:image\/svg\+xml,/)
  await delegate.click()

  const panel = page.locator('[data-slot="subagent-panel"]:visible')
  const tab = page.locator('[data-tree-tab="subagents"]:visible')
  await expect(tab).toHaveCount(1)
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(panel.locator('.subagent-panel-goal')).toHaveText(goal)
  await expect(panel.locator('header [data-slot="subagent-avatar"]')).toHaveAttribute('src', avatar!)
  await expect(page.locator('[data-chat-surface]:visible')).toHaveAttribute('data-session-anchor', parentAnchor!)
  expect(await windows()).toBe(initialWindows)
  await page.screenshot({ path: testInfo.outputPath('subagent-detail-desktop.png'), scale: 'css' })

  await panel.getByRole('button', { name: '返回', exact: true }).click()
  const row = panel.locator('.subagent-panel-row').filter({ hasText: name })
  await expect(row).toHaveCount(1)
  await expect(row).not.toContainText(goal)
  await expect(row.locator('[data-slot="subagent-avatar"]')).toHaveAttribute('src', avatar!)
  await page.screenshot({ path: testInfo.outputPath('subagent-list-desktop.png'), scale: 'css' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 800))
  await expect(row).toBeInViewport()
  await page.screenshot({ path: testInfo.outputPath('subagent-list-960.png'), scale: 'css' })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960))
  await row.click()
  await expect(panel.locator('.subagent-panel-goal')).toHaveText(goal)
  await expect(tab).toHaveCount(1)
  expect(await windows()).toBe(initialWindows)

  // The conversation Summary is another entry into that same tab, with the same identity.
  await page.locator('button[aria-controls="session-summary"]').click()
  const summary = page.locator('[data-slot="summary-pane"]:visible')
  const summaryChild = summary.getByRole('button').filter({ hasText: name })
  await expect(summaryChild).toHaveCount(1)
  await expect(summaryChild).not.toContainText(goal)
  await expect(summaryChild.locator('[data-slot="subagent-avatar"]')).toHaveAttribute('src', avatar!)
  await summaryChild.click()
  await expect(tab).toHaveCount(1)
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('subagent-summary-entry.png'), scale: 'css' })
  await page.locator('button[aria-controls="session-summary"]').click()

  // A fresh conversation keeps its own draft and never displays the old child's detail.
  await page.locator('[data-tour="sidebar-nav-new-session"]').click()
  const draft = '当前新会话尚未发送的草稿'
  await editor.fill(draft)
  const draftTarget = await page.locator('[data-chat-surface]:visible').getAttribute('data-composer-target')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-subagent-detail]')).toHaveCount(0)
  await expect(panel).not.toContainText(name)
  await expect(editor).toHaveText(draft)

  const capsule = page.locator('.collaboration-capsule')
  const trigger = capsule.locator('.cc-trigger')
  await trigger.click()
  const capsuleTask = capsule.locator('[data-collaboration-task]').filter({ hasText: name })
  await capsuleTask.locator('.cc-task-button').click()
  await capsuleTask.getByRole('button', { name: '查看会话', exact: true }).click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(panel.locator('.subagent-panel-goal')).toHaveText(goal)
  await expect(editor).toHaveText(draft)
  await expect(page.locator('[data-chat-surface]:visible')).toHaveAttribute('data-composer-target', draftTarget!)
  expect(await windows()).toBe(initialWindows)
  await page.screenshot({ path: testInfo.outputPath('capsule-child-preserves-draft.png'), scale: 'css' })
  await trigger.click()
  await capsule.locator('.cc-source-link').click()
  await expect(page.locator('[data-chat-surface]:visible').getByText(request, { exact: true })).toBeVisible()

  if ((await trigger.getAttribute('aria-expanded')) === 'true') {
    await trigger.click()
  }

  await expect(delegate).toBeVisible()
  await delegate.click()
  await expect(panel.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(panel.locator('header [data-slot="subagent-avatar"]')).toHaveAttribute('src', avatar!)
  await expect(
    page.locator(`[data-chat-surface][data-composer-target="${draftTarget}"] [data-slot="composer-rich-input"]`)
  ).toHaveText(draft)
  expect(await windows()).toBe(initialWindows)

  mock.releaseHeldStream()
  await expect(
    page.locator('[data-delegate-status="completed"] [data-slot="delegate-open"]').filter({ hasText: name })
  ).toBeVisible({ timeout: 60_000 })
  await expect(panel.locator('.subagent-panel-goal')).toHaveText(goal)
  await expect(panel.locator('header [data-slot="subagent-avatar"]')).toHaveAttribute('src', avatar!)
  expect(await windows()).toBe(initialWindows)
  expect(errors).toEqual([])

  try {
    await expect(panel.locator('[data-slot="subagent-panel-transcript"]')).toBeVisible({ timeout: 30_000 })
  } finally {
    const db = new DatabaseSync(path.join(fixture!.sandbox.hermesHome, 'state.db'), { readOnly: true })

    try {
      const sessions = db.prepare('SELECT id, source, parent_session_id, model_config FROM sessions').all().map(row => {
        const config = typeof row.model_config === 'string' ? JSON.parse(row.model_config) : {}

        return { id: row.id, source: row.source, parent: row.parent_session_id,
          subagentId: config?._subagent_id, delegatedFrom: config?._delegate_from }
      })

      await testInfo.attach('native-child-lineage', { body: JSON.stringify(sessions, null, 2), contentType: 'application/json' })
    } finally {
      db.close()
    }
  }

  await page.screenshot({ path: testInfo.outputPath('subagent-completed-desktop.png'), scale: 'css' })

  await page.locator('button[aria-controls="session-summary"]').click()
  const overview = summary.locator('[data-slot="summary-agents-overview"]')
  await expect(overview).toHaveText('已完成 1')
  await expect(overview.locator('[data-slot="subagent-avatar"]')).toHaveAttribute('src', avatar!)
  await expect(summary.getByRole('button').filter({ hasText: name })).toHaveCount(0)
  await expect(summary.getByRole('button', { name: '查看全部智能体', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('subagent-summary-idle-desktop.png'), scale: 'css' })
  await overview.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(panel.locator('[data-subagent-detail]')).toHaveCount(0)
  await expect(panel.locator('.subagent-panel-row').filter({ hasText: name })).toBeVisible()
  expect(await windows()).toBe(initialWindows)
})

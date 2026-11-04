import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture | null = null

test.beforeAll(async () => {
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: zh',
    extraConfig: 'account:\n  dev_mode: true'
  })
  const { page } = fixture
  await page.getByRole('textbox', { name: '手机号', exact: true }).fill('13800000103')
  await page.getByRole('checkbox', { name: '同意用户协议和隐私政策', exact: true }).check()
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await page.getByRole('textbox', { name: '验证码', exact: true }).fill('1234')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('keeps the short reasoning label on one line beside its settings control', async () => {
  const page = fixture!.page

  await page.evaluate(() => { window.location.hash = '#/settings?tab=config:model' })
  const effortControl = page.getByRole('group', { name: '推理', exact: true })
  await expect(effortControl).toBeVisible({ timeout: 30_000 })

  // Measure the real localized text node, not the surrounding flex box or a
  // source class. A full-width select used to squeeze it into two vertical
  // characters even in a wide desktop window.
  const label = page.getByText('推理', { exact: true })
  await expect(label).toBeVisible()

  const lines = await label.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)

    return new Set(Array.from(range.getClientRects()).map(rect => Math.round(rect.top))).size
  })

  expect(lines).toBe(1)
  await effortControl.getByRole('button', { name: '高', exact: true }).click()
  await expect(effortControl.getByRole('button', { name: '高', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: test.info().outputPath('settings-label.png') })
})

test('keeps routing controls with subagent defaults on their model tab', async () => {
  const page = fixture!.page
  await page.evaluate(() => { window.location.hash = '#/settings?tab=config:model' })
  const mainTab = page.getByRole('tab', { name: '主模型', exact: true })
  const subagentTab = page.getByRole('tab', { name: '子智能体', exact: true })
  await expect(mainTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toBeVisible()
  expect(await mainTab.evaluate((control, label) => {
    const following = Array.from(control.parentElement!.querySelectorAll('[role=tab]')).find(tab => tab.textContent === label)!

    return Boolean(control.compareDocumentPosition(following) & Node.DOCUMENT_POSITION_FOLLOWING)
  }, '子智能体')).toBe(true)
  await subagentTab.click()
  const subagents = page.getByRole('tabpanel', { name: '子智能体', exact: true })
  await expect(subagentTab).toHaveAttribute('aria-selected', 'true')
  await expect(subagents.getByRole('radiogroup', { name: '路由', exact: true })).toBeVisible()
  await expect(subagents.getByText('子智能体默认设置', { exact: true })).toBeVisible()
  await expect(subagents.getByRole('combobox', { name: '提供方', exact: true })).toHaveCount(0)
  await expect(subagents.getByRole('combobox', { name: '模型', exact: true })).toHaveCount(0)
  await mainTab.click()
  await expect(page.getByRole('combobox', { name: '模型', exact: true })).toBeVisible()
})

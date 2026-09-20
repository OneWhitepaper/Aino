import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture
const rendererErrors: string[] = []

test.beforeAll(async () => {
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: en',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true'
  })
  const { page } = fixture
  page.on('pageerror', error => rendererErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') rendererErrors.push(message.text())
  })
  expect(
    await page.evaluate(() => (window as Window & { hermesDesktop?: { accountAdapter?: string } }).hermesDesktop?.accountAdapter)
  ).toBe('legacy-development')
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('13800000102')
  await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
})

test('offers only brightness modes in appearance and the command palette', async () => {
  const { page, app } = fixture
  await page.evaluate(() => {
    localStorage.setItem('hermes-desktop-theme-v2', 'everforest')
    localStorage.setItem('hermes-desktop-mode-v1', 'light')
    localStorage.setItem('hermes-boot-background', '#ff0000')
    localStorage.removeItem('aino-boot-background-v1')
    localStorage.setItem('hermes.desktop.pluginDecisions.v2', JSON.stringify({ accent: true }))
  })
  await page.reload()
  await waitForAppReady(fixture, 120_000)
  expect(await page.locator('html').evaluate(node => node.style.backgroundColor)).not.toBe('rgb(255, 0, 0)')
  await page.locator('[data-aino-sidebar]').getByRole('button', { name: 'Open settings', exact: true }).click()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await expect(page.getByPlaceholder('Search your themes or the VS Code Marketplace…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Catppuccin|Everforest|Solarized/ })).toHaveCount(0)

  for (const [label, mode] of [
    ['Dark', 'dark'],
    ['Light', 'light']
  ] as const) {
    const control = page.getByRole('button', { name: label, exact: true })
    await control.click()
    await expect(control).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-hermes-mode', mode)
    await expect(page.locator('html')).toHaveAttribute('data-hermes-theme', 'mono')
    if (mode === 'dark') {
      await page.screenshot({ path: test.info().outputPath('appearance-modes-dark.png') })
    }
  }

  await page.getByRole('button', { name: 'System', exact: true }).click()
  await expect(page.getByRole('button', { name: 'System', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-hermes-mode', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-hermes-mode', 'light')
  await page.screenshot({ path: test.info().outputPath('appearance-modes-only.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 800, false))
  await expect(page.getByRole('button', { name: 'System', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('appearance-modes-narrow.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1220, 800, false))
  await page.getByRole('button', { name: 'Close settings', exact: true }).click()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog')
  const search = palette.getByRole('combobox')
  await search.fill('accent')
  await expect(palette.getByRole('option', { name: /^Accent:/ })).toHaveCount(0)
  await search.fill('theme')
  await expect(palette.getByRole('option', { name: /Change theme|Install theme|Everforest|Catppuccin/ })).toHaveCount(0)
  await search.fill('color mode')
  // Keyboard-first pickers keep hover inert until the user actually moves.
  await page.mouse.move(0, 0)
  await palette
    .getByRole('option', { name: /Change color mode/ })
    .first()
    .click()
  await expect(palette.getByRole('option', { name: /Light/ })).toBeVisible()
  await expect(palette.getByRole('option', { name: /Dark/ })).toBeVisible()
  await expect(palette.getByRole('option', { name: /System/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.reload()
  await waitForAppReady(fixture, 120_000)
  await expect(page.locator('html')).toHaveAttribute('data-hermes-theme', 'mono')
  await page.locator('[data-aino-sidebar]').getByRole('button', { name: 'Open settings', exact: true }).click()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('button', { name: 'Switch language', exact: true }).click()
  await page.mouse.move(0, 0)
  await page.getByRole('option', { name: /简体中文/ }).click()
  const light = page.locator('[id="setting-field-appearance.theme"]').getByRole('button', { name: '明亮', exact: true })
  await light.click()
  await expect(light).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-hermes-mode', 'light')
  await page.screenshot({ path: test.info().outputPath('appearance-modes-zh.png') })
  await page.getByRole('button', { name: '暗色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-hermes-mode', 'dark')
  await page.screenshot({ path: test.info().outputPath('appearance-modes-zh-dark.png') })
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(rendererErrors).toEqual([])
})

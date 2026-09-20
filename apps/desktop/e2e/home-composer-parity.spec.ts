import { mkdirSync, realpathSync } from 'node:fs'
import * as path from 'node:path'

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
  await page.emulateMedia({ reducedMotion: 'reduce' })
  page.on('pageerror', error => rendererErrors.push(error.message))
  expect(
    await page.evaluate(() => (window as Window & { hermesDesktop?: { accountAdapter?: string } }).hermesDesktop?.accountAdapter)
  ).toBe('legacy-development')
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('13800000101')
  await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
})

test.beforeEach(async () => {
  await fixture.page.locator('[data-tour="sidebar-nav-new-session"]').click()
  await expect(fixture.page.locator('.aino-home-layout')).toBeVisible()
})

test.afterAll(async () => {
  await fixture?.cleanup()
})

test('a fresh draft exposes the same resolved model and controls before and after sending', async () => {
  const testInfo = test.info()
  const { page, app } = fixture
  const surface = page.locator('[data-slot="composer-surface"]:visible')
  const model = surface.locator('[data-tour="model-pill"]')
  const input = surface.locator('[data-slot="composer-rich-input"]')
  const subtitle = page.locator('.aino-home-subtitle')
  const previousSubtitle = await subtitle.innerText()

  await page.locator('[data-tour="sidebar-nav-new-session"]').click()
  await expect(subtitle).not.toHaveText(previousSubtitle)
  const currentSubtitle = await subtitle.innerText()

  await expect(model).toContainText('Mock Model')
  const initialModel = await model.innerText()
  await expect(surface.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expect(surface.getByRole('button', { name: 'Select project', exact: true })).toBeVisible()
  await expect(surface.getByRole('button', { name: 'Voice dictation', exact: true })).toBeVisible()
  await surface.getByRole('button', { name: 'Voice', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Start voice conversation', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Read replies aloud', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitemcheckbox', { name: /Wake word/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await surface.getByRole('button', { name: 'Add context', exact: true }).click()
  await page.getByRole('menuitem', { name: /Prompt snippets/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await model.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')

  await input.fill('A long draft that must stay above the controls.\n'.repeat(100))
  await expect(subtitle).toHaveText(currentSubtitle)
  const inputBox = await input.boundingBox()
  const sendBox = await surface.getByRole('button', { name: 'Send', exact: true }).boundingBox()
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(sendBox!.y)
  await expect(surface.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('home-long-draft.png') })

  const windowSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 800, false))

  for (let draft = 0; draft < 5; draft++) {
    await page.locator('[data-tour="sidebar-nav-new-session"]').click()
    await expect
      .poll(() =>
        subtitle.evaluate(el => {
          const bounds = el.closest('[data-chat-surface]')!.getBoundingClientRect()
          const rect = el.getBoundingClientRect()

          return Math.max(
            el.scrollWidth - el.clientWidth,
            rect.right - Math.min(bounds.right, innerWidth),
            bounds.left - rect.left
          )
        })
      )
      .toBeLessThanOrEqual(1)
  }

  await page.screenshot({ path: testInfo.outputPath('home-copy-constrained.png') })
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1], false),
    windowSize
  )

  await input.fill('Check the shared composer')
  await page.screenshot({ path: testInfo.outputPath('home-composer.png') })
  await input.press('Enter')
  await expect(page.getByText(/Hello from the mock inference server/)).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await expect(page.locator('.aino-home-layout')).toHaveCount(0)
  await expect(input).toBeVisible()
  await expect(model).toHaveText(initialModel)
  await expect(surface.getByRole('button', { name: 'Select project', exact: true })).toBeVisible()
  await expect(surface.getByRole('button', { name: 'Voice dictation', exact: true })).toBeVisible()
  await expect(surface.getByRole('button', { name: 'Voice', exact: true })).toBeVisible()
  await expect(surface.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('conversation-composer.png') })
  expect(rendererErrors).toEqual([])
})

test('home project selection can create, reenter and open folders without inheriting an ordinary draft', async () => {
  const testInfo = test.info()
  const { page, app, sandbox } = fixture
  const surface = page.locator('[data-slot="composer-surface"]:visible')
  const folder = path.join(realpathSync(sandbox.root), 'HomeProject')
  mkdirSync(folder)
  await app.evaluate(({ dialog }, selectedFolder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFolder] })
  }, folder)

  await surface.getByRole('button', { name: 'Select project', exact: true }).click()
  await page.getByRole('menuitem', { name: /New project/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill('HomeProject')
  await dialog.getByRole('button', { name: /Add folder/ }).click()
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(surface.getByRole('button', { name: 'HomeProject', exact: true })).toBeVisible()

  await page.locator('[data-tour="sidebar-nav-new-session"]').click()
  await expect(surface.getByRole('button', { name: 'Select project', exact: true })).toBeVisible()
  await surface.getByRole('button', { name: 'Select project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'HomeProject', exact: true }).click()
  await expect(surface.getByRole('button', { name: 'HomeProject', exact: true })).toBeVisible()

  const openedFolder = path.join(realpathSync(sandbox.root), 'OpenedFolder')
  mkdirSync(openedFolder)
  await app.evaluate(({ dialog }, selectedFolder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedFolder] })
  }, openedFolder)
  await surface.getByRole('button', { name: 'HomeProject', exact: true }).click()
  await page.getByRole('menuitem', { name: /Open folder/ }).click()
  await expect(surface.getByRole('button', { name: 'OpenedFolder', exact: true })).toBeVisible()

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 800, false))
  await expect(surface.getByRole('button', { name: 'OpenedFolder', exact: true })).toBeVisible()
  expect(await surface.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect
    .poll(async () => {
      const box = await surface.boundingBox()
      const actions = await page.locator('.aino-home-actions').boundingBox()

      return actions!.y - (box!.y + box!.height)
    })
    .toBeGreaterThan(0)
  const surfaceBox = await surface.boundingBox()
  const sendBox = await surface.getByRole('button', { name: 'Send', exact: true }).boundingBox()
  expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(surfaceBox!.x + surfaceBox!.width)
  await page.screenshot({ path: testInfo.outputPath('home-project-narrow.png') })
  expect(rendererErrors).toEqual([])
})

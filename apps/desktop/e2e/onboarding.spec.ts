/** Provider configuration is a Settings destination; it must not mask the workspace on boot. */
import * as fs from 'node:fs'
import * as path from 'node:path'

import { buildAppEnv, createSandbox, launchDesktop, type NoProviderFixture, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: NoProviderFixture | null = null

test.afterEach(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('keeps a fresh workspace available and configures models through settings', async () => {
  test.slow()
  const sandbox = createSandbox('model-settings-entry')

  fs.writeFileSync(path.join(sandbox.hermesHome, 'config.yaml'), [
    'display:', '  language: en',
    'desktop:', '  repo_scan_enabled: false',
    'account:', '  dev_mode: true',
    'nous:', '  guest: false',
    'onboarding:', '  run: false',
    '',
  ].join('\n'))
  const { app, page } = await launchDesktop(buildAppEnv(sandbox))

  fixture = { app, page, sandbox, cleanup: async () => {
    await app.close().catch(() => undefined)
    sandbox.cleanup()
  } }
  const errors: string[] = []

  page.on('pageerror', error => errors.push(error.message))
  const agreement = page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true })

  await expect(agreement).toBeVisible({ timeout: 120_000 })
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('13800000101')
  await agreement.check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
  await expect(page.getByRole('heading', { name: /get you setup/i })).toHaveCount(0)
  await expect(page.getByRole('button', { name: "I'll choose a provider later", exact: true })).toHaveCount(0)
  await expect(page.locator('[data-slot="composer-rich-input"]:visible')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('fresh-workspace.png') })

  await page.evaluate(() => { location.hash = '#/settings?tab=config:model' })
  await expect(page.getByRole('heading', { name: 'Model', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Aino built-in models', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('model-settings.png') })
  expect(errors).toEqual([])
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
})

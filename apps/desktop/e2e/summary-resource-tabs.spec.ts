import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture | null = null
let server: Server | null = null

async function savedUrls(): Promise<string[]> {
  return fixture!.page.evaluate(() => {
    const buckets = JSON.parse(localStorage.getItem('hermes.desktop.previewTabs.v2') || '{}') as Record<
      string,
      { target: { url: string } }[]
    >

    return Object.values(buckets).flatMap(tabs => tabs.map(tab => tab.target.url))
  })
}

test.afterEach(async () => {
  await fixture?.cleanup()
  fixture = null

  if (server) {
    await new Promise<void>(resolve => server!.close(() => resolve()))
    server = null
  }
})

test('opens summary outputs in separate tabs and returns to an existing output tab', async () => {
  test.slow()
  server = createServer((request, response) => {
    const name = request.url?.includes('second') ? 'Second output' : 'First output'
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<html><head><title>${name}</title></head><body><h1>${name}</h1></body></html>`)
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const first = `${origin}/first.html`
  const second = `${origin}/second.html`

  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: en',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true',
    mockServer: { replyForPrompt: () => `Prepared two output pages.\n\nMEDIA:${first}\nMEDIA:${second}` }
  })
  const { page, app } = fixture
  const rendererErrors: string[] = []
  page.on('pageerror', error => rendererErrors.push(error.message))
  const agreement = page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true })

  await expect(agreement).toBeVisible({ timeout: 120_000 })
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('13800000102')
  await agreement.check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))
  const composer = page.locator('[data-slot="composer-rich-input"]:visible')

  await composer.fill('Create two output pages for this test.')
  await composer.press('Enter')
  await expect(page.getByText('Prepared two output pages.', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Session resources', exact: true }).click()
  const summary = page.locator('[data-slot="summary-pane"]:visible')

  await summary.getByRole('button', { name: 'Open source: first.html', exact: true }).click()
  const panel = page.locator('[data-tool-panel]:visible')
  const firstTab = panel.locator('[data-tree-tab]').filter({ hasText: 'First output' })

  await expect(firstTab).toBeVisible({ timeout: 30_000 })
  const firstId = await firstTab.getAttribute('data-tree-tab')
  const profileConsent = page.getByRole('dialog', { name: 'Stay signed in to your sites', exact: true })

  await expect(profileConsent).toBeVisible()
  await profileConsent.getByRole('button', { name: 'Not now', exact: true }).click()
  await expect(profileConsent).toBeHidden()

  await summary.getByRole('button', { name: 'Open source: second.html', exact: true }).click()
  const secondTab = panel.locator('[data-tree-tab]').filter({ hasText: 'Second output' })

  await expect(secondTab).toBeVisible({ timeout: 30_000 })
  await expect(firstTab).toBeVisible()
  const secondId = await secondTab.getAttribute('data-tree-tab')

  expect(secondId).not.toBe(firstId)
  await expect.poll(savedUrls).toEqual(expect.arrayContaining([first, second]))
  const totalTabs = await panel.locator('[data-tree-tab]').count()

  await summary.getByRole('button', { name: 'Open source: first.html', exact: true }).click()
  await expect(firstTab).toHaveAttribute('aria-selected', 'true')
  await expect(panel.locator('[data-tree-tab]')).toHaveCount(totalTabs)
  await expect(secondTab).toBeVisible()
  expect(rendererErrors).toEqual([])
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('summary-output-tabs.png') })
})

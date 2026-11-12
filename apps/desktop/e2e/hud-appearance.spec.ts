import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

interface HudWindow extends Window {
  hermesDesktop: {
    hud: {
      open: (request: { sessionId: string }) => Promise<{ ok: boolean }>
      close: () => Promise<{ ok: boolean }>
    }
  }
}

let fixture: MockBackendFixture | null = null

test.beforeAll(async () => {
  fixture = await setupMockBackend()
  await waitForAppReady(fixture, 120_000)
})

test.afterAll(async () => {
  await fixture?.cleanup()
  fixture = null
})

test('keeps a reading surface behind the unfocused HUD transcript, then hides both at idle', async () => {
  const { app, page } = fixture!
  const composer = page.locator('[data-slot="composer-rich-input"]').first()

  await composer.fill('HUD appearance acceptance')
  await composer.press('Enter')
  await expect(page.getByText(/Hello from the mock inference server!/).first()).toBeVisible({ timeout: 60_000 })

  // Open the actual secondary renderer through the production bridge and use
  // the durable route identity, just as the titlebar HUD action does.
  const sessionId = new URL(page.url()).hash.replace(/^#\//, '').split('?')[0]
  const opened = app.waitForEvent('window')

  await page.evaluate(id => (window as unknown as HudWindow).hermesDesktop.hud.open({ sessionId: id }), sessionId)
  const hud = await opened
  const input = hud.locator('[data-slot="composer-rich-input"]')
  const shell = hud.locator('[data-hud-shell]')
  const sheet = hud.locator('[data-hud-glass]')
  const transcript = hud.locator('[data-slot="composer-bounds"]')

  await input.waitFor({ state: 'visible' })
  await input.focus()
  await expect(hud.getByText('HUD appearance acceptance', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(sheet).toHaveCSS('opacity', '1')

  // Freeze only the existing hold timer, not CSS transitions or React. This
  // makes the short glanceable state deterministic without authoring its DOM.
  await hud.clock.install()
  await hud.clock.pauseAt(new Date())
  await input.evaluate(node => (node as HTMLElement).blur())

  await expect(shell).toHaveAttribute('data-hud-recent', '')
  await expect(transcript).toHaveCSS('opacity', '1')
  await expect(sheet).toHaveCSS('opacity', '1')
  await expect(sheet).toHaveCSS('pointer-events', 'none')

  await hud.clock.resume()
  await expect(shell).not.toHaveAttribute('data-hud-recent', '', { timeout: 5_000 })
  await expect(transcript).toHaveCSS('opacity', '0')
  await expect(sheet).toHaveCSS('opacity', '0')
  await expect(input).toBeVisible()
  await page.evaluate(() => (window as unknown as HudWindow).hermesDesktop.hud.close())
})

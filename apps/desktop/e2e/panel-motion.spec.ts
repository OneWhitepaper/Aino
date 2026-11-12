import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { Locator, Page } from '@playwright/test'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { expect, test } from './test'

let fixture: MockBackendFixture | null = null
let server: Server | null = null

/** Observe painted geometry, including the first frame after an actual action. */
async function sampleWidth(button: Locator, selector: string) {
  return button.evaluate(async (element, target) => {
    const samples: number[] = []
    const started = performance.now()
    const sample = () => samples.push(document.querySelector(target)?.getBoundingClientRect().width ?? 0)
    sample()
    ;(element as HTMLButtonElement).click()

    while (performance.now() - started < 360) {
      await new Promise(requestAnimationFrame)
      sample()
    }

    return samples
  }, selector)
}

function expectInterpolation(samples: number[], opening: boolean) {
  expect(new Set(samples.map(Math.round)).size).toBeGreaterThan(3)
  expect(opening ? samples.at(-1)! - samples[0] : samples[0] - samples.at(-1)!).toBeGreaterThan(100)
}

/** A flex run must fill its container while the animated track has grow=0. */
async function sampleTrackCoverage(button: Locator, selector: string, closingGuest?: string) {
  return button.evaluate(
    async (element, { target, closingGuest }) => {
      const track = document.querySelector<HTMLElement>(target)!
      const parent = track.parentElement!
      const host = closingGuest ? document.querySelector<HTMLElement>(closingGuest) : null

      const samples: {
        width: number
        x: number
        gap: number
        moving: boolean
        guest?: { visibility: string; inert: boolean }
      }[] = []

      const started = performance.now()

      const sample = () => {
        const bounds = track.getBoundingClientRect()
        const occupied = [...parent.children].reduce((sum, child) => sum + child.getBoundingClientRect().width, 0)
        samples.push({
          width: bounds.width,
          x: bounds.x,
          gap: parent.getBoundingClientRect().width - occupied,
          moving: track.hasAttribute('data-tool-track-motion'),
          guest: host
            ? {
                visibility: getComputedStyle(host).visibility,
                inert: host.inert
              }
            : undefined
        })
      }

      ;(element as HTMLButtonElement).click()

      while (performance.now() - started < 400) {
        await new Promise(requestAnimationFrame)
        sample()
      }

      return samples
    },
    { target: selector, closingGuest }
  )
}

function expectStableTrackCoverage(samples: Awaited<ReturnType<typeof sampleTrackCoverage>>) {
  expect(samples.some(sample => sample.moving)).toBe(true)
  expect(Math.max(...samples.map(sample => Math.abs(sample.gap)))).toBeLessThan(2)

  const finalMovingIndex = samples.findLastIndex(sample => sample.moving)
  const lastMoving = samples[finalMovingIndex]
  const settled = samples[finalMovingIndex + 1]
  expect(settled).toBeDefined()

  if (settled.width > 1) {
    expect(Math.abs(settled.x - lastMoving.x)).toBeLessThan(10)
  }

  expect(Math.abs(settled.width - lastMoving.width)).toBeLessThan(10)

  for (const sample of samples.filter(sample => sample.moving && sample.width > 1 && sample.guest)) {
    expect(sample.guest!.visibility).toBe('visible')
    expect(sample.guest!.inert).toBe(true)
  }
}

async function checkDraft(page: Page, draft: string) {
  await expect(page.locator('[data-slot="composer-rich-input"]:visible')).toHaveText(draft)
  expect(
    await page
      .locator('[data-slot="composer-rich-input"]:visible')
      .evaluate(element => element.getBoundingClientRect().right <= window.innerWidth)
  ).toBe(true)
}

test.afterEach(async () => {
  await fixture?.cleanup()
  fixture = null

  if (server) {
    await new Promise<void>(resolve => server!.close(() => resolve()))
    server = null
  }
})

test('panel and summary transitions preserve drafts, survive interruption and honor reduced motion', async ({
  browserName
}, info) => {
  test.skip(browserName !== 'chromium', 'The native Electron fixture uses Chromium.')
  test.setTimeout(240_000)
  fixture = await setupMockBackend({
    extraDisplayConfig: '  language: en',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true'
  })
  const { app, page } = fixture
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).waitFor({ timeout: 60_000 })
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('13800000109')
  await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const draft = 'Keep this draft while opening and closing panels.'
  await page.locator('[data-slot="composer-rich-input"]:visible').fill(draft)
  const summaryToggle = page.getByRole('button', { name: 'Session resources', exact: true })
  const summaryRail = '[data-slot="summary-rail"]'
  expectInterpolation(await sampleWidth(summaryToggle, summaryRail), true)
  await expect(page.locator(summaryRail)).toHaveAttribute('data-layout', 'docked')
  await page.screenshot({ path: info.outputPath('summary-docked.png'), scale: 'css' })
  expectInterpolation(await sampleWidth(summaryToggle, summaryRail), false)
  await expect(page.locator(summaryRail)).toHaveCount(0)

  // Reverse an unfinished close, keeping exactly one card and the same editor.
  await summaryToggle.evaluate(async element => {
    const button = element as HTMLButtonElement
    button.click()
    await new Promise(resolve => setTimeout(resolve, 70))
    button.click()
    await new Promise(resolve => setTimeout(resolve, 50))
    button.click()
  })
  await expect(page.locator(summaryRail)).toHaveCount(1)
  await expect(page.locator(summaryRail)).toHaveAttribute('data-state', 'open')
  await checkDraft(page, draft)

  // Crossing the dock breakpoint during an exit must not leave a ghost card.
  await summaryToggle.evaluate(element => (element as HTMLButtonElement).click())
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 800, false))
  await expect(page.locator(summaryRail)).toHaveCount(0)
  await summaryToggle.click()
  await expect(page.locator(summaryRail)).toHaveAttribute('data-layout', 'overlay')
  await page.screenshot({ path: info.outputPath('summary-overlay.png'), scale: 'css' })
  await summaryToggle.click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))

  const track = '[data-tree-track]:has(> [data-tool-panel])'
  expectInterpolation(
    await sampleWidth(page.getByRole('button', { name: 'Show right sidebar', exact: true }), track),
    true
  )
  const panel = page.locator('[data-tool-panel]:visible')
  await panel.locator('[data-tool-chooser]').getByRole('button', { name: 'Files', exact: true }).click()
  const files = await panel.locator('[data-tree-tab="files"]').elementHandle()
  expectInterpolation(
    await sampleWidth(page.getByRole('button', { name: 'Hide right sidebar', exact: true }), track),
    false
  )
  expect(await files!.evaluate(element => element.isConnected)).toBe(true)
  expectInterpolation(
    await sampleWidth(page.getByRole('button', { name: 'Show right sidebar', exact: true }), track),
    true
  )
  await expect(panel.locator('[data-tree-tab="files"]')).toHaveAttribute('aria-selected', 'true')
  expect(await files!.evaluate(element => element.isConnected)).toBe(true)
  await checkDraft(page, draft)
  await page.screenshot({ path: info.outputPath('tools-and-draft.png'), scale: 'css' })

  // Live native content must survive motion, not merely retain a placeholder.
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<html><title>Motion browser</title><body>Local motion acceptance</body></html>')
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  await panel.getByRole('button', { name: 'New tab', exact: true }).click()
  await panel.locator('[data-tool-chooser]').getByRole('button', { name: 'Browser', exact: true }).click()
  const consent = page.getByRole('dialog', { name: 'Stay signed in to your sites', exact: true })
  await expect(consent).toBeVisible()
  await consent.getByRole('button', { name: 'Not now', exact: true }).click()
  const address = page.getByRole('textbox', { name: 'Address', exact: true })
  await address.fill(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
  await address.press('Enter')
  const guest = page.locator('webview:visible')
  await expect(guest).toBeVisible()

  const guestId = await guest.evaluate(element =>
    (element as HTMLElement & { getWebContentsId(): number }).getWebContentsId()
  )

  await expect
    .poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getTitle(), guestId))
    .toBe('Motion browser')

  const marker = await app.evaluate(
    ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.motionMarker = crypto.randomUUID()'),
    guestId
  )

  const browserTabId = await panel.locator('[data-tree-tab][aria-selected="true"]').getAttribute('data-tree-tab')
  await panel.locator('[data-tree-tab="files"]').click()
  await panel.locator(`[data-tree-tab="${browserTabId}"]`).click()
  await panel.locator('[data-tree-tab="files"]').click({ button: 'middle' })

  // Real sash resizing produces unequal chat/tool weights. Checking equal
  // tracks alone misses CSS flex-grow's partial-fill rule when one is fixed.
  const sash = panel.locator('..').getByRole('separator', { exact: true })
  const sashBounds = await sash.boundingBox()
  expect(sashBounds).not.toBeNull()
  await page.mouse.move(sashBounds!.x + sashBounds!.width / 2, sashBounds!.y + sashBounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(sashBounds!.x + 110, sashBounds!.y + sashBounds!.height / 2, { steps: 8 })
  await page.mouse.up()

  const weights = await page
    .locator(track)
    .evaluate(element =>
      [...element.parentElement!.children]
        .map(child => Number.parseFloat(getComputedStyle(child).flexGrow))
        .filter(weight => weight > 0)
    )

  expect(weights).toHaveLength(2)
  expect(Math.max(...weights) / Math.min(...weights)).toBeGreaterThan(1.5)
  const guestHost = await guest.evaluate(element => element.closest('[data-pane-host]')!.getAttribute('data-pane-host'))
  expectStableTrackCoverage(
    await sampleTrackCoverage(
      page.getByRole('button', { name: 'Hide right sidebar', exact: true }),
      track,
      `[data-pane-host="${guestHost}"]`
    )
  )
  await expect(page.getByRole('button', { name: 'Show right sidebar', exact: true })).toBeVisible()
  expectStableTrackCoverage(
    await sampleTrackCoverage(page.getByRole('button', { name: 'Show right sidebar', exact: true }), track)
  )
  await expect(guest).toBeVisible()
  expect(
    await app.evaluate(
      ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('window.motionMarker'),
      guestId
    )
  ).toBe(marker)

  await panel.getByRole('button', { name: 'New tab', exact: true }).click()
  await panel.locator('[data-tool-chooser]').getByRole('button', { name: 'Terminal', exact: true }).click()
  const terminal = page.locator('[data-terminal]:visible')
  const terminalHandle = await terminal.elementHandle()

  const shell = async (command: string) => {
    const input = terminal.locator('.xterm-helper-textarea')
    await expect(input).toBeAttached()
    await input.press('Control+u')
    await input.pressSequentially(command)
    await input.press('Enter')
  }

  const buffer = () =>
    page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('hermes.desktop.terminals.v1') || '{}')

      return saved.terminals?.find((item: { id: string }) => item.id === saved.activeTerminalId)?.reviveBuffer ?? ''
    })

  await shell('AINO_MOTION_PID=$$; printf "MOTION_BEFORE:%s:END" "$AINO_MOTION_PID"')
  await expect.poll(buffer).toMatch(/MOTION_BEFORE:[0-9]+:END/)
  const pid = (await buffer()).match(/MOTION_BEFORE:([0-9]+):END/)![1]
  await page.getByRole('button', { name: 'Hide right sidebar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show right sidebar', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click()
  await expect(terminal).toBeVisible()
  await shell('printf "MOTION_AFTER:%s:%s:END" "$AINO_MOTION_PID" "$$"')
  await expect.poll(buffer).toContain(`MOTION_AFTER:${pid}:${pid}:END`)
  expect(await terminalHandle!.evaluate(element => element.isConnected)).toBe(true)
  await checkDraft(page, draft)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await summaryToggle.evaluate(element => (element as HTMLButtonElement).click())
  await expect(page.locator(summaryRail)).toHaveCount(1)
  await summaryToggle.evaluate(element => (element as HTMLButtonElement).click())
  await expect(page.locator(summaryRail)).toHaveCount(0)
  await page.getByRole('button', { name: 'Hide right sidebar', exact: true }).click()
  await expect(page.locator('[data-tool-track-motion]')).toHaveCount(0)
  await checkDraft(page, draft)
  expect(errors).toEqual([])
})

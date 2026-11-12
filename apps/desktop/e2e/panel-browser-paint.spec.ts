import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { type MockBackendFixture, setupMockBackend, waitForAppReady } from './fixtures'
import { sampleNativePaint, subscribeNativePaint } from './native-paint-frames'
import { expect, test } from './test'

let fixture: MockBackendFixture | null = null
let server: Server | null = null

test.afterEach(async () => {
  await fixture?.cleanup()
  fixture = null

  if (server) {
    await new Promise<void>(resolve => server!.close(() => resolve()))
    server = null
  }
})

test('reopening a native browser preserves its viewport and never paints a white frame', async ({
  browserName
}, info) => {
  test.skip(browserName !== 'chromium', 'Electron paints with Chromium.')
  test.setTimeout(240_000)
  fixture = await setupMockBackend({
    allowGpu: true,
    extraDisplayConfig: '  language: en',
    extraConfig: 'desktop:\n  repo_scan_enabled: false\naccount:\n  dev_mode: true'
  })
  const { app, page } = fixture
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('13800000119')
  await page.getByRole('checkbox', { name: 'Agree to the user agreement and privacy policy', exact: true }).check()
  await page.getByRole('button', { name: 'Send code', exact: true }).click()
  await page.getByRole('textbox', { name: 'Verification code', exact: true }).fill('1234')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await waitForAppReady(fixture, 120_000)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1680, 1000, false))
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  const gpu = await app.evaluate(({ app }) => ({
    disabled: app.commandLine.hasSwitch('disable-gpu'),
    features: app.getGPUFeatureStatus()
  }))

  expect(gpu.disabled).toBe(false)
  await info.attach('native-gpu-state', { body: JSON.stringify(gpu), contentType: 'application/json' })

  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><html><head><title>Native paint acceptance</title><style>html,body{margin:0;min-height:100vh;background:#115d6d}header{height:24px;background:#101010}</style></head><body><header></header><script>window.paintMarker=crypto.randomUUID();window.paintWidths=[];addEventListener("resize",()=>paintWidths.push({at:Date.now(),width:innerWidth}));</script></body></html>'
    )
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  await page.getByRole('button', { name: 'Show right sidebar', exact: true }).click()
  const panel = page.locator('[data-tool-panel]:visible')
  await panel.locator('[data-tool-chooser]').getByRole('button', { name: 'Browser', exact: true }).click()
  const consent = page.getByRole('dialog', { name: 'Stay signed in to your sites', exact: true })
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
    .toBe('Native paint acceptance')

  const sash = panel.locator('..').getByRole('separator', { exact: true })
  const sashBounds = await sash.boundingBox()
  expect(sashBounds).not.toBeNull()
  await page.mouse.move(sashBounds!.x + 3, sashBounds!.y + sashBounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(1680 - 657, sashBounds!.y + sashBounds!.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(() => app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('innerWidth'), guestId))
    .toBeGreaterThan(640)

  const flex = await panel.locator('..').evaluate(element => ({
    basis: getComputedStyle(element).flexBasis,
    grow: Number.parseFloat(getComputedStyle(element).flexGrow)
  }))

  expect(flex.basis).toBe('0px')
  expect(flex.grow).toBeGreaterThan(0)

  const baseline = (await app.evaluate(
    ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('({marker:paintMarker,width:innerWidth})'),
    guestId
  )) as { marker: string; width: number }

  const bounds = await guest.boundingBox()
  expect(bounds).not.toBeNull()
  const region = { x: Math.floor(bounds!.x + bounds!.width - 22), y: Math.floor(bounds!.y + 70), width: 8, height: 8 }

  // A chrome probe identifies presented panel frames. DOM can advance while
  // Chromium is still delivering a cached pre-action composition.
  const chrome = await panel.evaluate(element => {
    const marker = element.ownerDocument.createElement('span')
    Object.assign(marker.style, {
      position: 'absolute',
      right: '2px',
      top: '2px',
      width: '8px',
      height: '8px',
      background: 'rgb(227,18,123)',
      zIndex: '99',
      pointerEvents: 'none'
    })
    element.append(marker)
    const bounds = marker.getBoundingClientRect()

    return { x: bounds.x + 2, y: bounds.y + 2, width: 4, height: 4 }
  })

  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const baselinePng = await page.screenshot()
  await info.attach('native-paint-baseline', { body: baselinePng, contentType: 'image/png' })
  expect(sampleNativePaint(baselinePng, region, viewport).matchingRatio).toBeGreaterThan(0.95)
  expect(sampleNativePaint(baselinePng, chrome, viewport, Date.now(), [227, 18, 123]).matchingRatio).toBeGreaterThan(
    0.95
  )

  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: 'Hide right sidebar', exact: true }).click()
    await expect(page.locator('[data-tool-track-motion]')).toHaveCount(0)
    await app.evaluate(({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('paintWidths=[]'), guestId)
    const stop = await subscribeNativePaint(page, region, chrome)

    const geometry = await page
      .getByRole('button', { name: 'Show right sidebar', exact: true })
      .evaluate(async element => {
        const samples: { at: number; width: number; x: number; trackWidth: number }[] = []

        const started = Date.now()

        ;(element as HTMLButtonElement).click()

        // Include the native viewport handoff after the 220ms track animation.
        while (Date.now() - started < 700) {
          await new Promise(requestAnimationFrame)
          const host = document.querySelector('webview')!
          const track = document.querySelector<HTMLElement>('[data-tree-track]:has(> [data-tool-panel])')!
          const bounds = track.getBoundingClientRect()
          samples.push({
            at: Date.now(),
            width: host.getBoundingClientRect().width,
            x: bounds.x,
            trackWidth: bounds.width
          })
        }

        return samples
      })

    const frames = await stop()
    const started = geometry[0].at

    const painted = frames.filter(frame => {
      const layout = geometry.findLast(sample => sample.at <= frame.at)

      return (
        frame.chromeRatio! > 0.95 &&
        frame.at >= started &&
        frame.at <= geometry.at(-1)!.at &&
        layout &&
        layout.x + 8 < region.x &&
        layout.x + layout.trackWidth >= region.x + region.width
      )
    })

    await info.attach(`native-paint-cycle-${cycle}`, {
      body: JSON.stringify({ frames: frames.map(({ png: _png, ...frame }) => frame), geometry }),
      contentType: 'application/json'
    })

    for (const [index, frame] of painted.entries()) {
      if (frame.png) {
        await info.attach(`white-frame-${cycle}-${index}`, {
          body: Buffer.from(frame.png, 'base64'),
          contentType: 'image/png'
        })
      }
    }

    expect(painted.length).toBeGreaterThan(4)
    expect(Math.max(...painted.map(frame => frame.whiteRatio))).toBeLessThan(0.05)
    expect(Math.min(...painted.map(frame => frame.matchingRatio))).toBeGreaterThan(0.95)
    expect(Math.max(...geometry.map(sample => Math.abs(sample.width - baseline.width)))).toBeLessThan(2)

    const state = (await app.evaluate(
      ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('({marker:paintMarker,widths:paintWidths})'),
      guestId
    )) as { marker: string; widths: { at: number; width: number }[] }

    await info.attach(`native-viewport-cycle-${cycle}`, {
      body: JSON.stringify({ baseline, state }),
      contentType: 'application/json'
    })

    expect(state.marker).toBe(baseline.marker)
    // Chromium may report zero while the guest is still hidden. Once panel
    // chrome is presented, including the post-animation handoff, it must stay
    // at its final viewport rather than triggering responsive page relayouts.
    expect(
      state.widths
        .filter(sample => sample.at >= painted[0].at)
        .every(sample => Math.abs(sample.width - baseline.width) < 2)
    ).toBe(true)
    expect(
      await guest.evaluate(element => (element as HTMLElement & { getWebContentsId(): number }).getWebContentsId())
    ).toBe(guestId)
  }
})

import { createRequire } from 'node:module'

import type { Page } from '@playwright/test'

const { PNG } = createRequire(import.meta.url)('pngjs') as {
  PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Buffer } } }
}

interface PaintRegion {
  x: number
  y: number
  width: number
  height: number
}
interface ViewportSize {
  width: number
  height: number
}

export interface PaintFrame {
  at: number
  whiteRatio: number
  matchingRatio: number
  chromeRatio?: number
  png?: string
}

/** Decode after recording so pixel analysis cannot slow presentation frames. */
export function sampleNativePaint(
  png: Buffer,
  region: PaintRegion,
  viewport: ViewportSize,
  at = Date.now(),
  expected = [17, 93, 109]
): PaintFrame {
  const image = PNG.sync.read(png)
  const scaleX = image.width / viewport.width
  const scaleY = image.height / viewport.height
  const left = Math.floor(region.x * scaleX)
  const top = Math.floor(region.y * scaleY)
  const right = Math.min(image.width, Math.ceil((region.x + region.width) * scaleX))
  const bottom = Math.min(image.height, Math.ceil((region.y + region.height) * scaleY))
  let white = 0
  let matching = 0
  let count = 0

  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * image.width + x) * 4
      const red = image.data[offset]
      const green = image.data[offset + 1]
      const blue = image.data[offset + 2]
      count++

      if (red > 240 && green > 240 && blue > 240) {
        white++
      }

      if (Math.abs(red - expected[0]) < 45 && Math.abs(green - expected[1]) < 45 && Math.abs(blue - expected[2]) < 45) {
        matching++
      }
    }
  }

  return {
    at,
    whiteRatio: white / count,
    matchingRatio: matching / count,
    png: white / count > 0.5 ? png.toString('base64') : undefined
  }
}

/** CDP captures the presented composition including the native guest surface. */
export async function subscribeNativePaint(page: Page, region: PaintRegion, chrome: PaintRegion) {
  const session = await page.context().newCDPSession(page)
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const raw: { at: number; png: string }[] = []
  const acknowledgements: Promise<unknown>[] = []
  session.on('Page.screencastFrame', event => {
    // Events can deliver cached pre-action frames after the click. The
    // compositor timestamp, rather than IPC arrival time, identifies them.
    raw.push({ at: event.metadata.timestamp! * 1000, png: event.data })
    acknowledgements.push(session.send('Page.screencastFrameAck', { sessionId: event.sessionId }))
  })
  await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })

  return async () => {
    await session.send('Page.stopScreencast')
    await Promise.all(acknowledgements)
    await session.detach()

    return raw.map(frame => {
      const png = Buffer.from(frame.png, 'base64')

      return {
        ...sampleNativePaint(png, region, viewport, frame.at),
        chromeRatio: sampleNativePaint(png, chrome, viewport, frame.at, [227, 18, 123]).matchingRatio
      }
    })
  }
}

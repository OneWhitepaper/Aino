import { createRequire } from 'node:module'

import type { ElectronApplication, Page } from '@playwright/test'

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

/** Capture this fixture window's OS composition, including its native child Browser view. */
export async function captureNativeWindow(app: ElectronApplication, viewport: ViewportSize): Promise<Buffer> {
  const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }, size) => {
    const id = BrowserWindow.getAllWindows()[0].getMediaSourceId()
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size })
    const source = sources.find(item => item.id === id)

    if (!source || source.thumbnail.isEmpty()) {
      throw new Error('Native window capture is unavailable; verify screen-recording permission')
    }

    return source.thumbnail.toPNG().toString('base64')
  }, viewport)

  return Buffer.from(png, 'base64')
}

/** CDP excludes WebContentsView children; record the fixture window's native media stream. */
export async function subscribeNativePaint(
  app: ElectronApplication,
  page: Page,
  region: PaintRegion,
  chrome: PaintRegion
) {
  const id = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMediaSourceId())

  const viewport = await page.evaluate(async sourceId => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          minFrameRate: 60,
          maxFrameRate: 60
        }
      }
    } as unknown as MediaStreamConstraints)

    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    const frames: { at: number; png: string }[] = []
    const owner = window as Window & { stopNativePaintCapture?: () => typeof frames }
    let callback = 0

    const stop = () => {
      video.cancelVideoFrameCallback(callback)
      stream.getTracks().forEach(track => track.stop())
      video.srcObject = null
      delete owner.stopNativePaintCapture

      return frames
    }

    try {
      video.muted = true
      video.srcObject = stream
      await video.play()
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')!

      await new Promise<void>(resolve => {
        const record: VideoFrameRequestCallback = (_now, metadata) => {
          context.drawImage(video, 0, 0)
          frames.push({
            at: performance.timeOrigin + metadata.presentationTime,
            png: canvas.toDataURL('image/png').split(',')[1]
          })
          callback = video.requestVideoFrameCallback(record)
          resolve()
        }

        callback = video.requestVideoFrameCallback(record)
      })
      owner.stopNativePaintCapture = stop
    } catch (error) {
      stop()
      throw error
    }

    return { width: innerWidth, height: innerHeight }
  }, id)

  return async () => {
    const raw = await page.evaluate(() => {
      const owner = window as unknown as Window & { stopNativePaintCapture: () => { at: number; png: string }[] }

      return owner.stopNativePaintCapture()
    })

    return raw.map(frame => {
      const png = Buffer.from(frame.png, 'base64')

      return {
        ...sampleNativePaint(png, region, viewport, frame.at),
        chromeRatio: sampleNativePaint(png, chrome, viewport, frame.at, [227, 18, 123]).matchingRatio
      }
    })
  }
}

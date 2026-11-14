import { expect, it, vi } from 'vitest'

import { createPreviewPageZoom } from './preview-page-zoom'

function page(contentWidth = 0) {
  let width = 600
  let factor = 1
  let eligible = true
  const changed = vi.fn()

  const guest = {
    getZoomFactor: () => factor,
    setZoomFactor: vi.fn((next: number) => {
      factor = next
    }),
    setZoomMode: vi.fn(),
    executeJavaScript: vi.fn(async () => ({ viewport: width / factor, width: Math.max(width / factor, contentWidth) }))
  }

  const zoom = createPreviewPageZoom(guest, { width: () => width, canFit: () => eligible, changed })

  return {
    guest,
    zoom,
    changed,
    resize(next: number) {
      width = next
    },
    allow(next: boolean) {
      eligible = next
    }
  }
}

it('fits fixed desktop overflow without compounding zoom on subsequent measurements or resize', async () => {
  const { guest, zoom, resize } = page(1000)
  await zoom.refresh()
  expect(guest.getZoomFactor()).toBeCloseTo(0.6)
  await zoom.refresh()
  expect(guest.getZoomFactor()).toBeCloseTo(0.6)
  resize(800)
  await zoom.refresh()
  expect(guest.getZoomFactor()).toBeCloseTo(0.8)
  resize(1200)
  await zoom.refresh()
  expect(guest.getZoomFactor()).toBe(1)
  expect(guest.setZoomMode).toHaveBeenCalledExactlyOnceWith('isolated')
})

it('retains actual size for responsive pages and a readable floor for extreme overflow', async () => {
  const responsive = page()
  await responsive.zoom.refresh()
  responsive.resize(300)
  await responsive.zoom.refresh()
  expect(responsive.guest.getZoomFactor()).toBe(1)
  const huge = page(6000)
  await huge.zoom.refresh()
  expect(huge.guest.getZoomFactor()).toBe(0.5)
})

it('holds manual intent across resize and navigation until the user explicitly returns to fit', async () => {
  const { guest, zoom, resize } = page(1000)
  await zoom.refresh()
  await zoom.set(1.25)
  resize(800)
  zoom.invalidate(true)
  await zoom.refresh()
  expect(guest.getZoomFactor()).toBe(1.25)
  expect(zoom.mode).toBe('manual')
  await zoom.set('fit')
  expect(guest.getZoomFactor()).toBeCloseTo(0.8)
  expect(zoom.mode).toBe('fit')
  await zoom.set(100)
  expect(guest.getZoomFactor()).toBe(3)
  await zoom.set(0.01)
  expect(guest.getZoomFactor()).toBe(0.25)
})

it('does not fit while hidden or awaiting approval, including a read already in flight', async () => {
  const { guest, zoom, allow } = page(1000)
  let finish!: (value: { viewport: number; width: number }) => void
  guest.executeJavaScript.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  const pending = zoom.refresh()
  allow(false)
  finish({ viewport: 600, width: 1000 })
  await pending
  expect(guest.getZoomFactor()).toBe(1)
  await zoom.refresh()
  expect(guest.executeJavaScript).toHaveBeenCalledOnce()
  allow(true)
  await zoom.refresh()
  expect(guest.getZoomFactor()).toBeCloseTo(0.6)
})

it('discards delayed page widths after a newer manual choice, page or owner replaces them', async () => {
  const { guest, zoom } = page(1000)
  let finish!: (value: { viewport: number; width: number }) => void
  guest.executeJavaScript.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  const pending = zoom.refresh()
  await zoom.set(1.25)
  finish({ viewport: 600, width: 1000 })
  await pending
  expect(guest.getZoomFactor()).toBe(1.25)
  expect(zoom.mode).toBe('manual')
  await zoom.set('fit')
  guest.executeJavaScript.mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve
    })
  )
  const obsolete = zoom.refresh()
  zoom.invalidate(true)
  finish({ viewport: 1000, width: 6000 })
  await obsolete
  await zoom.refresh()
  expect(guest.getZoomFactor()).toBeCloseTo(0.6)
})

it('can fit a replacement page even when Chromium never settles the retired document measurement', async () => {
  const { guest, zoom } = page(1000)
  guest.executeJavaScript.mockReturnValueOnce(new Promise(() => {}))
  void zoom.refresh()
  zoom.invalidate(true)
  await zoom.refresh()
  expect(guest.getZoomFactor()).toBeCloseTo(0.6)
  expect(guest.executeJavaScript).toHaveBeenCalledTimes(2)
})

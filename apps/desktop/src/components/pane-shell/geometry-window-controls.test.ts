import { afterEach, expect, it } from 'vitest'

import { $zoomPercent } from '@/store/zoom'

import { intersect, windowControlsRect } from './geometry'

const originalDesktop = Object.getOwnPropertyDescriptor(window, 'hermesDesktop')
const originalOverlay = Object.getOwnPropertyDescriptor(navigator, 'windowControlsOverlay')

afterEach(() => {
  $zoomPercent.set(100)

  if (originalDesktop) {
    Object.defineProperty(window, 'hermesDesktop', originalDesktop)
  } else {
    Reflect.deleteProperty(window, 'hermesDesktop')
  }

  if (originalOverlay) {
    Object.defineProperty(navigator, 'windowControlsOverlay', originalOverlay)
  } else {
    Reflect.deleteProperty(navigator, 'windowControlsOverlay')
  }
})

it('converts native caption reservation to viewport coordinates at 90% zoom', () => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: {} })
  $zoomPercent.set(90)

  expect(windowControlsRect({ nativeOverlayWidth: 144, windowButtonPosition: null }, 1000)).toEqual({
    x: 840,
    y: 0,
    width: 160,
    height: 44
  })
})

it('prefers the measured overlay width without scaling CSS pixels again at 90% zoom', () => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { zoom: { factor: () => 0.9 } } })
  Object.defineProperty(navigator, 'windowControlsOverlay', {
    configurable: true,
    value: {
      visible: true,
      getTitlebarAreaRect: () => new DOMRect(0, 0, window.innerWidth - 177, 44)
    }
  })

  expect(windowControlsRect({ nativeOverlayWidth: 144, windowButtonPosition: null }, window.innerWidth)).toEqual({
    x: window.innerWidth - 177,
    y: 0,
    width: 177,
    height: 44
  })
})

it('keeps custom renderer caption controls in CSS pixels at 90% zoom', () => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { zoom: { factor: () => 0.9 } } })

  expect(
    windowControlsRect({ nativeOverlayWidth: 138, windowButtonPosition: null, customWindowControls: true }, 1000)
  ).toEqual({ x: 862, y: 0, width: 138, height: 44 })
})

it('reserves the lower edge of native caption controls when a pane crosses y=38', () => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: {} })

  const controls = windowControlsRect({ nativeOverlayWidth: 144, windowButtonPosition: null }, 1000)

  expect(controls).not.toBeNull()
  expect(intersect(controls!, { x: 850, y: 38, width: 150, height: 20 })).toEqual({
    x: 856,
    y: 38,
    width: 144,
    height: 6
  })
})

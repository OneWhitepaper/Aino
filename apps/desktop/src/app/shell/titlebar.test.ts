import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TITLEBAR_CONTROL_OFFSET_X,
  TITLEBAR_CONTROL_SIZE,
  TITLEBAR_EDGE_INSET,
  TITLEBAR_FALLBACK_WINDOW_BUTTON_X,
  TITLEBAR_HEIGHT,
  TITLEBAR_ICON_SIZE,
  titlebarControlsPosition,
  titlebarIconSizeCss,
  titlebarToolsRightCss,
  titlebarToolsWidthCss
} from './titlebar'

describe('titlebar sizing', () => {
  it('uses the Aino 43px chrome row with 24×24 hit targets and 18px glyphs', () => {
    expect(TITLEBAR_HEIGHT).toBe(43)
    expect(TITLEBAR_CONTROL_SIZE).toBe(24)
    expect(TITLEBAR_ICON_SIZE).toBe(18)
    expect(titlebarIconSizeCss()).toBe('18px')
  })

  it('reserves the visible four-pixel rhythm between right-side tools', () => {
    expect(titlebarToolsWidthCss(4)).toBe('calc(4 * var(--titlebar-control-size) + 3 * 4px)')
  })
})

describe('titlebarControlsPosition', () => {
  afterEach(() => vi.restoreAllMocks())

  it('aligns the left toolbar with the compact traffic-light group', () => {
    expect(titlebarControlsPosition({ x: 15, y: 10 }).left).toBe(80)
  })

  it.each([0.9, 1, 1.2])('aligns both toolbar axes with native coordinates at %s zoom', zoomFactor => {
    for (const y of [10, 15]) {
      const nativePosition = { x: 12, y }
      const controls = titlebarControlsPosition(nativePosition, false, zoomFactor)

      expect((controls.top + TITLEBAR_CONTROL_SIZE / 2) * zoomFactor).toBeCloseTo(nativePosition.y + 7)
      expect(controls.left * zoomFactor).toBeCloseTo(nativePosition.x + TITLEBAR_CONTROL_OFFSET_X)
    }
  })

  it('pins to the edge when macOS fullscreen hides traffic lights', () => {
    const position = titlebarControlsPosition({ x: 24, y: 10 }, true)
    expect(position.left).toBe(TITLEBAR_EDGE_INSET)
    expect(position.top + TITLEBAR_CONTROL_SIZE / 2).toBe(TITLEBAR_HEIGHT / 2)
  })

  it('keeps enlarged controls fully inside the window at extreme zoom', () => {
    expect(titlebarControlsPosition({ x: 12, y: 15 }, false, 2).top).toBe(0)
    expect(titlebarControlsPosition({ x: 12, y: 15 }, false, 5).top).toBe(0)
  })

  it('pins to the edge on Windows/Linux where native controls render on the right', () => {
    const position = titlebarControlsPosition(null)
    expect(position.left).toBe(TITLEBAR_EDGE_INSET)
    expect(position.top + TITLEBAR_CONTROL_SIZE / 2).toBe(TITLEBAR_HEIGHT / 2)
  })

  it('does not move macOS tools when the native traffic-light position arrives', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    expect(titlebarControlsPosition(undefined)).toEqual(
      titlebarControlsPosition({ x: TITLEBAR_FALLBACK_WINDOW_BUTTON_X, y: 15 })
    )
  })

  it.each(['Win32', 'Linux x86_64'])('preserves the previous startup spacing on %s', platform => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform)
    expect(titlebarControlsPosition(undefined).left).toBe(24 + TITLEBAR_CONTROL_OFFSET_X)
  })
})

describe('titlebarToolsRightCss', () => {
  it('reserves the native overlay width when present', () => {
    expect(titlebarToolsRightCss(144)).toBe('144px')
  })

  it('matches the left edge inset on macOS fullscreen', () => {
    expect(titlebarToolsRightCss(0, { darwinMajor: 25, isFullscreen: true })).toBe(`${TITLEBAR_EDGE_INSET}px`)
  })

  it('keeps the design-aligned macOS chrome inset otherwise', () => {
    expect(titlebarToolsRightCss(0)).toBe('17px')
  })
})

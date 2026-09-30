import { describe, expect, it } from 'vitest'

import {
  MACOS_TAHOE_DARWIN_MAJOR,
  TITLEBAR_CONTROL_OFFSET_X,
  TITLEBAR_CONTROL_SIZE,
  TITLEBAR_EDGE_INSET,
  TITLEBAR_FALLBACK_WINDOW_BUTTON_X,
  TITLEBAR_HEIGHT,
  TITLEBAR_ICON_SIZE,
  TITLEBAR_MAC_TRAFFIC_LIGHTS_Y_NUDGE,
  titlebarControlsPosition,
  titlebarControlsYNudge,
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
  it('aligns the left toolbar with the compact traffic-light group', () => {
    expect(titlebarControlsPosition({ x: 15, y: 10 }).left).toBe(80)
  })

  it('pins to the edge when macOS fullscreen hides traffic lights', () => {
    expect(titlebarControlsPosition({ x: 24, y: 10 }, true).left).toBe(TITLEBAR_EDGE_INSET)
  })

  it('pins to the edge on Windows/Linux where native controls render on the right', () => {
    expect(titlebarControlsPosition(null).left).toBe(TITLEBAR_EDGE_INSET)
  })

  it('uses the macOS fallback while the initial window state is unknown', () => {
    expect(titlebarControlsPosition(undefined).left).toBe(TITLEBAR_FALLBACK_WINDOW_BUTTON_X + TITLEBAR_CONTROL_OFFSET_X)
  })
})

describe('titlebarControlsYNudge', () => {
  it('nudges pre-Tahoe macOS when traffic lights are visible', () => {
    expect(titlebarControlsYNudge({ windowButtonPosition: { x: 24, y: 10 }, darwinMajor: 24 })).toBe(
      TITLEBAR_MAC_TRAFFIC_LIGHTS_Y_NUDGE
    )
  })

  it('keeps the optical nudge on Tahoe but stays flat on Windows/Linux and macOS fullscreen', () => {
    expect(
      titlebarControlsYNudge({ windowButtonPosition: { x: 24, y: 10 }, darwinMajor: MACOS_TAHOE_DARWIN_MAJOR })
    ).toBe(TITLEBAR_MAC_TRAFFIC_LIGHTS_Y_NUDGE)
    expect(titlebarControlsYNudge({ windowButtonPosition: null })).toBe('0px')
    expect(titlebarControlsYNudge({ windowButtonPosition: { x: 24, y: 10 }, isFullscreen: true })).toBe('0px')
  })

  it('nudges while macOS window-button position is still unknown on pre-Tahoe', () => {
    expect(titlebarControlsYNudge({ darwinMajor: 24 })).toBe(TITLEBAR_MAC_TRAFFIC_LIGHTS_Y_NUDGE)
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

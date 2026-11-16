import { describe, expect, it } from 'vitest'

import type { Contribution } from '@/contrib/types'

import { group } from '../model'
import { TOOL_PANEL_DEFAULT_WIDTH } from '../tool-panel-policy'

import { fixedTrackSize, sizingPaneIds, type TrackContext } from './track-model'

const files: Contribution = {
  id: 'files',
  area: 'panes',
  data: { toolPanel: true, placement: 'right', width: TOOL_PANEL_DEFAULT_WIDTH }
}

const browser: Contribution = {
  id: 'preview-tile:page',
  area: 'panes',
  data: { toolPanel: true, placement: 'right' }
}

const ctx = (hidden: string[] = [], overrides: TrackContext['overrides'] = {}): TrackContext => ({
  paneFor: id => [files, browser].find(pane => pane.id === id),
  paneGone: id => hidden.includes(id),
  overrides
})

describe('shared desktop tool width', () => {
  it('keeps the default or user-sized host width when tools are revealed and hidden', () => {
    const browserOnly = group([browser.id])
    const tools = group([files.id, browser.id])
    const saved = { files: { widthOverride: 516 } }

    expect(fixedTrackSize(browserOnly, 'row', ctx())).toBe(TOOL_PANEL_DEFAULT_WIDTH)
    expect(fixedTrackSize(tools, 'row', ctx([files.id]))).toBe(TOOL_PANEL_DEFAULT_WIDTH)
    expect(fixedTrackSize(tools, 'row', ctx())).toBe(TOOL_PANEL_DEFAULT_WIDTH)
    expect(fixedTrackSize(tools, 'row', ctx([files.id], saved))).toBe('516px')
    expect(fixedTrackSize(tools, 'row', ctx([], saved))).toBe('516px')
    expect(sizingPaneIds(tools, 'row', ctx([files.id], saved))).toEqual([files.id, browser.id])
    expect(sizingPaneIds(tools, 'column', ctx([files.id], saved))).toEqual([browser.id])
    expect(saved.files.widthOverride).toBe(516)
    expect(
      fixedTrackSize(group([browser.id, 'hermes-bots:routines']), 'row', ctx([], { 'hermes-bots:routines': saved.files }))
    ).toBe('516px')
  })
})

import { beforeEach, describe, expect, it } from 'vitest'

import {
  $sidebarGrouping,
  $sidebarOrdering,
  $sidebarRecentGrouping,
  $sidebarRowMeta,
  $sidebarShowAllSessions,
  $sidebarViewCustomized,
  $sidebarWidth,
  resetSidebarView,
  setSidebarAgentsGrouped,
  setSidebarGrouping,
  setSidebarOrdering,
  setSidebarShowAllSessions,
  setSidebarWidth,
  CHAT_SIDEBAR_PANE_ID,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
  toggleSidebarRowMeta,
  toggleSidebarStatusFilter
} from './layout'
import { setPaneWidthOverride } from './panes'
import { $showAllProfiles } from './profile'

beforeEach(() => {
  $showAllProfiles.set(false)
  resetSidebarView()
})

describe('the sidebar as it ships', () => {
  it('preserves Recent grouping when project navigation activates the legacy project view', () => {
    setSidebarGrouping('status')
    setSidebarAgentsGrouped(true)
    expect($sidebarRecentGrouping.get()).toBe('status')
    setSidebarGrouping('profile')
    setSidebarAgentsGrouped(true)
    expect($sidebarRecentGrouping.get()).toBe('profile')
  })

  it('clamps the sessions rail to its supported minimum', () => {
    setSidebarWidth(0)

    expect($sidebarWidth.get()).toBe(SIDEBAR_MIN_WIDTH)
  })

  it('uses the default only without a saved width and preserves narrower saved layouts', () => {
    setPaneWidthOverride(CHAT_SIDEBAR_PANE_ID, undefined)
    expect($sidebarWidth.get()).toBe(SIDEBAR_DEFAULT_WIDTH)

    const savedWidth = (SIDEBAR_MIN_WIDTH + SIDEBAR_DEFAULT_WIDTH) / 2
    setPaneWidthOverride(CHAT_SIDEBAR_PANE_ID, savedWidth)
    expect($sidebarWidth.get()).toBe(savedWidth)
    setSidebarWidth(savedWidth)
    expect($sidebarWidth.get()).toBe(savedWidth)
  })

  it('remembers expanded project previews across grouping changes and clears them on reset', () => {
    expect($sidebarShowAllSessions.get()).toBe(false)
    setSidebarGrouping('project')
    setSidebarShowAllSessions(true)
    setSidebarGrouping('date')

    expect($sidebarShowAllSessions.get()).toBe(true)
    expect($sidebarViewCustomized.get()).toBe(true)
    expect(window.localStorage.getItem('hermes.desktop.sidebarShowAllSessions')).toBe('true')

    resetSidebarView()

    expect($sidebarShowAllSessions.get()).toBe(false)
    expect($sidebarViewCustomized.get()).toBe(false)
    expect(window.localStorage.getItem('hermes.desktop.sidebarShowAllSessions')).toBe('false')
  })

  it('groups by date, sorts by recency, and pins the timestamp and preview', () => {
    expect($sidebarGrouping.get()).toBe('date')
    expect($sidebarOrdering.get()).toBe('updated')
    expect($sidebarRowMeta.get()).toEqual(['preview', 'updated'])
  })

  it('offers no reset until something actually moves off the defaults', () => {
    expect($sidebarViewCustomized.get()).toBe(false)

    toggleSidebarRowMeta('tokens')

    expect($sidebarViewCustomized.get()).toBe(true)
  })

  it('is what reset puts back — every knob, not just the filters', () => {
    setSidebarGrouping('project')
    setSidebarOrdering('cost')
    toggleSidebarRowMeta('updated')
    toggleSidebarRowMeta('cost')
    toggleSidebarStatusFilter('working')

    resetSidebarView()

    expect($sidebarGrouping.get()).toBe('date')
    expect($sidebarOrdering.get()).toBe('updated')
    expect($sidebarRowMeta.get()).toEqual(['preview', 'updated'])
    expect($sidebarViewCustomized.get()).toBe(false)
  })

  it('ships by date in the all-profiles scope too, and resets back to it', () => {
    $showAllProfiles.set(true)
    setSidebarGrouping('profile')

    resetSidebarView()

    expect($sidebarGrouping.get()).toBe('date')
    expect($sidebarViewCustomized.get()).toBe(false)
  })

  it('resets the scope the user is not looking at, so flipping the rail cannot restore it', () => {
    setSidebarGrouping('status')
    $showAllProfiles.set(true)
    setSidebarGrouping('profile')

    resetSidebarView()
    $showAllProfiles.set(false)

    expect($sidebarGrouping.get()).toBe('date')
  })

  it('turns all-profiles on when the user groups by profile, since that is the ask', () => {
    setSidebarGrouping('profile')

    expect($showAllProfiles.get()).toBe(true)
    expect($sidebarGrouping.get()).toBe('profile')
  })
})

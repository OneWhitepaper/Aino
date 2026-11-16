import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { $showHiddenBots } from './hidden-bots'
import { botsText } from './i18n'
import { translateBots } from './i18n-test-helper'
import { setActivityToasts } from './roster-actions'
import { renderRosterSearch } from './roster-pane-toolbar'

vi.mock('@hermes/plugin-sdk', async importOriginal => ({
  ...(await importOriginal<typeof HermesSdk>()),
  usePluginI18n: () => translateBots
}))
vi.mock('./roster-actions', () => ({ setActivityToasts: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  $showHiddenBots.set(false)
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

it('keeps hidden bots reachable from roster options without changing the current filters', async () => {
  const props = renderSearch()
  fireEvent.keyDown(screen.getByRole('button', { name: botsText().roster.filterRoster }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: botsText().navigation.hiddenBots }))
  expect($showHiddenBots.get()).toBe(true)
  expect(props.setRowKindFilter).not.toHaveBeenCalled()
  expect(props.setActivityFilter).not.toHaveBeenCalled()
})
afterEach(cleanup)

function renderSearch(overrides: Partial<Parameters<typeof renderRosterSearch>[0]> = {}) {
  const props: Parameters<typeof renderRosterSearch>[0] = {
    b: botsText(),
    activityToasts: false,
    activeSourceRoster: [],
    roster: [],
    setCreateOpen: vi.fn(),
    setGroupCreateOpen: vi.fn(),
    setSectionDialog: vi.fn(),
    showRosterTools: true,
    showRosterSearch: true,
    showRosterFilters: false,
    query: '',
    setQuery: vi.fn(),
    activeFilterCount: 0,
    gatewayOptions: [],
    rowKindFilter: 'all',
    setRowKindFilter: vi.fn(),
    activityFilter: 'all',
    setActivityFilter: vi.fn(),
    gatewayFilter: 'all',
    setGatewayFilter: vi.fn(),
    ...overrides
  }

  render(renderRosterSearch(props))

  return props
}

it.each([false, true])('keeps activity reminders reachable for a small roster when enabled=%s', async enabled => {
  renderSearch({ activityToasts: enabled })

  fireEvent.keyDown(screen.getByRole('button', { name: botsText().roster.filterRoster }), { key: 'Enter' })
  fireEvent.click(
    await screen.findByRole('menuitem', {
      name: enabled ? botsText().roster.activityToastsOn : botsText().roster.activityToastsOff
    })
  )

  expect(setActivityToasts).toHaveBeenCalledExactlyOnceWith(!enabled)
})

it('keeps kind tabs and activity filters wired to the existing roster state', async () => {
  const props = renderSearch({ showRosterFilters: true })

  fireEvent.click(screen.getByRole('button', { name: botsText().roster.groupChats }))
  expect(props.setRowKindFilter).toHaveBeenCalledExactlyOnceWith('groups')

  fireEvent.keyDown(screen.getByRole('button', { name: botsText().roster.filterRoster }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: botsText().roster.activeNow }))
  expect(props.setActivityFilter).toHaveBeenCalledExactlyOnceWith('active')
})

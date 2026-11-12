import type * as HermesSdk from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import type { GatewayGroupRoom } from './canonical-group-registry'
import { botsText } from './i18n'
import { translateBotsIn } from './i18n-test-helper'
import { renderRosterContent } from './roster-pane-content'
import { deriveRosterRows } from './roster-pane-derivation'
import { rosterSectionRenderers } from './roster-pane-sections'

vi.mock('@hermes/plugin-sdk', async importOriginal => ({
  ...(await importOriginal<typeof HermesSdk>()),
  usePluginI18n: () => translateBotsIn('en')
}))

const room = (name: string, updatedAt: number): GatewayGroupRoom => ({
  binding: { connectionId: 'local', profile: 'default', roomId: name, roomName: name },
  key: `canonical:local:default:${name}`,
  members: [],
  name,
  room: { room_id: name, name, members: [] },
  updatedAt
})

function renderCategories(overrides: Partial<Parameters<typeof deriveRosterRows>[0]> = {}) {
  const b = botsText()

  const input: Parameters<typeof deriveRosterRows>[0] = {
    roster: [
      { name: 'Writer', canonical_session: { last_active: 30 } },
      { name: 'Researcher', canonical_session: { last_active: 10 } }
    ],
    allMeta: {},
    gatewayFilter: 'all',
    query: '',
    activityFilter: 'all',
    rowKindFilter: 'all',
    groupRooms: {},
    gatewayRooms: [room('Launch team', 40), room('Planning team', 20)],
    gatewayRoomLive: {},
    activeRosterKeys: new Set(),
    gatewayOptions: [],
    activityOf: bot => bot.canonical_session?.last_active ?? 0,
    isPinned: () => false,
    ...overrides
  }

  const rows = deriveRosterRows(input)
  const openBot = vi.fn()
  const openGroup = vi.fn()

  const renderBotRow = (bot: (typeof input.roster)[number]) => (
    <button key={bot.name} onClick={() => openBot(bot)}>
      {bot.name}
    </button>
  )

  const sections = rosterSectionRenderers({
    b,
    userSections: [],
    roster: input.roster,
    allMeta: {},
    groupRooms: {},
    dragging: null,
    // A saved fold for the former group category must not hide the new list.
    rosterSectionCollapsed: () => true,
    toggleRosterSection: vi.fn(),
    setSectionDialog: vi.fn(),
    renderBotRow,
    renderGroupRow: row => (
      <button key={row.gateway?.key ?? row.name} onClick={() => openGroup(row)}>
        {row.name}
      </button>
    ),
    sortedGroupRows: rows.sortedGroupRows
  })

  render(
    renderRosterContent({
      b,
      staleNotice: null,
      isLoading: false,
      initialRosterLoading: false,
      listedCount: input.roster.length + input.gatewayRooms.length,
      error: null,
      gatewayUp: true,
      refetch: vi.fn(),
      allBotsHidden: false,
      hiddenExpanded: false,
      ...rows,
      matchingHiddenBots: [],
      query: input.query,
      selectedGateway: undefined,
      showHiddenSection: false,
      hiddenSectionRef: createRef<HTMLDivElement>(),
      hasRosterConstraint: Boolean(input.query),
      hiddenBots: [],
      showHiddenRows: false,
      hiddenGatewaySections: { sectioned: false, sections: [] },
      renderBotRow,
      ...sections
    })
  )

  return { openBot, openGroup }
}

afterEach(cleanup)

it('keeps robots and group chats in visible parallel lists with their original order and open actions', () => {
  const { openBot, openGroup } = renderCategories()
  const bots = screen.getByRole('region', { name: 'Bots' })
  const groups = screen.getByRole('region', { name: 'Group chats' })

  expect(
    within(bots)
      .getAllByRole('button')
      .map(row => row.textContent)
  ).toEqual(['Writer', 'Researcher'])
  expect(
    within(groups)
      .getAllByRole('button')
      .map(row => row.textContent)
  ).toEqual(['Launch team', 'Planning team'])
  expect(within(groups).getByRole('heading', { name: 'Group chats' })).toBeTruthy()
  expect(screen.getAllByRole('button')).toHaveLength(4)

  fireEvent.click(within(bots).getByRole('button', { name: 'Researcher' }))
  fireEvent.click(within(groups).getByRole('button', { name: 'Launch team' }))
  expect(openBot).toHaveBeenCalledWith(expect.objectContaining({ name: 'Researcher' }))
  expect(openGroup).toHaveBeenCalledWith(
    expect.objectContaining({ gateway: expect.objectContaining({ name: 'Launch team' }) })
  )
})

it.each([
  { query: 'team', rowKindFilter: 'all' as const, category: 'Group chats', names: ['Launch team', 'Planning team'] },
  { query: '', rowKindFilter: 'bots' as const, category: 'Bots', names: ['Writer', 'Researcher'] }
])('preserves search and kind filtering in the $category category', ({ category, names, query, rowKindFilter }) => {
  renderCategories({ query, rowKindFilter })

  expect(
    within(screen.getByRole('region', { name: category }))
      .getAllByRole('button')
      .map(row => row.textContent)
  ).toEqual(names)
  expect(screen.getAllByRole('region')).toHaveLength(1)
  expect(screen.getAllByRole('button')).toHaveLength(names.length)
})

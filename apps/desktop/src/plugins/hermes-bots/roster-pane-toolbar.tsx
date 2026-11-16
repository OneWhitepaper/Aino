import {
  Button,
  cn,
  Codicon,
  Contribute,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  host,
  SearchField,
  Tip,
  useValue
} from '@hermes/plugin-sdk'

import {
  connectionName,
  groupSelectionElsewhere,
  seatableGroupBots,
  useGroupCapability
} from './canonical-group-capabilities'
import { botSourceStatus } from './data'
import { $showHiddenBots } from './hidden-bots'
import type { useBots } from './i18n'
import { setActivityToasts } from './roster-actions'
import { GatewayKindGlyph } from './roster-sections'
import type { rosterGatewayOptions } from './roster-sections'
import type { RosterActivityFilter, RosterKindFilter, RosterRow } from './types'

function HiddenBotsItem({ b }: { b: ReturnType<typeof useBots> }) {
  const visible = useValue($showHiddenBots)

  return (
    <DropdownMenuItem onSelect={() => $showHiddenBots.set(!visible)}>
      <Codicon className="mr-1.5" name="eye" />
      <span className="min-w-0 flex-1">{b.navigation.hiddenBots}</span>
      {visible ? <Codicon name="check" /> : null}
    </DropdownMenuItem>
  )
}

export function CreateGroupChatButton({
  b,
  roster,
  onCreate
}: {
  b: ReturnType<typeof useBots>
  roster: RosterRow[]
  onCreate: () => void
}) {
  const { connectionId, mode, seatable } = useGroupCapability(true)
  const candidates = seatableGroupBots(roster, { connectionId, mode, seatable })
  const disabled = candidates.length < 2 || (mode === 'canonical' && groupSelectionElsewhere(candidates, connectionId))

  return (
    <Tip label={b.group.newTitle}>
      <Button aria-label={b.group.newTitle} disabled={disabled} onClick={onCreate} size="icon-xs" variant="ghost">
        <Codicon name="add" />
      </Button>
    </Tip>
  )
}

interface NewGroupChatItemProps {
  label: string
  /** The dialog's "these bots all live on <connection>" note. */
  elsewhereNote: (connection: string) => string
  onSelect: () => void
  roster: RosterRow[]
}

/** Mounted only while the menu is open, so the capability read happens on
 *  demand. Offered only when the dialog it opens can create a room: two
 *  seatable bots by the same predicate the dialog's picker uses, and not all of
 *  them on ONE other connection (every selection there is refused, so the item
 *  says why instead of opening a dead Create button). */
function NewGroupChatItem({ elsewhereNote, label, onSelect, roster }: NewGroupChatItemProps) {
  const { connectionId, mode, seatable } = useGroupCapability(true)
  const seatableBots = seatableGroupBots(roster, { connectionId, mode, seatable })
  const elsewhere = mode === 'canonical' && groupSelectionElsewhere(seatableBots, connectionId)

  return (
    <DropdownMenuItem disabled={seatableBots.length < 2 || elsewhere} onSelect={onSelect}>
      <Codicon className="mr-1.5" name="organization" />
      {elsewhere ? (
        <span className="grid gap-0.5">
          <span>{label}</span>
          <span className="text-xs text-(--ui-text-secondary)" role="note">
            {elsewhereNote(connectionName(seatableBots[0]))}
          </span>
        </span>
      ) : (
        label
      )}
    </DropdownMenuItem>
  )
}

interface renderRosterToolbarProps {
  b: ReturnType<typeof useBots>
  allLabel?: string
  listedBotCount?: number
  projectHeaderActions?: boolean
  activityToasts: boolean
  activeSourceRoster: RosterRow[]
  /** Full roster; New Group Chat seats only `seatableGroupBots` of it. */
  roster: RosterRow[]
  setCreateOpen: (value: boolean) => void
  setGroupCreateOpen: (value: boolean) => void
  setSectionDialog: (
    value: null | { bot?: RosterRow; mode: 'create' } | { id: string; mode: 'rename'; name: string }
  ) => void
  showRosterTools: boolean
  showRosterSearch: boolean
  showRosterFilters: boolean
  query: string
  setQuery: (value: string) => void
  activeFilterCount: number
  gatewayOptions: ReturnType<typeof rosterGatewayOptions>
  rowKindFilter: RosterKindFilter
  setRowKindFilter: (value: RosterKindFilter) => void
  activityFilter: RosterActivityFilter
  setActivityFilter: (value: RosterActivityFilter) => void
  gatewayFilter: string
  setGatewayFilter: (value: string) => void
}

export function renderRosterToolbar({
  b,
  listedBotCount,
  projectHeaderActions = false,
  rowKindFilter,
  roster,
  setCreateOpen,
  setGroupCreateOpen
}: renderRosterToolbarProps) {
  const createMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={b.roster.newBotOrGroup} size="icon-xs" variant="ghost">
          <Codicon name="add" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
          <Codicon className="mr-1.5" name="hubot" />
          {b.bot.newTitle}
        </DropdownMenuItem>
        <NewGroupChatItem
          elsewhereNote={b.crossGateway.selectionElsewhere}
          label={b.group.newTitle}
          onSelect={() => setGroupCreateOpen(true)}
          roster={roster}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => host.navigate('/profiles')}>
          <Codicon className="mr-1.5" name="layout" />
          {b.navigation.manage}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      <div className="aino-roster-section-heading">
        {rowKindFilter !== 'groups' ? <h2>{b.canonical.botsHeading}</h2> : null}
        {rowKindFilter !== 'groups' && listedBotCount !== undefined ? (
          <span className="aino-roster-category-count">{listedBotCount}</span>
        ) : null}
        <div className="aino-roster-heading-actions">
          {projectHeaderActions ? (
            <Contribute area="navigation.header.actions" id="bots:new-menu">
              {createMenu}
            </Contribute>
          ) : (
            createMenu
          )}
        </div>
      </div>
    </>
  )
}

/** One search controls both gateway groups and the existing bot/legacy-group filters. */
export function renderRosterSearch({
  b,
  allLabel,
  activityToasts,
  showRosterTools,
  showRosterSearch,
  showRosterFilters,
  query,
  setQuery,
  activeFilterCount,
  gatewayOptions,
  rowKindFilter,
  setRowKindFilter,
  activityFilter,
  setActivityFilter,
  gatewayFilter,
  setGatewayFilter,
  setSectionDialog
}: renderRosterToolbarProps) {
  return (
    <>
      {showRosterTools ? (
        <div className="aino-roster-search">
          {showRosterSearch ? (
            <SearchField
              aria-label={b.roster.search}
              containerClassName="min-w-0 flex-1"
              inputClassName="w-full"
              key={'roster-search'}
              onChange={setQuery}
              placeholder={b.roster.searchPlaceholder}
              value={query}
            />
          ) : (
            <span className="min-w-0 flex-1" key={'roster-search-spacer'} />
          )}
          <DropdownMenu key={'roster-filters'}>
            <Tip label={activeFilterCount ? b.roster.filterRosterActive(activeFilterCount) : b.roster.filterRoster}>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={
                    activeFilterCount ? b.roster.filterRosterActive(activeFilterCount) : b.roster.filterRoster
                  }
                  className={cn('shrink-0', activeFilterCount && 'text-(--ui-accent)')}
                  size="icon-xs"
                  variant="ghost"
                >
                  <Codicon name="list-filter" />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end">
              <div className="aino-roster-menu-heading">{b.navigation.rosterOptions}</div>
              <DropdownMenuItem onSelect={() => host.navigate('/profiles')}>
                <Codicon className="mr-1.5" name="layout" />
                {b.navigation.manage}
              </DropdownMenuItem>
              <HiddenBotsItem b={b} />
              <DropdownMenuItem onSelect={() => setSectionDialog({ mode: 'create' })}>
                <Codicon className="mr-1.5" name="new-folder" />
                {b.sections.newSection}
              </DropdownMenuItem>
              {showRosterFilters ? <DropdownMenuSeparator /> : null}
              {showRosterFilters ? (
                <div className="aino-roster-menu-heading">{b.navigation.activityFilters}</div>
              ) : null}
              {showRosterFilters &&
                (
                  [
                    ['all', b.roster.anyActivity],
                    ['active', b.roster.activeNow],
                    ['recent', b.roster.recentlyActive],
                    ['older', b.roster.older]
                  ] as [RosterActivityFilter, string][]
                ).map(([value, label]) => (
                  <DropdownMenuItem key={`activity:${value}`} onSelect={() => setActivityFilter(value)}>
                    <span className="min-w-0 flex-1">{label}</span>
                    {activityFilter === value ? <Codicon name="check" /> : null}
                  </DropdownMenuItem>
                ))}
              {gatewayOptions.length > 1 ? <DropdownMenuSeparator /> : null}
              {gatewayOptions.length > 1 ? (
                <DropdownMenuItem onSelect={() => setGatewayFilter('all')}>
                  <Codicon className="mr-1.5" name="globe" />
                  <span className="min-w-0 flex-1">{b.roster.allGateways}</span>
                  {gatewayFilter === 'all' ? <Codicon name="check" /> : null}
                </DropdownMenuItem>
              ) : null}
              {gatewayOptions.length > 1
                ? gatewayOptions.map(option => {
                    const status = botSourceStatus({
                      sourceError: option.error,
                      sourceReachable: option.reachable
                    })

                    return (
                      <DropdownMenuItem
                        key={option.connectionId}
                        onSelect={() => setGatewayFilter(option.connectionId)}
                      >
                        <GatewayKindGlyph
                          className={cn('mr-1.5', !status.available && 'text-(--ui-yellow)')}
                          kind={option.kind}
                        />
                        <span className="min-w-0 flex-1 truncate">{option.label || option.connectionId}</span>
                        <span className="text-[length:var(--aino-text-caption)] tabular-nums text-(--ui-text-tertiary)">
                          {option.count}
                        </span>
                        {gatewayFilter === option.connectionId ? <Codicon name="check" /> : null}
                      </DropdownMenuItem>
                    )
                  })
                : []}
              {activeFilterCount ? <DropdownMenuSeparator /> : null}
              {activeFilterCount ? (
                <DropdownMenuItem
                  onSelect={() => {
                    setRowKindFilter('all')
                    setActivityFilter('all')
                    setGatewayFilter('all')
                  }}
                >
                  {b.roster.clearFilters}
                </DropdownMenuItem>
              ) : null}
              {showRosterFilters || activeFilterCount ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem onSelect={() => setActivityToasts(!activityToasts)}>
                <Codicon className="mr-1.5" name={activityToasts ? 'bell' : 'bell-slash'} />
                {activityToasts ? b.roster.activityToastsOn : b.roster.activityToastsOff}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      <div aria-label={b.roster.botsAndGroups} className="aino-roster-kind-tabs" role="group">
        {(
          [
            ['all', allLabel ?? b.roster.botsAndGroups],
            ['bots', b.canonical.botsHeading],
            ['groups', b.roster.groupChats]
          ] as [RosterKindFilter, string][]
        ).map(([value, label]) => (
          <button
            aria-pressed={rowKindFilter === value}
            key={value}
            onClick={() => setRowKindFilter(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </>
  )
}

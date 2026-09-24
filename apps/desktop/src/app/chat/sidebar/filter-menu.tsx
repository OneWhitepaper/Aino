import { useStore } from '@nanostores/react'

import { sessionDotClassName } from '@/app/chat/session-status-dot'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { desktopGit } from '@/lib/desktop-git'
import { cn } from '@/lib/utils'
import {
  $sidebarCardRows,
  $sidebarFiltersActive,
  $sidebarListGroupIds,
  $sidebarOrdering,
  $sidebarPrFilter,
  $sidebarProfileFilter,
  $sidebarProjectFilter,
  $sidebarRecentGrouping,
  $sidebarRowMeta,
  $sidebarShowAllSessions,
  $sidebarShowArchived,
  $sidebarStatusFilter,
  $sidebarViewCustomized,
  $sidebarWorkspaceNodeOpen,
  resetSidebarView,
  setSidebarCardRows,
  setSidebarGrouping,
  setSidebarOrdering,
  setSidebarShowAllSessions,
  setSidebarShowArchived,
  setWorkspaceNodesOpen,
  type SidebarGrouping,
  type SidebarOrdering,
  type SidebarRowMeta,
  toggleSidebarPrFilter,
  toggleSidebarProfileFilter,
  toggleSidebarProjectFilter,
  toggleSidebarRowMeta,
  toggleSidebarStatusFilter
} from '@/store/layout'
import { $profiles, $showAllProfiles, normalizeProfileKey } from '@/store/profile'
import { $profileRailVisible, toggleProfileRailVisible } from '@/store/profile-rail-prefs'
import { $projectTree } from '@/store/projects'
import type { PullRequestBucket } from '@/store/pull-requests'
import { $unreadFinishedSessionIds, markAllSessionsRead } from '@/store/session'
import type { SessionStatusBucket } from '@/store/session-dot-state'
import { $sessionsHaveCost } from '@/store/sidebar-archive'

interface Option<T extends string = string> {
  /** A status dot's full className, from the row's own vocabulary. */
  dot?: string
  icon?: string
  id: T
  labelKey: string
}

interface LabeledOption<T extends string = string> extends Omit<Option<T>, 'labelKey'> {
  label: string
}

const GROUPINGS: Option<SidebarGrouping>[] = [
  { icon: 'clock', id: 'date', labelKey: 'updated' },
  { icon: 'pulse', id: 'status', labelKey: 'status' },
  { icon: 'account', id: 'profile', labelKey: 'profile' }
]

const ORDERINGS: Option<SidebarOrdering>[] = [
  { icon: 'clock', id: 'updated', labelKey: 'updated' },
  { icon: 'add', id: 'created', labelKey: 'created' },
  { icon: 'pulse', id: 'status', labelKey: 'status' },
  { icon: 'symbol-numeric', id: 'tokens', labelKey: 'tokens' },
  { icon: 'credit-card', id: 'cost', labelKey: 'cost' },
  { icon: 'list-ordered', id: 'manual', labelKey: 'manual' }
]

const ROW_META: Option<SidebarRowMeta>[] = [
  { icon: 'clock', id: 'updated', labelKey: 'updated' },
  { icon: 'comment', id: 'preview', labelKey: 'preview' },
  { icon: 'symbol-numeric', id: 'tokens', labelKey: 'tokens' },
  { icon: 'credit-card', id: 'cost', labelKey: 'cost' },
  { icon: 'git-pull-request', id: 'pr', labelKey: 'pr' },
  { icon: 'account', id: 'profile', labelKey: 'profile' }
]

const PR_FILTERS: Option<PullRequestBucket>[] = [
  { icon: 'git-pull-request', id: 'open', labelKey: 'open' },
  { icon: 'git-pull-request-draft', id: 'draft', labelKey: 'draft' },
  { icon: 'git-merge', id: 'merged', labelKey: 'merged' },
  { icon: 'git-pull-request-closed', id: 'closed', labelKey: 'closed' },
  { icon: 'circle-slash', id: 'none', labelKey: 'noPr' }
]

const STATUS_FILTERS: Option<SessionStatusBucket>[] = [
  { dot: sessionDotClassName('needs-input'), id: 'needs-input', labelKey: 'needsInput' },
  { dot: sessionDotClassName('working'), id: 'working', labelKey: 'working' },
  { dot: sessionDotClassName('unread'), id: 'unread', labelKey: 'unread' },
  { dot: sessionDotClassName('draft'), id: 'draft', labelKey: 'draft' },
  { dot: cn(sessionDotClassName('idle'), 'bg-(--ui-text-quaternary)'), id: 'idle', labelKey: 'idle' }
]

function OptionGlyph({ option }: { option: Pick<Option, 'dot' | 'icon'> }) {
  if (option.dot) {
    return <span aria-hidden="true" className={cn('shrink-0', option.dot)} />
  }

  return option.icon ? <Codicon className="text-(--ui-text-tertiary)" name={option.icon} size="0.8125rem" /> : null
}

export function localizeFilterOption<T extends string>(
  option: Option<T>,
  labels: Record<string, string>
): LabeledOption<T> {
  return { ...option, label: labels[option.labelKey] ?? option.labelKey }
}

/** Every option row — single or multi select — leaves the menu open, so a whole
 *  view can be set up in one pass. Only the actions at the bottom dismiss it. */
const keepOpen = (event: Event) => event.preventDefault()

function OptionCheckbox({
  checked,
  onCheck,
  option
}: {
  checked: boolean
  onCheck: () => void
  option: LabeledOption
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onSelect={event => {
        keepOpen(event)
        onCheck()
      }}
    >
      <OptionGlyph option={option} />
      {option.label}
    </DropdownMenuCheckboxItem>
  )
}

function OptionRadio({ option }: { option: LabeledOption }) {
  return (
    <DropdownMenuRadioItem onSelect={keepOpen} value={option.id}>
      <OptionGlyph option={option} />
      {option.label}
    </DropdownMenuRadioItem>
  )
}

export function SidebarFilterMenu({
  className,
  onImportSession
}: {
  className?: string
  onImportSession?: () => void
}) {
  const { t } = useI18n()
  const recentGrouping = useStore($sidebarRecentGrouping)
  const ordering = useStore($sidebarOrdering)
  const rowMeta = useStore($sidebarRowMeta)
  const cardRows = useStore($sidebarCardRows)
  const profileRailVisible = useStore($profileRailVisible)
  const showAllSessions = useStore($sidebarShowAllSessions)
  const statusFilter = useStore($sidebarStatusFilter)
  const projectFilter = useStore($sidebarProjectFilter)
  const profileFilter = useStore($sidebarProfileFilter)
  const showAllProfiles = useStore($showAllProfiles)
  const profileNames = useStore($profiles).map(profile => normalizeProfileKey(profile.name))
  const narrowsByProfile = showAllProfiles && profileNames.length > 1
  const prFilter = useStore($sidebarPrFilter)
  const showArchived = useStore($sidebarShowArchived)
  const filtersActive = useStore($sidebarFiltersActive)
  const viewCustomized = useStore($sidebarViewCustomized)
  const nodeOpen = useStore($sidebarWorkspaceNodeOpen)
  const listGroupIds = useStore($sidebarListGroupIds)
  const projects = useStore($projectTree)
  const hasCost = useStore($sessionsHaveCost)
  const unreadIds = useStore($unreadFinishedSessionIds)
  // PR state comes from `gh` on whichever machine holds the checkout — Electron
  // locally, the gateway's REST mirror remotely. Resolved per render, not once
  // at module load: switching to a remote profile swaps the bridge underneath.
  const prAvailable = Boolean(desktopGit()?.review?.prList)
  const filterLabels = t.ui.actions.labels

  // Both sections are visible together. Never sweep Pinned, Messaging or Cron.
  const foldIds = [
    ...(!showArchived ? projects.filter(project => !project.isNoProject).map(project => project.id) : []),
    ...(recentGrouping === 'date' || recentGrouping === 'status' ? listGroupIds : [])
  ]

  const foldCollapsed = foldIds.length > 0 && foldIds.every(id => nodeOpen[id] === false)

  const groupings = GROUPINGS.map(option => ({
    ...localizeFilterOption(option, filterLabels),
    ...(option.id === 'profile' ? { label: t.sidebar.gatewayGroups.grouping } : {})
  }))

  const groupingLabel = groupings.find(option => option.id === recentGrouping)?.label

  // Two options are conditional: dragging a row is what picks manual, so it
  // only appears as a way back out once there's a hand-picked order to leave;
  // and cost is hidden until some session actually reports spend.
  const orderings = ORDERINGS.filter(option => {
    if (option.id === 'manual') {
      return ordering === 'manual'
    }

    return option.id !== 'cost' || hasCost || ordering === 'cost'
  })

  const rowMetaOptions = ROW_META.filter(option => {
    if (option.id === 'cost') {
      return hasCost || rowMeta.includes('cost')
    }

    // Preview is a card line; the one-line row has nowhere to put it.
    if (option.id === 'preview') {
      return cardRows
    }

    return option.id !== 'pr' || prAvailable
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={onImportSession ? t.sidebar.sessionOptions : t.ui.actions.filters}
          className={cn(
            className,
            'data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground data-[state=open]:opacity-100',
            // Active filters read as "this control is engaged", the same way the
            // open menu does — never as an accent, which the sidebar reserves
            // for a session that is actually doing something.
            filtersActive && 'bg-(--ui-control-active-background) text-foreground opacity-100'
          )}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Codicon name={onImportSession ? 'ellipsis' : 'list-filter'} size="0.75rem" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="min-w-52">
        {onImportSession && (
          <>
            <DropdownMenuItem onSelect={onImportSession}>
              <Codicon name="cloud-download" size="0.8125rem" />
              {t.sessionImport.action}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger hideChevron>
              {t.ui.actions.grouping}
              <span className="ml-auto flex items-center gap-1 pl-4 text-(--ui-text-tertiary)">
                {groupingLabel}
                <Codicon name="chevron-right" size="1rem" />
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={value => setSidebarGrouping(value as SidebarGrouping)}
                value={recentGrouping}
              >
                {groupings.map(option => (
                  <OptionRadio key={option.id} option={option} />
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t.ui.actions.ordering}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                onValueChange={value => setSidebarOrdering(value as SidebarOrdering)}
                value={ordering}
              >
                {orderings.map(option => (
                  <OptionRadio key={option.id} option={localizeFilterOption(option, filterLabels)} />
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t.ui.actions.show}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {rowMetaOptions.map(option => (
                <OptionCheckbox
                  checked={rowMeta.includes(option.id)}
                  key={option.id}
                  onCheck={() => toggleSidebarRowMeta(option.id)}
                  option={localizeFilterOption(option, filterLabels)}
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <OptionCheckbox
            checked={showAllSessions}
            onCheck={() => setSidebarShowAllSessions(!showAllSessions)}
            option={{ icon: 'list-unordered', id: 'all-sessions', label: t.sidebar.projects.showAllSessions }}
          />

          {/* A render variant, not a grouping: three-line cards (project · age /
              title / model · size) compose with whichever grouping is active. */}
          <OptionCheckbox
            checked={cardRows}
            onCheck={() => setSidebarCardRows(!cardRows)}
            option={{ icon: 'inbox', id: 'card-rows', label: filterLabels.cardRows }}
          />

          {/* The colored strip at the sidebar foot. Off, the statusbar grows a
              profile dropdown beside the gateway switcher, so nobody loses the
              door — this is for people whose profiles are bots, not workspaces. */}
          <OptionCheckbox
            checked={profileRailVisible}
            onCheck={toggleProfileRailVisible}
            option={{ icon: 'organization', id: 'profile-rail', label: t.sidebar.profileRail }}
          />
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>{t.ui.actions.filters}</DropdownMenuLabel>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t.ui.actions.status}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {STATUS_FILTERS.map(option => (
                <OptionCheckbox
                  checked={statusFilter.includes(option.id)}
                  key={option.id}
                  onCheck={() => toggleSidebarStatusFilter(option.id)}
                  option={localizeFilterOption(option, filterLabels)}
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          {/* `gh` only exists where the checkout does, so on a remote backend
              this submenu never appears rather than filtering everything out. */}
          {prAvailable && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t.ui.actions.pullRequest}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {PR_FILTERS.map(option => (
                  <OptionCheckbox
                    checked={prFilter.includes(option.id)}
                    key={option.id}
                    onCheck={() => toggleSidebarPrFilter(option.id)}
                    option={localizeFilterOption(option, filterLabels)}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {narrowsByProfile && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t.ui.actions.profile}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                {profileNames.map(name => (
                  <OptionCheckbox
                    checked={profileFilter.includes(name)}
                    key={name}
                    onCheck={() => toggleSidebarProfileFilter(name)}
                    option={{ icon: 'account', id: name, label: name }}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {projects.length > 1 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t.ui.actions.project}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                {projects.map(project => (
                  <OptionCheckbox
                    checked={projectFilter.includes(project.id)}
                    key={project.id}
                    onCheck={() => toggleSidebarProjectFilter(project.id)}
                    option={{
                      icon: project.isNoProject ? 'home' : 'root-folder',
                      id: project.id,
                      // Home is synthetic, so its label is ours to translate.
                      label: project.isNoProject ? t.sidebar.projects.home : project.label
                    }}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <OptionCheckbox
            checked={showArchived}
            onCheck={() => setSidebarShowArchived(!showArchived)}
            option={{ id: 'archived', label: filterLabels.archived }}
          />

          {/* One way back rather than two near-identical ones: this drops the
              grouping and sort too, which "clear filters" left behind. */}
          {viewCustomized && (
            <DropdownMenuItem onSelect={resetSidebarView}>{t.ui.actions.resetDefaults}</DropdownMenuItem>
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        {foldIds.length > 0 && (
          <DropdownMenuItem onSelect={() => setWorkspaceNodesOpen(foldIds, foldCollapsed)}>
            {foldCollapsed ? t.ui.actions.expandAll : t.ui.actions.collapseAll}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled={unreadIds.length === 0} onSelect={markAllSessionsRead}>
          {t.ui.actions.markAllRead}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

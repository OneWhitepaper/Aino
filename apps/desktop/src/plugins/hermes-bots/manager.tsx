import './bot-manager.css'

import {
  atom,
  Button,
  Codicon,
  ConfirmDialog,
  type Contribution,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  GlyphSpinner,
  host,
  queryClient,
  RowButton,
  SearchField,
  useI18n,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { $selectedBot, $selectedRosterKey } from './bot-state'
import { CreateAgentDialog, CreateGroupChatDialog } from './create-dialog'
import {
  $botMeta,
  botRosterKey,
  botSelectionKey,
  cachedUnionRoster,
  isDefaultBot,
  primeRoster,
  useRoster
} from './data'
import { EditProfileDialog } from './edit-profile-dialog'
import { openGroupChat } from './group-chat-view'
import { useBots } from './i18n'
import { displayName, rosterConnectionLabel } from './labels'
import { MANAGER_DETAILS_KEY, ManagerDetails } from './manager-details'
import { deleteBot } from './profile-ops'
import { openBotRecentSession } from './recent-session'
import { openRosterBot } from './roster-actions'
import { usePublishRosterSnapshot } from './roster-pane-lifecycle'
import { botConnectionRoute, botRosterMeta } from './routing'
import type { RosterRow } from './types'

const $createRequested = atom(false)

/** The global creation command can arrive before the full-page manager mounts. */
export function requestCreateManagedBot(): void {
  $createRequested.set(true)
}

export interface ManagedBot extends RosterRow {
  path?: string
}

const activeConnection = () => host.state.connectionId?.get?.() || host.activeConnectionId?.() || 'local'

async function managedSourceRoster(): Promise<RosterRow[]> {
  const connection = activeConnection()

  const sourceRows = () =>
    (cachedUnionRoster()?.profiles ?? []).filter(
      bot => (bot.connectionId || bot.route?.connectionId || (!bot.remoteSource ? connection : '')) === connection
    )

  let rows = sourceRows()

  if (!rows.length) {
    await primeRoster()
    rows = sourceRows()
  }

  return activeConnection() === connection ? rows : []
}

export async function openManagedBot(profile: string): Promise<boolean> {
  const bot = (await managedSourceRoster()).find(bot => bot.name === profile)

  return bot ? openRosterBot(bot) : false
}

export async function cycleManagedBot(direction: 1 | -1): Promise<boolean> {
  const roster = await managedSourceRoster()

  if (!roster.length) {
    return false
  }

  const selectedKey = $selectedRosterKey.get() || $selectedBot.get()

  const current = roster.findIndex(bot => botRosterKey(bot) === selectedKey || botSelectionKey(bot) === selectedKey)

  const index =
    current < 0 ? (direction === 1 ? 0 : roster.length - 1) : (current + direction + roster.length) % roster.length

  return openRosterBot(roster[index])
}

const unavailable = (bot: RosterRow) =>
  Boolean(bot.ghost || bot.retained || bot.unserved || bot.sourceReachable === false)

export const BOT_MANAGER_CONTRIBUTION: Contribution = {
  id: 'manager',
  area: 'profiles.manager',
  data: { create: requestCreateManagedBot, open: openManagedBot, cycle: cycleManagedBot },
  render: () => <BotManager />
}

export function BotManager() {
  const { t } = useI18n()
  const b = useBots()
  const p = t.profiles
  const n = b.navigation
  const { data, error, isLoading, refetch } = useRoster()
  const allMeta = useValue($botMeta)
  const createRequested = useValue($createRequested)
  const connectionId = useValue(host.state.connectionId) || 'local'
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [groupCreateOpen, setGroupCreateOpen] = useState(false)
  const [editing, setEditing] = useState<RosterRow | null>(null)
  const [deleting, setDeleting] = useState<ManagedBot | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const live = Array.isArray(data?.profiles) ? data.profiles : null
  const roster: ManagedBot[] = live ?? []

  const activeSourceRoster = roster.filter(
    bot => !bot.remoteSource && !bot.ghost && (!bot.connectionId || bot.connectionId === connectionId)
  )

  usePublishRosterSnapshot({ data, live, roster, allMeta, activeSourceRoster })

  useEffect(() => {
    if (createRequested) {
      $createRequested.set(false)
      setCreateOpen(true)
    }
  }, [createRequested])

  useEffect(() => {
    if (searchOpen) {
      searchInput.current?.focus()
    }
  }, [searchOpen])

  const sourceLabel = (bot: RosterRow) => rosterConnectionLabel(bot) || b.roster.currentGateway
  const titleFor = (bot: RosterRow) => displayName(bot, botRosterMeta(bot, allMeta))
  const labelFor = (bot: RosterRow) => `${titleFor(bot)} · ${sourceLabel(bot)}`

  const faceFor = (bot: RosterRow) => {
    const appearance = botAppearance(bot.name, botRosterMeta(bot, allMeta))

    return <BotFace {...appearance} color={avatarColor(appearance.color, bot.name)} name={bot.name} size={40} />
  }

  const selected = roster.find(bot => botRosterKey(bot) === selectedKey) ?? null
  const text = query.trim().toLocaleLowerCase()

  const visible = roster.filter(bot =>
    [titleFor(bot), sourceLabel(bot), bot.description].some(value => value?.toLocaleLowerCase().includes(text))
  )

  const assistants = visible.filter(isDefaultBot)
  const bots = visible.filter(bot => !isDefaultBot(bot))

  const refresh = async () => (await refetch({ throwOnError: true })).data?.profiles ?? []

  const refreshAfterDialog = () => {
    void refetch()
    void queryClient.invalidateQueries({ queryKey: MANAGER_DETAILS_KEY })
  }

  const importBot = async () => {
    setArchiveBusy(true)

    try {
      if (await host.profiles.import()) {
        await refetch()
      }
    } catch (error) {
      host.notifyError(error, p.failedImport)
    } finally {
      setArchiveBusy(false)
    }
  }

  const exportBot = async (bot: RosterRow) => {
    setArchiveBusy(true)

    try {
      await host.profiles.export(bot.name, botConnectionRoute(bot) ?? undefined)
    } catch (error) {
      host.notifyError(error, p.failedExport)
    } finally {
      setArchiveBusy(false)
    }
  }

  const openChat = async (bot: RosterRow, recent = false) => {
    setOpening(botRosterKey(bot))

    try {
      await (recent ? openBotRecentSession(bot) : openRosterBot(bot))
    } finally {
      setOpening(null)
    }
  }

  const card = (bot: ManagedBot) => (
    <div className="workspace-card" data-active={selectedKey === botRosterKey(bot)} key={botRosterKey(bot)}>
      <RowButton
        aria-label={labelFor(bot)}
        aria-pressed={selectedKey === botRosterKey(bot)}
        className="workspace-card-select"
        onClick={() => setSelectedKey(botRosterKey(bot))}
      >
        {faceFor(bot)}
        <span className="workspace-card-copy">
          <span className="workspace-card-title">
            <span className="truncate">{titleFor(bot)}</span>
          </span>
          <span className="workspace-card-facts">
            <span className="min-w-0 truncate">{bot.description || n.noDescription}</span>
            {unavailable(bot) && <span>{b.roster.unavailable}</span>}
          </span>
        </span>
        <span className="aino-manager-config-scope">{isDefaultBot(bot) ? n.defaultScope : n.independentScope}</span>
        <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="chevron-right" />
      </RowButton>
    </div>
  )

  return (
    <section
      aria-label={n.title}
      className="workspace-manager aino-bot-manager"
      data-aino-page-shell=""
      data-bot-manager=""
    >
      <header className="workspace-header">
        <div className="min-w-0">
          <div className="workspace-heading">
            <h2>{n.title}</h2>
          </div>
          <p>{n.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Codicon name="add" />
            {b.bot.newTitle}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label={t.common.actions} size="icon-sm" variant="ghost">
                <Codicon name="ellipsis" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setSearchOpen(true)}>
                <Codicon className="mr-1.5" name="search" />
                {p.search}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={archiveBusy} onSelect={() => void importBot()}>
                <Codicon className="mr-1.5" name="cloud-download" />
                {p.importProfile}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="workspace-layout" data-inspecting={selected !== null}>
        <div className="workspace-overview-pane">
          <div className="workspace-toolbar">
            <h3>{b.canonical.botsHeading}</h3>
            <span className="aino-manager-config-heading">{n.configScope}</span>
          </div>
          {searchOpen ? (
            <div className="aino-manager-search">
              <SearchField
                aria-label={p.search}
                containerClassName="workspace-search"
                inputRef={searchInput}
                onChange={setQuery}
                placeholder={p.search}
                value={query}
              />
            </div>
          ) : null}
          {error && (
            <div className="workspace-preview-hint" role="alert">
              <Codicon name="warning" />
              <span>{live ? b.roster.staleRefresh : b.bot.loadFailed}</span>
              <Button onClick={refreshAfterDialog} size="sm" variant="ghost">
                {t.common.retry}
              </Button>
            </div>
          )}
          {isLoading && !live ? (
            <div
              className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <GlyphSpinner />
              {p.loading}
            </div>
          ) : (
            <>
              {assistants.length > 0 && (
                <section aria-label={p.defaultBadge} className="workspace-grid">
                  {assistants.map(card)}
                </section>
              )}
              <section aria-label={b.roster.botsOnly} className="workspace-grid">
                {bots.map(card)}
              </section>
              {visible.length === 0 && (
                <p className="workspace-preview-hint">{query ? b.roster.noMatchQuery(query) : b.roster.emptyDesc}</p>
              )}
            </>
          )}
          <section className="aino-manager-collaboration">
            <h3>{n.collaborationTitle}</h3>
            <div className="aino-manager-action-row">
              <div>
                <h4>{n.modelIdentity}</h4>
                <p>{n.modelIdentityDescription}</p>
              </div>
              <Button
                onClick={() => {
                  host.navigate('/')
                  host.revealPane('hermes-bots:pane')
                }}
                size="sm"
                variant="ghost"
              >
                {n.returnBot}
                <Codicon name="chevron-right" />
              </Button>
            </div>
            <div className="aino-manager-action-row">
              <div>
                <h4>{n.groups}</h4>
                <p>{n.groupsDescription}</p>
              </div>
              <Button onClick={() => setGroupCreateOpen(true)} size="sm" variant="outline">
                <Codicon name="organization" />
                {n.createGroup}
              </Button>
            </div>
          </section>
        </div>
        {selected && (
          <ManagerDetails
            archiveBusy={archiveBusy}
            avatar={faceFor(selected)}
            bot={selected}
            busy={opening !== null}
            identity={botRosterKey(selected)}
            key={botRosterKey(selected)}
            name={titleFor(selected)}
            onClose={() => setSelectedKey(null)}
            onConfigureModel={() => {
              const route = botConnectionRoute(selected)

              if (!host.openModelSettings?.(route ?? selected.name)) {
                setEditing(selected)
              }
            }}
            onDelete={() => setDeleting(selected)}
            onEdit={() => setEditing(selected)}
            onExport={() => void exportBot(selected)}
            onOpen={recent => void openChat(selected, recent)}
            opening={opening === botRosterKey(selected)}
            source={sourceLabel(selected)}
            unavailable={unavailable(selected)}
          />
        )}
      </div>
      <CreateAgentDialog
        onClose={() => {
          setCreateOpen(false)
          refreshAfterDialog()
        }}
        onConfigureModel={setEditing}
        onRefreshRoster={refresh}
        open={createOpen}
        openAfterCreate={false}
        roster={activeSourceRoster}
      />
      <CreateGroupChatDialog
        onClose={() => setGroupCreateOpen(false)}
        onCreated={(group, origin) => openGroupChat(group, origin)}
        open={groupCreateOpen}
        roster={roster}
      />
      <EditProfileDialog
        bot={editing}
        onClose={() => {
          setEditing(null)
          refreshAfterDialog()
        }}
        open={editing !== null}
      />
      <ConfirmDialog
        busyLabel={b.roster.deleting}
        confirmLabel={t.common.delete}
        description={
          deleting ? b.roster.deleteDescription(titleFor(deleting), deleting.path || sourceLabel(deleting)) : ''
        }
        destructive
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) {
            await deleteBot(deleting)
            await refetch()
            setSelectedKey(null)
          }
        }}
        open={deleting !== null}
        title={b.bot.deleteTitle}
      />
    </section>
  )
}

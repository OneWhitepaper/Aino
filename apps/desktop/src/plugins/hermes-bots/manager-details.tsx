import { Button, Codicon, GlyphSpinner, host, useI18n, useQuery } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { isDefaultBot } from './data'
import { useBots } from './i18n'
import type { ManagedBot } from './manager'
import type { ProfileDescribeResponse } from './profile-config'
import { botRecentSession } from './recent-session'
import { botConnectionRoute, requestForBot } from './routing'

export const MANAGER_DETAILS_KEY = ['hermes-bots', 'manager-details']

interface ManagerDetailsProps {
  bot: ManagedBot
  name: string
  source: string
  identity: string
  avatar: ReactNode
  archiveBusy: boolean
  unavailable: boolean
  busy: boolean
  opening: boolean
  onClose: () => void
  onConfigureModel: () => void
  onEdit: () => void
  onDelete: () => void
  onExport: () => void
  onOpen: (recent?: boolean) => void
}

interface ManagedModelReadoutProps {
  unavailable: boolean
  loading: boolean
  failed: boolean
  model?: { label: string; provider: string }
}

function ManagedModelReadout({ unavailable, loading, failed, model }: ManagedModelReadoutProps) {
  const { t } = useI18n()
  const b = useBots()

  const label = unavailable
    ? b.roster.unavailable
    : loading
      ? t.profiles.loading
      : failed
        ? t.profiles.failedLoad
        : model?.label || t.profiles.notSet

  return (
    <div className="workspace-model-value">
      <Codicon name="hubot" />
      <div className="min-w-0">
        <p className="truncate">{label}</p>
        {model?.provider && (
          <p className="workspace-provider">{model.provider === 'aino' ? t.platformModels.builtIn : model.provider}</p>
        )}
      </div>
    </div>
  )
}

export function ManagerDetails({
  bot,
  name,
  source,
  identity,
  avatar,
  archiveBusy,
  unavailable,
  busy,
  opening,
  onClose,
  onConfigureModel,
  onEdit,
  onDelete,
  onExport,
  onOpen
}: ManagerDetailsProps) {
  const { t } = useI18n()
  const p = t.profiles
  const b = useBots()

  const {
    data,
    error,
    isPending: detailsPending,
    refetch
  } = useQuery({
    queryKey: [...MANAGER_DETAILS_KEY, identity, bot.route?.targetProfile || bot.targetProfile || bot.name],
    queryFn: () =>
      requestForBot<ProfileDescribeResponse>(
        bot,
        'profiles.describe',
        { name: bot.name },
        { spawnPriority: 'foreground' }
      ),
    enabled: !unavailable,
    gcTime: 0,
    staleTime: 5000,
    retry: false
  })

  const modelQuery = useQuery({
    queryKey: [
      ...MANAGER_DETAILS_KEY,
      'effective-model',
      identity,
      bot.route?.targetProfile || bot.targetProfile || bot.name
    ],
    queryFn: () => host.profiles.effectiveModel(bot.name, botConnectionRoute(bot) ?? undefined),
    // The existing descriptor read establishes this Bot's socket capabilities first.
    enabled: !unavailable && !detailsPending,
    gcTime: 0,
    staleTime: 5000,
    retry: false
  })

  const recent = botRecentSession(bot)

  return (
    <aside aria-label={`${name} · ${source}`} className="workspace-inspector">
      <header className="workspace-inspector-heading">
        <div className="flex min-w-0 items-center gap-3">
          {avatar}
          <div className="min-w-0">
            <h3>{name}</h3>
            <div className="workspace-inspector-meta">{source}</div>
          </div>
        </div>
        <Button aria-label={t.common.close} onClick={onClose} size="icon-sm" variant="ghost">
          <Codicon name="close" />
        </Button>
      </header>
      <div className="workspace-detail-overview">
        <section className="workspace-model">
          <div className="workspace-section-heading">
            <h4>{p.modelLabel}</h4>
            <Button disabled={unavailable} onClick={onConfigureModel} size="sm" variant="outline">
              {p.configureModel}
            </Button>
          </div>
          <ManagedModelReadout
            failed={Boolean(modelQuery.error)}
            loading={modelQuery.isPending}
            model={modelQuery.data}
            unavailable={unavailable}
          />
          {(error || modelQuery.error) && (
            <Button
              onClick={() => {
                void refetch()
                void modelQuery.refetch()
              }}
              size="sm"
              variant="ghost"
            >
              {t.common.retry}
            </Button>
          )}
          {data?.skills && (
            <p className="workspace-preview-hint">{p.skills(data.skills.filter(skill => skill.enabled).length)}</p>
          )}
        </section>
        <section className="workspace-soul">
          <h4>{p.soulTitle}</h4>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-(--ui-text-secondary)">
            {bot.description || p.soulDesc}
          </p>
          <Button disabled={unavailable} onClick={onEdit} size="sm" variant="outline">
            <Codicon name="edit" />
            {b.bot.editTitle}
          </Button>
          <p className="workspace-preview-hint">{b.bot.advancedHint}</p>
        </section>
        {bot.path && (
          <details className="workspace-storage">
            <summary>{p.storageLocation}</summary>
            <p className="mt-2 break-all font-mono text-xs">{bot.path}</p>
          </details>
        )}
        <Button disabled={archiveBusy || unavailable} onClick={onExport} size="sm" variant="outline">
          <Codicon name="cloud-upload" />
          {p.exportProfile}
        </Button>
        {recent && (
          <Button disabled={busy} onClick={() => onOpen(true)} size="sm" variant="outline">
            <Codicon name="history" />
            {recent.title || b.bot.newChatWith}
          </Button>
        )}
      </div>
      <footer className="workspace-inspector-footer">
        {!isDefaultBot(bot) && (
          <Button disabled={unavailable} onClick={onDelete} size="sm" variant="ghost">
            <Codicon name="trash" />
            {t.common.delete}
          </Button>
        )}
        <Button disabled={busy || bot.unserved} onClick={() => onOpen()} size="sm">
          {opening ? <GlyphSpinner /> : <Codicon name="comment-discussion" />}
          {opening ? b.bot.openingChat : b.bot.openBotChat}
        </Button>
      </footer>
    </aside>
  )
}

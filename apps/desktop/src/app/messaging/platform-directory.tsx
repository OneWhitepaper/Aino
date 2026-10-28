import type { ReactNode } from 'react'

import { PageLoader } from '@/components/page-loader'
import { StatusDot, type StatusTone } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchField } from '@/components/ui/search-field'
import { ResponsiveTabs } from '@/components/ui/tab-dropdown'
import type { MessagingPlatformInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { localizedMessagingPlatformDescription, localizedMessagingPlatformName } from '@/i18n/messaging-platforms'
import { ChevronRight, RefreshCw, ShieldLock } from '@/lib/icons'
import { platformStatusTone } from '@/lib/platform-status'

import { PAGE_INSET_X } from '../layout-constants'
import { PageSearchShell } from '../page-search-shell'
import { SettingsProfileScope } from '../settings/profile-scope'

import { PlatformAvatar } from './platform-icon'

export type DirectoryFilter = 'all' | 'configured' | 'attention' | StatusTone

const COMMON_ORDER = ['feishu', 'weixin', 'dingtalk', 'wecom_callback', 'qqbot', 'yuanbao', 'wecom', 'email']
const INTEGRATION_PLATFORMS = new Set(['api_server', 'webhook', 'a2a', 'msgraph_webhook', 'relay'])

export function platformNeedsAttention(platform: MessagingPlatformInfo, pendingCount: number): boolean {
  return pendingCount > 0 || ['bad', 'warn'].includes(platformStatusTone(platform))
}

export function matchesDirectoryFilter(
  platform: MessagingPlatformInfo,
  filter: DirectoryFilter,
  pendingCount: number
): boolean {
  if (filter === 'configured') {
    return platform.configured
  }

  if (filter === 'attention') {
    return platformNeedsAttention(platform, pendingCount)
  }

  return filter === 'all' || platformStatusTone(platform) === filter
}

function groupPlatforms(platforms: MessagingPlatformInfo[]) {
  return [
    {
      id: 'common' as const,
      hint: 'commonHint' as const,
      platforms: platforms
        .filter(p => COMMON_ORDER.includes(p.id))
        .sort((a, b) => COMMON_ORDER.indexOf(a.id) - COMMON_ORDER.indexOf(b.id))
    },
    {
      id: 'more' as const,
      hint: 'moreHint' as const,
      platforms: platforms.filter(p => !COMMON_ORDER.includes(p.id) && !INTEGRATION_PLATFORMS.has(p.id))
    },
    {
      id: 'integrations' as const,
      hint: 'integrationsHint' as const,
      platforms: platforms.filter(p => INTEGRATION_PLATFORMS.has(p.id))
    }
  ]
}

interface MessagingDirectoryProps {
  children: ReactNode
  notice?: ReactNode
  platforms: MessagingPlatformInfo[]
  visiblePlatforms: MessagingPlatformInfo[]
  pendingCounts: Record<string, number>
  filter: DirectoryFilter
  onFilter: (filter: DirectoryFilter) => void
  query: string
  onQuery: (query: string) => void
  onSelect: (id: string) => void
  onRefresh: () => void
  refreshing: boolean
  loading: boolean
  className?: string
}

export function MessagingDirectory({
  children,
  notice,
  platforms,
  visiblePlatforms,
  pendingCounts,
  filter,
  onFilter,
  query,
  onQuery,
  onSelect,
  onRefresh,
  refreshing,
  loading,
  ...props
}: MessagingDirectoryProps) {
  const { t } = useI18n()
  const m = t.messaging
  const copy = m.directory
  const gatewayRunning = platforms.some(p => p.gateway_running)

  const tabs = [
    { id: 'all', label: copy.all, meta: platforms.length },
    { id: 'configured', label: copy.configured, meta: platforms.filter(p => p.configured).length },
    {
      id: 'attention',
      label: copy.attention,
      meta: platforms.filter(p => platformNeedsAttention(p, pendingCounts[p.id] ?? 0)).length
    }
  ]

  const toneTabs = (['bad', 'good', 'muted', 'warn'] as const)
    .filter(tone => platforms.some(p => platformStatusTone(p) === tone))
    .map(id => ({ id, label: m.statusFilter[id] }))

  return (
    <PageSearchShell {...props} searchHidden>
      <div className="messaging-page-scroll">
        <div className={'messaging-page-content ' + PAGE_INSET_X}>
          <header className="messaging-page-heading">
            <div>
              <h1>{copy.title}</h1>
              <p>{copy.subtitle}</p>
            </div>
            <SettingsProfileScope className="messaging-profile-scope" compact />
          </header>
          {platforms.length > 0 && (
            <div className="messaging-gateway-strip">
              <StatusDot tone={gatewayRunning ? 'good' : 'muted'} />
              <span>{gatewayRunning ? t.commandCenter.gatewayRunning : m.gatewayStopped}</span>
            </div>
          )}
          {notice}
          <div className="messaging-catalog-toolbar">
            <ResponsiveTabs
              onChange={id => onFilter(id as DirectoryFilter)}
              tabs={tabs}
              value={filter}
              wideClassName="messaging-directory-tabs"
            />
            <div className="messaging-search-tools">
              <SearchField
                containerClassName="messaging-search"
                onChange={onQuery}
                placeholder={m.search}
                value={query}
                variant="box"
              />
              <Button
                aria-label={t.common.refresh}
                disabled={refreshing}
                onClick={onRefresh}
                size="icon-sm"
                variant="ghost"
              >
                <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
              </Button>
            </div>
          </div>
          <details className="messaging-status-filters">
            <summary>{copy.statusFilters}</summary>
            <ResponsiveTabs
              onChange={id => onFilter(id as DirectoryFilter)}
              tabs={[{ id: 'all', label: m.statusFilter.all }, ...toneTabs]}
              value={filter}
              wideClassName="justify-start"
            />
          </details>
          <div className="messaging-directory">
            {loading && <PageLoader label={m.loading} />}
            {groupPlatforms(visiblePlatforms).map(group =>
              group.platforms.length ? (
                <section className="messaging-platform-section" key={group.id}>
                  <header className="messaging-section-heading">
                    <h2>
                      {copy[group.id]} <span>{group.platforms.length}</span>
                    </h2>
                    <p>{copy[group.hint]}</p>
                  </header>
                  <ul className="messaging-platform-grid">
                    {group.platforms.map(platform => (
                      <li key={platform.id}>
                        <PlatformCard
                          onSelect={() => onSelect(platform.id)}
                          pendingCount={pendingCounts[platform.id] ?? 0}
                          platform={platform}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null
            )}
            {!loading && !visiblePlatforms.length && (
              <div className="messaging-empty">
                <EmptyState
                  className="min-h-0 text-(--ui-text-secondary)"
                  description={copy.noMatchesHint}
                  title={copy.noMatches}
                />
                <Button
                  onClick={() => {
                    onQuery('')
                    onFilter('all')
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {copy.showAll}
                </Button>
              </div>
            )}
          </div>
          <footer className="messaging-page-footer">
            <ShieldLock />
            <p>{copy.privacy}</p>
          </footer>
        </div>
      </div>
      {children}
    </PageSearchShell>
  )
}

function PlatformCard({
  platform,
  pendingCount,
  onSelect
}: {
  platform: MessagingPlatformInfo
  pendingCount: number
  onSelect: () => void
}) {
  const { locale, t } = useI18n()
  const m = t.messaging
  const name = localizedMessagingPlatformName(locale, platform.id, platform.name)
  const tone = platformStatusTone(platform)

  return (
    <button aria-label={name} className="messaging-platform-card" data-tone={tone} onClick={onSelect} type="button">
      <PlatformAvatar className="messaging-platform-avatar" platformId={platform.id} platformName={platform.name} />
      <span className="messaging-platform-copy">
        <span className="messaging-platform-name">{name}</span>
        <span className="messaging-platform-description">
          {localizedMessagingPlatformDescription(locale, platform.id, platform.description)}
        </span>
        <span className="messaging-platform-meta">
          <StatusDot tone={tone} />
          <span>{platform.state ? m.states[platform.state] || platform.state.replace(/_/g, ' ') : m.unknown}</span>
          {pendingCount > 0 && (
            <span aria-label={m.pendingAria(pendingCount)} className="messaging-pending-count">
              {m.pendingRequests(pendingCount)}
            </span>
          )}
          {platform.id === 'wecom' && <span className="messaging-send-only">{m.directory.sendOnly}</span>}
        </span>
      </span>
      <span aria-hidden="true" className="messaging-configure-action">
        {m.directory.configure}
        <ChevronRight />
      </span>
    </button>
  )
}

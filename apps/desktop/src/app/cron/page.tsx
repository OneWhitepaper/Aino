import './page.css'

import { ChevronDown, ChevronRight, Clock, Plus, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

import { ActionsContextMenu } from '@/components/ui/actions-menu'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import type { AutomationBlueprint, CronJob } from '@/hermes'
import { useI18n } from '@/i18n'

import { Panel, PanelListRow, type PanelMenuItem, PanelRowMenu, renderPanelMenuItems } from '../overlays/panel'

import { localizedBlueprintCopy } from './blueprint-copy'
import { jobDescription } from './cron-job-model'
import { jobState, jobTitle } from './job-state'

interface CronPageProps {
  children: ReactNode
  count: number
  onClose: () => void
  onCreate: () => void
  onRefresh: () => void
  onSearch: (value: string) => void
  query: string
}

/** The route keeps the existing overlay escape/focus contract and owns only its layout. */
export function CronPage({ children, count, onClose, onCreate, onRefresh, onSearch, query }: CronPageProps) {
  const { t } = useI18n()
  const c = t.cron

  return (
    <Panel className="aino-cron-page" closeLabel={c.close} contentClassName="aino-cron-page-content" onClose={onClose}>
      <header className="aino-cron-page-header">
        <div>
          <h2>{c.title}</h2>
          <p>{c.createDesc}</p>
        </div>
        <Button onClick={onCreate} size="sm" variant="outline">
          <Plus aria-hidden size={15} strokeWidth={1.65} />
          {c.newCron}
        </Button>
      </header>
      <div className="aino-cron-page-toolbar">
        <span>{c.count(count)}</span>
        <SearchField
          aria-label={c.search}
          containerClassName="aino-cron-page-search"
          onChange={onSearch}
          placeholder={c.search}
          value={query}
        />
        <Button aria-label={t.common.refresh} onClick={onRefresh} size="icon-xs" variant="ghost">
          <RefreshCw aria-hidden size={15} strokeWidth={1.65} />
        </Button>
      </div>
      {children}
    </Panel>
  )
}

interface CronTaskRowProps {
  active: boolean
  job: CronJob
  menuItems: PanelMenuItem[]
  onSelect: () => void
  schedule: string
}

export function CronTaskRow({ active, job, menuItems, onSelect, schedule }: CronTaskRowProps) {
  const { t } = useI18n()
  const state = jobState(job)
  const detailId = `cron-task-detail-${job.id}`

  return (
    <ActionsContextMenu ariaLabel={t.cron.manage} contentClassName="w-40" items={renderPanelMenuItems(menuItems)}>
      <div className="aino-cron-task-row group/row" data-active={active} data-panel-row={job.id}>
        <button
          aria-controls={active ? detailId : undefined}
          aria-expanded={active}
          className="aino-cron-task-select"
          onClick={onSelect}
          type="button"
        >
          <span className="aino-cron-task-icon">
            <Clock aria-hidden size={21} strokeWidth={1.65} />
          </span>
          <span className="aino-cron-task-copy">
            <strong>{jobTitle(job)}</strong>
            <span>{jobDescription(job)}</span>
          </span>
          <span className="aino-cron-task-schedule">{schedule}</span>
          <span className="aino-cron-task-state" data-state={state}>
            {t.cron.states[state] ?? state}
          </span>
          <ChevronRight
            aria-hidden
            className="aino-cron-task-chevron"
            data-open={active}
            size={16}
            strokeWidth={1.65}
          />
        </button>
        <PanelRowMenu items={menuItems} label={t.cron.manage} />
      </div>
    </ActionsContextMenu>
  )
}

interface CronBlueprintCatalogProps {
  blueprints: AutomationBlueprint[]
  error: boolean
  loading: boolean
  onCreate: (key: string) => void
  onRetry: () => void
  searching: boolean
}

export function CronBlueprintCatalog({
  blueprints,
  error,
  loading,
  onCreate,
  onRetry,
  searching
}: CronBlueprintCatalogProps) {
  const { t } = useI18n()
  const c = t.cron.blueprints

  return (
    <details className="aino-cron-blueprints" open={searching || undefined}>
      <summary>
        <span>{c.tab}</span>
        <span>{blueprints.length}</span>
        <ChevronDown aria-hidden size={15} strokeWidth={1.65} />
      </summary>
      <p>{c.subtitle}</p>
      {loading ? (
        <p role="status">{c.loading}</p>
      ) : error ? (
        <div className="aino-cron-page-error" role="alert">
          <span>{c.failedLoad}</span>
          <Button onClick={onRetry} size="inline" variant="link">
            {t.common.retry}
          </Button>
        </div>
      ) : blueprints.length === 0 ? (
        <p>{c.emptyDesc}</p>
      ) : (
        <div className="aino-cron-blueprint-list">
          {blueprints.map(item => (
            <PanelListRow
              active={false}
              icon="rocket"
              key={item.key}
              meta={item.plugin || undefined}
              onSelect={() => onCreate(item.key)}
              rowKey={`blueprint-${item.key}`}
              title={localizedBlueprintCopy(item, t).title}
            />
          ))}
        </div>
      )}
    </details>
  )
}

export function CronPageError({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n()

  return (
    <div className="aino-cron-page-error" role="alert">
      <span>{t.cron.failedLoad}</span>
      <Button onClick={onRetry} size="inline" variant="link">
        {t.common.retry}
      </Button>
    </div>
  )
}

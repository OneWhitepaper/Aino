import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { ZoomableImage } from '@/components/chat/zoomable-image'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { DialogTitle } from '@/components/ui/dialog'
import { Reel } from '@/components/ui/reel'
import { RowButton } from '@/components/ui/row-button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'
import { ExternalLink } from '@/lib/external-link'
import { cn } from '@/lib/utils'

import { catalogIcon, CatalogImage } from './catalog-card'
import { type CatalogEntry, type CatalogKind } from './catalog-data'
import { catalogDescription, catalogDisplayName } from './catalog-localization'
import { CatalogDates, CatalogHeaderMeta, CatalogMetadata, CatalogRating } from './catalog-metadata'

interface CatalogDetailProps {
  entry: CatalogEntry
  kind: CatalogKind
  action?: ReactNode
  management?: ReactNode
  related: CatalogEntry[]
  onCategory?: (category: string) => void
  onTag?: (tag: string) => void
  onSearch?: (value: string) => void
  onRelated?: (entry: CatalogEntry) => void
  /** Modal details own their scroll; inline plugin details use the existing inspector scroll. */
  dialog: boolean
}

/** Title, author line and outbound links at the top of the inspector. */
function CatalogDetailHeader({ entry, dialog }: { entry: CatalogEntry; dialog?: boolean }) {
  const { t } = useI18n()
  const c = t.catalog
  const Title = dialog ? DialogTitle : 'h3'

  return (
    <header className="catalog-detail-header">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 pr-7">
            <Title className="min-w-0 flex-1 break-words text-lg font-semibold tracking-tight">
              {catalogDisplayName(entry)}
            </Title>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-(--ui-text-tertiary)">
            {entry.author && <span className="min-w-0 truncate">{entry.author}</span>}
            <CatalogHeaderMeta entry={entry} />
            <CatalogRating entry={entry} />
          </div>
        </div>
      </div>
      {(entry.sourceUrl || entry.docsUrl) && (
        <div className="flex flex-wrap gap-3 text-xs">
          {entry.sourceUrl && <ExternalLink href={entry.sourceUrl}>{c.repository}</ExternalLink>}
          {entry.docsUrl && <ExternalLink href={entry.docsUrl}>{c.documentation}</ExternalLink>}
        </div>
      )}
    </header>
  )
}

/** The shared catalog inspector used by both Skills and Plugins. No destructuring
 *  defaults: React Compiler 1.0 bails on this component with them. */
export function CatalogDetail({
  entry,
  kind,
  action,
  management,
  related,
  onCategory,
  onTag,
  onSearch,
  onRelated,
  dialog
}: CatalogDetailProps) {
  const { t } = useI18n()
  const c = t.catalog
  const root = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'overview' | 'usage'>('overview')
  const description = catalogDescription(entry, t)
  const translated = description !== entry.description

  // Paging within the drawer starts the new entry at its top.
  useLayoutEffect(() => {
    if (dialog) {
      root.current?.querySelector('.catalog-detail-scroll')?.scrollTo({ top: 0 })
    }
  }, [dialog, entry.id])

  const metadata = [
    [c.platforms, entry.platforms.join(', ')],
    [c.requires, entry.requiresHermes ? `Hermes ${entry.requiresHermes}` : ''],
    [c.pinned, entry.sha ? <code>{entry.sha.slice(0, 8)}</code> : '']
  ] as [string, ReactNode][]

  return (
    <div className={cn('catalog-detail', !dialog && 'catalog-detail-inline')} data-catalog-detail={kind} ref={root}>
      <CatalogDetailHeader dialog={dialog} entry={entry} />
      {kind === 'skills' && (
        <div className="catalog-detail-tabs">
          <SegmentedControl
            onChange={setTab}
            options={[
              { id: 'overview', label: c.about },
              { id: 'usage', label: c.howToUse }
            ]}
            sizing="content"
            value={tab}
            variant="underline"
          />
        </div>
      )}
      <div className="catalog-detail-scroll">
        <div className="catalog-detail-overview" hidden={tab !== 'overview'}>
          {entry.imageUrl && (
            <CatalogImage
              className={cn('aspect-[2/1] object-cover', dialog ? 'w-full rounded-t-xl' : 'w-full rounded-md')}
              key={entry.imageUrl}
              src={entry.imageUrl}
            />
          )}

          <p className="whitespace-pre-wrap break-words text-[length:var(--conversation-caption-font-size)] leading-relaxed text-(--ui-text-secondary)">
            {description}
          </p>
          {translated ? (
            <details className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
              <summary className="cursor-pointer">{c.originalDescription}</summary>
              <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{entry.description}</p>
              {entry.overview && entry.overview !== entry.description && (
                <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{entry.overview}</p>
              )}
            </details>
          ) : entry.overview && entry.overview !== entry.description ? (
            <p className="whitespace-pre-wrap break-words text-[length:var(--conversation-caption-font-size)] leading-relaxed text-(--ui-text-tertiary)">
              {entry.overview}
            </p>
          ) : null}

          <div className="space-y-3">
            <CatalogMetadata entry={entry} limit={Infinity} onCategory={onCategory} onSearch={onSearch} onTag={onTag} />
            <CatalogDates entry={entry} />
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 text-[length:var(--conversation-caption-font-size)]">
              {metadata
                .filter(([, value]) => Boolean(value))
                .map(([label, value]) => (
                  <div className="contents" key={label}>
                    <dt className="whitespace-nowrap text-(--ui-text-tertiary)">{label}</dt>
                    <dd className="m-0 break-words">{value}</dd>
                  </div>
                ))}
            </dl>
          </div>

          {kind !== 'skills' && management}

          {Boolean(entry.screenshots?.length) && (
            <section className="space-y-2">
              <h4 className="text-xs font-medium">{c.screenshots}</h4>
              <Reel className={cn(dialog && '-mx-4 scroll-px-4 px-4')}>
                {entry.screenshots?.map((url, index) => (
                  <ZoomableImage
                    alt={`${c.screenshots} — ${catalogDisplayName(entry)} ${index + 1}`}
                    className="h-56 w-auto max-w-none cursor-zoom-in rounded-lg border border-(--ui-stroke-tertiary)"
                    decoding="async"
                    key={url}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    slot="catalog-screenshot"
                    src={url}
                  />
                ))}
              </Reel>
            </section>
          )}

          {[
            [c.tools, entry.tools],
            [c.hooks, entry.hooks],
            [c.middleware, entry.middleware ?? []],
            [c.requires, entry.requirements]
          ].map(([label, values]) =>
            (values as string[]).length > 0 ? (
              <section className="space-y-2" key={label as string}>
                <h4 className="text-xs font-medium">{label as string}</h4>
                <div className="flex flex-wrap gap-1">
                  {(values as string[]).map(value =>
                    onSearch ? (
                      <Button key={value} onClick={() => onSearch(value)} size="xs" variant="ghost">
                        {value}
                      </Button>
                    ) : (
                      <Badge key={value} variant="muted">
                        {value}
                      </Badge>
                    )
                  )}
                </div>
              </section>
            ) : null
          )}

          <p className="text-[0.65rem] leading-relaxed text-(--ui-text-quaternary)">{c.installHint}</p>

          {related.length > 0 && (
            <section className="space-y-2">
              <h4 className="text-xs font-medium">{c.related}</h4>
              <div className="grid grid-cols-3 gap-2">
                {related.map(item => (
                  <RowButton
                    className="row-hover flex min-w-0 flex-col gap-1 overflow-hidden rounded-md text-left"
                    key={item.id}
                    onClick={() => onRelated?.(item)}
                  >
                    {item.imageUrl ? (
                      <CatalogImage className="aspect-[2/1] w-full rounded-t-md object-contain" src={item.imageUrl} />
                    ) : (
                      <span className="flex aspect-[2/1] w-full items-center justify-center bg-(--ui-bg-quaternary) text-(--ui-text-tertiary)">
                        <Codicon name={catalogIcon(item.category)} size="1.25rem" />
                      </span>
                    )}
                    <span className="w-full truncate px-2 pb-2 text-xs font-medium">{catalogDisplayName(item)}</span>
                  </RowButton>
                ))}
              </div>
            </section>
          )}
        </div>
        {kind === 'skills' && (
          <div className="catalog-detail-usage" hidden={tab !== 'usage'}>
            <p className="text-sm leading-relaxed text-(--ui-text-secondary)">{c.usageHint}</p>
            {management}
            {entry.docsUrl && <ExternalLink href={entry.docsUrl}>{c.documentation}</ExternalLink>}
          </div>
        )}
      </div>
      <footer className="catalog-detail-footer">
        <span>{c.installHint}</span>
        <span className="shrink-0">{action}</span>
      </footer>
    </div>
  )
}

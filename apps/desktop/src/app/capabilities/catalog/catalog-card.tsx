import './catalog.css'

import { type CSSProperties, type ReactNode, useState } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { RowButton } from '@/components/ui/row-button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { type CatalogEntry } from './catalog-data'
import { catalogDescription, catalogDisplayName } from './catalog-localization'
import { CatalogHeaderMeta } from './catalog-metadata'

export function catalogIcon(category: string) {
  const icons: Record<string, string> = {
    desktop: 'layout',
    tools: 'tools',
    memory: 'database',
    platform: 'plug',
    models: 'hubot',
    web: 'globe',
    automation: 'run-all',
    voice: 'mic',
    'software-development': 'code',
    'autonomous-ai-agents': 'hubot',
    productivity: 'checklist',
    creative: 'paintcan',
    research: 'beaker',
    science: 'beaker',
    security: 'shield',
    media: 'play',
    apple: 'device-desktop',
    pdf: 'file-pdf',
    'document-processing': 'files',
    'data-analysis': 'graph',
    writing: 'edit',
    'office-productivity': 'checklist'
  }

  return icons[category] ?? 'extensions'
}

export function CatalogImage({ src, className }: { src: string; className?: string }) {
  const [failed, setFailed] = useState(false)

  return failed ? null : (
    <img
      alt=""
      className={cn('block w-full object-contain', className)}
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
      src={src}
    />
  )
}

// Shared classes, not per-card inline custom properties: identical declarations
// let the style engine reuse computed styles across cards. catalog.css paints them.
export const CARD_ACCENTS = [
  '[--catalog-accent:var(--ui-blue)]',
  '[--catalog-accent:var(--ui-orange)]',
  '[--catalog-accent:var(--ui-purple)]',
  '[--catalog-accent:var(--ui-green)]',
  '[--catalog-accent:var(--ui-red)]',
  '[--catalog-accent:var(--ui-cyan)]',
  '[--catalog-accent:var(--ui-yellow)]'
]

export type CatalogCardVariant = 'default' | 'hero' | 'showcase' | 'compact' | 'horizontal'

interface CatalogCardProps {
  variant?: CatalogCardVariant
  entry: CatalogEntry
  action: ReactNode
  accentIndex: number
  onOpen: (entry: CatalogEntry) => void
  style?: CSSProperties
}

/** Cards summarize a capability; full metadata and artwork remain in its detail. */
export function CatalogCard({ entry, action, accentIndex, onOpen, variant = 'default', style }: CatalogCardProps) {
  const { t } = useI18n()

  return (
    <article
      className={cn('catalog-card', CARD_ACCENTS[accentIndex % CARD_ACCENTS.length])}
      data-catalog-card
      data-catalog-variant={variant}
      data-entry-id={entry.id}
      style={style}
    >
      <div className="catalog-card-body">
        <span aria-hidden className="catalog-card-icon">
          <Codicon name={catalogIcon(entry.category)} />
        </span>
        <div className="catalog-card-copy">
          <Tip label={catalogDisplayName(entry)}>
            <RowButton
              aria-haspopup="dialog"
              aria-label={catalogDisplayName(entry)}
              className="catalog-card-title text-left after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-primary focus-visible:after:-outline-offset-2"
              onClick={() => onOpen(entry)}
            >
              {catalogDisplayName(entry)}
            </RowButton>
          </Tip>
          <span className="catalog-card-description">{catalogDescription(entry, t)}</span>
        </div>
      </div>
      <div className="catalog-card-footer">
        <CatalogHeaderMeta compact entry={entry} />
        <span className="catalog-card-action relative z-10 shrink-0">{action}</span>
      </div>
    </article>
  )
}

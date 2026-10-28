import type { ReactNode } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { RowButton } from '@/components/ui/row-button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

import { CARD_ACCENTS, catalogIcon } from './catalog-card'
import { type CatalogEntry } from './catalog-data'
import { catalogDescription, catalogDisplayName } from './catalog-localization'

interface CatalogListRowProps {
  entry: CatalogEntry
  accentIndex: number
  selected: boolean
  action: ReactNode
  onOpen: (entry: CatalogEntry) => void
}

export function CatalogListRow({ entry, accentIndex, selected, action, onOpen }: CatalogListRowProps) {
  const { t } = useI18n()

  return (
    <div className={cn('catalog-list-row', CARD_ACCENTS[accentIndex % CARD_ACCENTS.length])} data-entry-id={entry.id}>
      <RowButton
        aria-haspopup="dialog"
        aria-label={catalogDisplayName(entry)}
        aria-pressed={selected}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
        onClick={() => onOpen(entry)}
      />
      <span aria-hidden className="catalog-card-icon">
        <Codicon name={catalogIcon(entry.category)} />
      </span>
      <span className="catalog-list-copy">
        <span className="catalog-list-title">{catalogDisplayName(entry)}</span>
        <span className="catalog-list-description">{catalogDescription(entry, t)}</span>
      </span>
      <span className="catalog-list-action relative z-10 shrink-0">{action}</span>
    </div>
  )
}

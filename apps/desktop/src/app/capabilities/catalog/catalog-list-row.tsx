import type { ReactNode } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { RowButton } from '@/components/ui/row-button'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { Lock } from '@/lib/icons'

import { catalogIcon } from './catalog-card'
import { type CatalogEntry } from './catalog-data'
import { catalogDescription, catalogDisplayName } from './catalog-localization'

interface CatalogListRowProps {
  entry: CatalogEntry
  selected: boolean
  action: ReactNode
  onOpen: (entry: CatalogEntry) => void
}

export function CatalogListRow({ entry, selected, action, onOpen }: CatalogListRowProps) {
  const { t } = useI18n()

  return (
    <div className="catalog-list-row" data-entry-id={entry.id}>
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
        <span className="catalog-list-title inline-flex items-center gap-2">
          {catalogDisplayName(entry)}
          {entry.locked && (
            <Tip label={t.skills.lockHint}>
              <span
                aria-label={t.skills.locked}
                className="inline-flex shrink-0 text-(--ui-text-tertiary)"
                data-slot="skill-locked-indicator"
                role="img"
              >
                <Lock className="size-3.5" />
              </span>
            </Tip>
          )}
        </span>
        <span className="catalog-list-description">{catalogDescription(entry, t)}</span>
      </span>
      <span className="catalog-list-action relative z-10 shrink-0">{action}</span>
    </div>
  )
}

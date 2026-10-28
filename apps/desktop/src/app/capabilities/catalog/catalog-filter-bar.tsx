import { IconCategory, IconDatabase, IconFilter2, IconRosetteDiscountCheck } from '@tabler/icons-react'
import { type ReactNode, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useI18n } from '@/i18n'

import { catalogIcon } from './catalog-card'
import { type CatalogKind } from './catalog-data'
import type { FacetRow } from './catalog-filters'
import { catalogDisplayLabel } from './catalog-localization'
import type { CatalogFacets } from './catalog-query'

interface CatalogFilterBarProps {
  kind: CatalogKind
  sources: string[]
  categories: ReadonlyArray<readonly [string, { label: string; count: number }]>
  tags: FacetRow[]
  facets: CatalogFacets
  onSource: (value: string | null) => void
  onCategory: (value: string | null) => void
  onTag: (value: string | null) => void
  onInstalled: () => void
  onClear: () => void
  sortControl: ReactNode
  actions: ReactNode
  resultCount: number
}

export function CatalogFilterBar(props: CatalogFilterBarProps) {
  const { t } = useI18n()
  const c = t.catalog
  const [mode, setMode] = useState<'categories' | 'sources'>('categories')
  // Plugins file the source facet by trust tier; skills by registry.
  const tiers = props.kind === 'plugins'
  const tierLabel = (value: string) => (tiers ? c.tierLabels[value as keyof typeof c.tierLabels] : undefined)

  const rows =
    mode === 'categories'
      ? props.categories.map(([value, meta]) => ({ value, label: catalogDisplayLabel(meta.label, t) }))
      : props.sources.map(value => ({ value, label: tierLabel(value) ?? catalogDisplayLabel(value, t) }))

  const selected = props.facets[mode]

  const onSelect = (value: string | null) => {
    if (mode === 'categories') {
      props.onCategory(value !== null && selected.includes(value) ? null : value)

      return
    }

    // Sources remain a multi-select filter; selecting every source means "All".
    props.onSource(
      value !== null &&
        !selected.includes(value) &&
        rows.every(row => row.value === value || selected.includes(row.value))
        ? null
        : value
    )
  }

  return (
    <aside aria-label={c.filters} className="catalog-filter-bar" data-catalog-filters>
      <div className="catalog-filter-row">
        <SegmentedControl
          onChange={setMode}
          options={[
            { id: 'categories', label: c.category },
            { id: 'sources', label: tiers ? c.tier : c.source }
          ]}
          sizing="content"
          value={mode}
          variant="underline"
        />
      </div>
      <div className="catalog-filter-chips">
        <Button
          aria-pressed={!selected.length}
          onClick={() => onSelect(null)}
          size="sm"
          variant={!selected.length ? 'secondary' : 'ghost'}
        >
          {mode === 'categories' ? <IconCategory /> : tiers ? <IconRosetteDiscountCheck /> : <IconDatabase />}
          <span>{mode === 'categories' ? c.allCategories : c.allSources}</span>
        </Button>
        {rows.map(row => (
          <Button
            aria-pressed={selected.includes(row.value)}
            key={row.value}
            onClick={() => onSelect(row.value)}
            size="sm"
            variant={selected.includes(row.value) ? 'secondary' : 'ghost'}
          >
            {mode === 'categories' ? <Codicon name={catalogIcon(row.value)} /> : <IconDatabase />}
            <span title={catalogDisplayLabel(row.label, t)}>{catalogDisplayLabel(row.label, t)}</span>
          </Button>
        ))}
      </div>
      <p className="catalog-rail-hint">{c.installHint}</p>
    </aside>
  )
}

/** Same facets and owner actions, surfaced beside search without a second filter state. */
export function CatalogFilterMenu(props: CatalogFilterBarProps) {
  const { t } = useI18n()
  const c = t.catalog
  const panelId = useId()
  const [expanded, setExpanded] = useState(false)
  const activeCount = props.facets.categories.length + props.facets.sources.length + props.facets.tags.length

  return (
    <div className="catalog-filter-trigger">
      <span className="sr-only" id={`${panelId}-label`}>
        {c.filters}
        {activeCount > 0 && ` · ${activeCount}`}
      </span>
      <Popover onOpenChange={setExpanded} open={expanded}>
        <PopoverTrigger asChild>
          <Button aria-labelledby={`${panelId}-label`} size="sm" variant={expanded ? 'default' : 'secondary'}>
            <IconFilter2 />
            {c.filters}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label={c.filters}
          className="w-80 max-w-[calc(100vw-2rem)] p-4"
          side="bottom"
          variant="menu"
        >
          <div className="flex max-h-[min(60vh,28rem)] flex-col gap-4 overflow-y-auto" data-catalog-expanded-filters>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{c.filters}</span>
              <Button onClick={props.onClear} size="inline" variant="text">
                {c.clearFilters}
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-xs text-(--ui-text-tertiary)">{c.sortBy}</span>
              {props.sortControl}
            </div>
            <div className="flex items-center justify-between gap-3">
              <Button
                aria-pressed={props.facets.installedOnly}
                onClick={props.onInstalled}
                size="xs"
                variant={props.facets.installedOnly ? 'default' : 'outline'}
              >
                {c.installed}
              </Button>
              <span className="text-xs text-(--ui-text-tertiary)">{c.results(props.resultCount)}</span>
            </div>
            {props.tags.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-(--ui-text-tertiary)">{c.tags}</span>
                <div className="flex flex-wrap gap-1.5">
                  {props.tags.map(row => (
                    <Button
                      aria-pressed={props.facets.tags.includes(row.value)}
                      key={row.value}
                      onClick={() => props.onTag(row.value)}
                      size="xs"
                      variant={props.facets.tags.includes(row.value) ? 'default' : 'outline'}
                    >
                      {catalogDisplayLabel(row.label, t)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {props.actions && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

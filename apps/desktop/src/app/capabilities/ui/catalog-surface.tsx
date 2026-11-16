import '../catalog/catalog-discovery.css'

import type { ReactNode } from 'react'

import type { CatalogEntry, CatalogKind } from '../catalog/catalog-data'
import { CatalogDeveloper } from '../catalog/catalog-developer'
import { CatalogListRow } from '../catalog/catalog-list-row'

export interface CatalogSurfaceItem {
  id: string
  name: string
  description: string
  /** Topline label: who or what the item belongs to. */
  eyebrow?: string
  /** Footer badge: the one piece of meta the item carries. */
  badge?: string
  action?: ReactNode
  onOpen: () => void
}

export interface CatalogSurfaceSection {
  id: string
  label: string
  blurb?: string
  /** Featured items retain their own section ahead of the themed lists. */
  layout: 'feature' | 'list'
  items: CatalogSurfaceItem[]
}

const entryFor = (item: CatalogSurfaceItem, category: string): CatalogEntry => ({
  id: item.id,
  name: item.name,
  description: item.description,
  overview: item.description,
  category,
  categoryLabel: category,
  source: item.badge ?? '',
  author: item.eyebrow ?? '',
  identifier: item.id,
  repo: '',
  sha: '',
  subdir: '',
  version: '',
  requiresHermes: '',
  tags: [],
  platforms: [],
  requirements: [],
  tools: [],
  hooks: [],
  sourceUrl: null,
  docsUrl: null,
  imageUrl: null,
  stars: null,
  search: ''
})

/** Non-registry capabilities use the same directory rows as installed skills.
 *  Featured ordering, metadata and all writes stay with the caller. */
export function CatalogSurface({
  sections,
  kind,
  actions
}: {
  sections: CatalogSurfaceSection[]
  kind: CatalogKind
  actions?: ReactNode
}) {
  return (
    <div className="@container/catalog capabilities-scroll">
      <div className="capabilities-sections capabilities-sections-page">
        {sections
          .filter(section => section.items.length)
          .map(section => (
            <section data-catalog-section={section.id} key={section.id}>
              <header className="catalog-section-heading">
                <div>
                  <h2>{section.label}</h2>
                  {section.blurb && <p>{section.blurb}</p>}
                </div>
              </header>
              <div className="catalog-list catalog-surface-list">
                {section.items.map(item => (
                  <CatalogListRow
                    action={item.action}
                    entry={entryFor(item, section.id)}
                    key={item.id}
                    meta={[...new Set([item.eyebrow, item.badge].filter(Boolean))].join(' · ')}
                    onOpen={item.onOpen}
                    selected={false}
                  />
                ))}
              </div>
            </section>
          ))}
        <CatalogDeveloper actions={actions} kind={kind} />
      </div>
    </div>
  )
}

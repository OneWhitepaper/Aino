import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useI18n } from '@/i18n'
import { Plus, ShieldLock, Trash2 } from '@/lib/icons'

import { ListRow, Pill, SectionHeading, SettingsGroup } from './primitives'
import type { VaultKind, VaultSourceName } from './vault-settings'

export interface VaultItem {
  id: string
  kind: string
  label: string
  origin: null | string
  created_at: string
  identifier?: null | string
  identifier_type?: null | string
  backend?: VaultSourceName
  has_otp?: boolean
}

export function VaultCredentialsHeading({
  count,
  embedded,
  onAdd
}: {
  count: number
  embedded?: boolean
  onAdd: () => void
}) {
  const { t } = useI18n()
  const v = t.settings.vault

  return (
    <>
      {embedded ? (
        <div className="mb-2 flex justify-end">
          <Button className="gap-1.5" onClick={() => onAdd()} size="sm" type="button" variant="outline">
            <Plus className="size-3.5" />
            {v.add}
          </Button>
        </div>
      ) : (
        <SectionHeading
          aside={
            <Button className="gap-1.5" onClick={() => onAdd()} size="sm" type="button" variant="outline">
              <Plus className="size-3.5" />
              {v.add}
            </Button>
          }
          icon={ShieldLock}
          meta={count > 0 ? v.count(count) : undefined}
          page
          title={v.title}
        />
      )}
      <p className="mb-2 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {v.blurb}
      </p>
    </>
  )
}

interface VaultCredentialItemsProps {
  items: readonly VaultItem[]
  isPending: boolean
  sourceLabel: (name: VaultSourceName) => string
  onDelete: (item: VaultItem) => void
}

export function VaultCredentialItems({ items, isPending, sourceLabel, onDelete }: VaultCredentialItemsProps) {
  const { t } = useI18n()
  const v = t.settings.vault
  const kindLabel = (kind: string) => v.kinds[kind as VaultKind] ?? kind

  const formatCreated = (iso: string) => {
    const parsed = new Date(iso)

    return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleDateString()
  }

  return (
    <>
      {!isPending && items.length === 0 && <EmptyState description={v.emptyDesc} title={v.empty} />}

      {items.length > 0 && (
        <SettingsGroup>
          {items.map(item => (
            <ListRow
              action={
                item.backend && item.backend !== 'local' ? (
                  <Pill tone="muted">{sourceLabel(item.backend)}</Pill>
                ) : (
                  <Button
                    aria-label={v.deleteAction}
                    className="text-(--ui-text-tertiary) hover:text-destructive"
                    onClick={() => onDelete(item)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )
              }
              description={
                // identifier · origin · date, separated so the row scans as three facts; the origin is
                // omitted when the label already IS the host (save-on-page items are labelled by host).
                <span className="flex flex-wrap items-center gap-x-2">
                  {item.identifier && <span className="truncate">{v.identifierShown(item.identifier)}</span>}
                  {item.origin && item.origin.replace(/^https?:\/\//, '') !== item.label && (
                    <>
                      {item.identifier && (
                        <span aria-hidden className="text-(--ui-text-tertiary)">
                          ·
                        </span>
                      )}
                      <span className="truncate">{item.origin}</span>
                    </>
                  )}
                  <span aria-hidden className="text-(--ui-text-tertiary)">
                    ·
                  </span>
                  <span>{v.createdOn(formatCreated(item.created_at))}</span>
                </span>
              }
              key={item.id}
              title={
                <span className="flex items-center gap-2">
                  <span className="truncate">{item.label}</span>
                  <Pill tone={item.kind === 'login' ? 'primary' : 'muted'}>{kindLabel(item.kind)}</Pill>
                  {item.has_otp && <Pill tone="muted">{v.twoFactorBadge}</Pill>}
                </span>
              }
            />
          ))}
        </SettingsGroup>
      )}
    </>
  )
}

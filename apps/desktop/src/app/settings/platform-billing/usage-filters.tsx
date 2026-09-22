import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useI18n } from '@/i18n'

export interface UsageFilters {
  model?: string
  desktop_purpose?: string
  start_date?: string
  end_date?: string
}

interface UsageFiltersProps {
  initialFilters: UsageFilters
  onApply: (filters: UsageFilters) => void
  purposes: readonly string[]
  timezone: string
}

export function UsageFiltersForm({ initialFilters, onApply, purposes, timezone }: UsageFiltersProps) {
  const { t } = useI18n()
  const copy = t.platformBillingHistory
  const [draft, setDraft] = useState<UsageFilters>(initialFilters)
  const [invalid, setInvalid] = useState(false)

  return (
    <form
      aria-label={copy.filters}
      className="mb-4 space-y-3 rounded-(--aino-radius-panel) border border-(--ui-stroke-tertiary) p-3"
      onSubmit={event => {
        event.preventDefault()

        if (draft.start_date && draft.end_date && draft.start_date > draft.end_date) {
          setInvalid(true)

          return
        }

        setInvalid(false)
        onApply(
          Object.fromEntries(
            Object.entries(draft)
              .map(([key, value]) => [key, value?.trim()])
              .filter(([, value]) => value)
          )
        )
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{copy.startDate}</span>
          <Input
            className="w-full"
            onChange={event => setDraft({ ...draft, start_date: event.target.value })}
            type="date"
            value={draft.start_date ?? ''}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{copy.endDate}</span>
          <Input
            className="w-full"
            onChange={event => setDraft({ ...draft, end_date: event.target.value })}
            type="date"
            value={draft.end_date ?? ''}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{copy.model}</span>
          <Input
            className="w-full"
            maxLength={255}
            onChange={event => setDraft({ ...draft, model: event.target.value })}
            placeholder={copy.modelPlaceholder}
            value={draft.model ?? ''}
          />
        </label>
        <div className="space-y-1 text-xs text-muted-foreground">
          <span>{copy.purpose}</span>
          <Select
            onValueChange={value => setDraft({ ...draft, desktop_purpose: value === 'all' ? undefined : value })}
            value={draft.desktop_purpose || 'all'}
          >
            <SelectTrigger aria-label={copy.purpose} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{copy.allPurposes}</SelectItem>
              {purposes
                .filter(purpose => Object.hasOwn(t.platformUsage.purposes, purpose))
                .map(purpose => (
                  <SelectItem key={purpose} value={purpose}>
                    {t.platformUsage.purposes[purpose as keyof typeof t.platformUsage.purposes]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {invalid && (
        <p className="text-xs text-destructive" role="alert">
          {copy.invalidDateRange}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{copy.timezone(timezone)}</span>
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setDraft({})
              setInvalid(false)
              onApply({})
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {copy.reset}
          </Button>
          <Button size="sm" type="submit" variant="outline">
            {copy.search}
          </Button>
        </div>
      </div>
    </form>
  )
}

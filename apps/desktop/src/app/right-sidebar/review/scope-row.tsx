import { useStore } from '@nanostores/react'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { TabDropdown } from '@/components/ui/tab-dropdown'
import type { HermesReviewScope } from '@/global'
import { useI18n } from '@/i18n'
import { $reviewScope, clearReviewSelection, refreshReview } from '@/store/review'

function selectScope(id: HermesReviewScope) {
  $reviewScope.set(id)
  clearReviewSelection()
  void refreshReview()
}

/** The panel tab already names Review. Keep its scope controls directly below
 *  that shared tab strip; narrow panels reuse the existing scope dropdown. */
export function ReviewScopeRow() {
  const { t } = useI18n()
  const c = t.statusStack.coding
  const scope = useStore($reviewScope)

  const options: { id: HermesReviewScope; label: string }[] = [
    { id: 'uncommitted', label: c.scopeUncommitted },
    { id: 'branch', label: c.scopeBranch },
    { id: 'lastTurn', label: c.scopeLastTurn }
  ]

  return (
    <div className="@container shrink-0 px-3 pt-3 pb-2" data-suppress-pane-reveal-side="">
      <SegmentedControl<HermesReviewScope>
        className="hidden w-full auto-cols-fr @[15rem]:grid"
        onChange={selectScope}
        options={options}
        value={scope}
      />
      <div className="flex min-h-7 items-center @[15rem]:hidden">
        <TabDropdown
          align="start"
          items={options.map(option => ({
            active: option.id === scope,
            id: option.id,
            label: option.label,
            onSelect: () => selectScope(option.id)
          }))}
        />
      </div>
    </div>
  )
}

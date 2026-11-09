import { useStore } from '@nanostores/react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { $reviewRevertTarget, cancelRevert, confirmRevert } from '@/store/review'

/** One confirmation host shared by Review and the session Summary. */
export function ReviewRevertDialog() {
  const { t } = useI18n()
  const copy = t.statusStack.coding
  const revertTarget = useStore($reviewRevertTarget)
  const revertingAll = revertTarget?.path == null

  return (
    <ConfirmDialog
      confirmLabel={revertingAll ? copy.revertAll : copy.revert}
      description={
        <>
          {revertingAll ? copy.revertAllConfirm : copy.revertConfirm}
          {!revertingAll && revertTarget?.path && (
            <span
              className="mt-2 block truncate font-mono text-[length:var(--aino-text-caption)] text-(--ui-text-secondary)"
              title={displayPath(revertTarget.path)}
            >
              {displayPath(revertTarget.path)}
            </span>
          )}
        </>
      }
      destructive
      onClose={cancelRevert}
      onConfirm={confirmRevert}
      open={revertTarget !== undefined}
      title={revertingAll ? copy.revertAll : copy.revert}
    />
  )
}

import { useStore } from '@nanostores/react'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useI18n } from '@/i18n'
import { discardPreviewTab, saveAndClosePreviewTab } from '@/store/preview'
import { $pendingPreviewClose, cancelPreviewClose } from '@/store/preview-edit'

export function PreviewCloseConfirm() {
  const { t } = useI18n()
  const tabId = useStore($pendingPreviewClose)

  return (
    <ConfirmDialog
      confirmLabel={t.toolPanel.saveClose}
      description={t.toolPanel.closeBody}
      onClose={cancelPreviewClose}
      onConfirm={async () => {
        if (tabId && !(await saveAndClosePreviewTab(tabId))) {
          throw new Error(t.toolPanel.saveCloseFailed)
        }
      }}
      open={tabId !== null}
      secondaryAction={{
        label: t.toolPanel.discard,
        onClick: () => {
          if (tabId) {
            discardPreviewTab(tabId)
          }
        }
      }}
      title={t.preview.unsavedChanges}
    />
  )
}

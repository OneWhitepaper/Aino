import { useStore } from '@nanostores/react'
import { CircleAlert, CircleArrowDown, LoaderCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import type { DesktopUpdateStatus } from '@/global'
import { useI18n } from '@/i18n'
import { $cloudOwnsUpdates } from '@/store/cloud-updates'
import { $desktopVersion, $updateApply, $updateStatus, openUpdateOverlayFor } from '@/store/updates'

function hasAvailableUpdate(status: DesktopUpdateStatus | null): boolean {
  return Boolean(
    status?.supported &&
    !status.error &&
    !status.retirement &&
    !status.held &&
    !status.rollback &&
    (status.updateAvailable || (status.behind ?? 0) > 0)
  )
}

/** An ambient door into this app's existing update flow, never an install action. */
export function ActivityUpdate() {
  const { t } = useI18n()
  const status = useStore($updateStatus)
  const apply = useStore($updateApply)
  const version = useStore($desktopVersion)
  const cloudOwnsUpdates = useStore($cloudOwnsUpdates)
  const applying = apply.applying || apply.stage === 'restart'
  const recovery = ['error', 'manual', 'guiSkew'].includes(apply.stage)

  const available = hasAvailableUpdate(status)

  if (cloudOwnsUpdates.client || version?.bundleSwapPending || !(available || applying || recovery)) {
    return null
  }

  const label = applying
    ? t.updates.stages[apply.stage]
    : recovery
      ? apply.stage === 'error'
        ? t.updates.errorTitle
        : t.updates.stages[apply.stage]
      : [t.updates.availableTitle, status?.latestTag].filter(Boolean).join(' · ')

  const state = applying ? 'applying' : recovery ? 'attention' : 'available'
  const Icon = applying ? LoaderCircle : recovery ? CircleAlert : CircleArrowDown

  return (
    <Tip label={label} side="right">
      <Button
        aria-label={label}
        className="aino-activity-button aino-activity-update"
        data-update-state={state}
        onClick={() => openUpdateOverlayFor('client')}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Icon className={applying ? 'animate-spin motion-reduce:animate-none' : undefined} />
        {!applying && <span aria-hidden="true" className="aino-activity-update-mark" />}
      </Button>
    </Tip>
  )
}

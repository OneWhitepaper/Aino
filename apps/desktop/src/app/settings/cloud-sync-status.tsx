import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { Cloud } from '@/lib/icons'
import { $cloudSync } from '@/store/cloud-sync'

import { SectionHeading, SettingsGroup } from './primitives'

export function CloudSyncStatusView() {
  const status = useStore($cloudSync)
  const { t } = useI18n()

  if (status.state === 'disabled') {
    return null
  }

  const copy = t.cloudSync

  return (
    <SettingsGroup className="account-cloud-sync-card">
      <SectionHeading icon={Cloud} title={copy.title} />
      <div
        className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded-(--aino-radius-control) bg-(--ui-bg-tertiary) px-3 py-2.5 text-sm text-(--ui-text-secondary)"
        role="status"
      >
        <p className="min-w-0 flex-1 basis-48 leading-5 [overflow-wrap:anywhere]">
          {status.error === 'DESKTOP_SYNC_QUOTA'
            ? copy.storageFull
            : status.error === 'attachment_too_large'
              ? copy.attachmentTooLarge
              : copy[status.state]}
        </p>
        {status.state !== 'syncing' && (
          <Button
            className="max-w-full whitespace-normal text-left text-[length:var(--aino-text-ui)] [overflow-wrap:anywhere]"
            onClick={() => void window.hermesDesktop?.cloudSync?.retry()}
            size="sm"
            variant="ghost"
          >
            {copy.retry}
          </Button>
        )}
      </div>
    </SettingsGroup>
  )
}

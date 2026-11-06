import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { Cloud } from '@/lib/icons'
import { $cloudSync } from '@/store/cloud-sync'

import { SectionHeading, SettingsGroup } from './primitives'

export function CloudSyncStatusView() {
  const status = useStore($cloudSync)
  const { t } = useI18n()

  if (status.state === 'disabled') { return null }
  const copy = t.cloudSync

  return <SettingsGroup>
    <SectionHeading icon={Cloud} title={copy.title} />
    <div className="account-offline-notice" role="status">
      <p>{status.error === 'DESKTOP_SYNC_QUOTA' ? copy.storageFull : status.error === 'attachment_too_large' ? copy.attachmentTooLarge : copy[status.state]}</p>
      {status.state !== 'syncing' && <Button onClick={() => void window.hermesDesktop?.cloudSync?.retry()} size="sm" variant="ghost">{copy.retry}</Button>}
    </div>
  </SettingsGroup>
}

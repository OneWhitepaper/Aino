import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'

import { StatusDot } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { MessagingPlatformInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { localizedMessagingPlatformDescription, localizedMessagingPlatformName } from '@/i18n/messaging-platforms'
import { PRODUCT_NAME } from '@/lib/brand'
import { platformStatusTone } from '@/lib/platform-status'
import { cn } from '@/lib/utils'
import { $profiles, normalizeProfileKey } from '@/store/profile'
import { $settingsScopeProfile } from '@/store/settings-scope'

import { settingsScopeLabel } from '../settings/profile-scope'

import { PlatformAvatar } from './platform-icon'

interface PlatformDialogProps {
  platform: MessagingPlatformInfo | null
  onClose: () => void
  actions: ReactNode
  children: ReactNode
  busy: boolean
  quickSetup?: boolean
}

export function PlatformDialog({
  platform,
  onClose,
  actions,
  children,
  busy,
  quickSetup = false
}: PlatformDialogProps) {
  const { locale, t } = useI18n()
  const profiles = useStore($profiles)
  const scope = useStore($settingsScopeProfile)
  const profile = profiles.find(row => normalizeProfileKey(row.name) === scope)

  const scopeLabel =
    profile?.is_default || scope === 'default' ? PRODUCT_NAME : profile ? settingsScopeLabel(profile) : scope

  return (
    <Dialog
      onOpenChange={open => {
        if (!open && !busy) {
          onClose()
        }
      }}
      open={Boolean(platform)}
    >
      {platform && (
        <DialogContent
          bodyClassName="messaging-dialog-layout"
          className={cn('messaging-config-dialog', quickSetup && 'messaging-quick-dialog')}
        >
          <header className="messaging-dialog-heading">
            <PlatformAvatar
              className="messaging-platform-avatar"
              platformId={platform.id}
              platformName={platform.name}
            />
            <div>
              <DialogTitle>{localizedMessagingPlatformName(locale, platform.id, platform.name)}</DialogTitle>
              <DialogDescription className={quickSetup ? 'sr-only' : undefined}>
                {localizedMessagingPlatformDescription(locale, platform.id, platform.description)}
              </DialogDescription>
            </div>
          </header>
          <div className="messaging-dialog-context">
            <span>
              {t.settings.profileScope.appliesTo} <strong>{scopeLabel}</strong>
            </span>
            <span>
              <StatusDot tone={platformStatusTone(platform)} />
              {platform.relay_exclusive
                ? t.messaging.relayLink.title
                : platform.state
                  ? t.messaging.states[platform.state] || platform.state.replace(/_/g, ' ')
                  : t.messaging.unknown}
            </span>
          </div>
          <div className="messaging-dialog-scroll">{children}</div>
          <footer className="messaging-dialog-footer">
            {actions}
            <Button className="messaging-cancel-button" disabled={busy} onClick={onClose} size="sm" variant="ghost">
              {t.common.cancel}
            </Button>
          </footer>
        </DialogContent>
      )}
    </Dialog>
  )
}

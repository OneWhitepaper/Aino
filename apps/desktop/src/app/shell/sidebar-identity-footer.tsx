import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router'

import { useAccountActions } from '@/app/account/account-context'
import { navigateToWorkspacePage, SETTINGS_ROUTE } from '@/app/routes'
import sidebarSettingsIcon from '@/assets/aino-home/sidebar-settings.svg'
import { AinoDesignIcon } from '@/components/aino-design-icon'
import { AvatarChip } from '@/components/ui/avatar-chip'
import { Button } from '@/components/ui/button'
import { OverflowTip, Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { setSettingsScope } from '@/store/settings-scope'

function identityInitials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)

  if (parts.length > 1) {
    return `${Array.from(parts[0])[0] ?? ''}${Array.from(parts.at(-1) ?? '')[0] ?? ''}`.toUpperCase()
  }

  return Array.from(parts[0] ?? '?')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function SidebarIdentityFooter({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const actions = useAccountActions()
  const { account } = useStore(actions.state)

  const label =
    account?.display_name.trim() || account?.phone_masked.trim() || account?.email.trim() || t.settings.account.title

  return (
    <footer
      className={
        compact
          ? 'aino-activity-account'
          : 'flex shrink-0 items-center gap-1 border-t border-(--aino-landing-stroke) p-2'
      }
      data-slot="sidebar-identity-footer"
    >
      <Button
        aria-label={`${t.settings.account.title} · ${label}`}
        className={
          compact ? 'aino-activity-button' : 'min-w-0 flex-1 justify-start gap-2.5 text-(--aino-landing-primary)'
        }
        onClick={() => {
          setSettingsScope('default')
          navigateToWorkspacePage(navigate, `${SETTINGS_ROUTE}?tab=account`)
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        <AvatarChip
          aria-hidden="true"
          className="size-7 rounded-full bg-(--aino-action-bg) text-(--aino-action-fg)"
          name={label}
        >
          {identityInitials(label)}
        </AvatarChip>
        {!compact && (
          <OverflowTip label={label}>
            <span className="min-w-0 truncate">{label}</span>
          </OverflowTip>
        )}
      </Button>
      {!compact && (
        <Tip label={t.titlebar.openSettings}>
          <Button
            aria-label={t.titlebar.openSettings}
            className="text-(--aino-landing-muted)"
            onClick={() => {
              setSettingsScope('default')
              navigateToWorkspacePage(navigate, SETTINGS_ROUTE)
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <AinoDesignIcon className="size-3.5" src={sidebarSettingsIcon} />
          </Button>
        </Tip>
      )}
    </footer>
  )
}

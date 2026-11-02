import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { triggerHaptic } from '@/lib/haptics'
import { Download, Info, Loader2, MoreHorizontal, RefreshCw, Upload } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { resolveVersionStatus } from '@/lib/version-status'
import { $connection } from '@/store/session'
import { $desktopVersion, $updateApply, $updateStatus } from '@/store/updates'

interface SettingsVersionControlProps {
  onOpenAbout: () => void
  onImport: () => void
  onExport: () => void
  onReset: () => void
}

/**
 * The client version belongs with the other system controls in Settings, not
 * in the chat status bar. Keep the same resolver as the former status-bar pill
 * so update/restart labels and commit details cannot drift between surfaces.
 */
export function SettingsVersionControl({ onOpenAbout, onImport, onExport, onReset }: SettingsVersionControlProps) {
  const { t } = useI18n()
  const copy = t.shell.statusbar
  const about = t.settings.about
  const version = useStore($desktopVersion)
  const status = useStore($updateStatus)
  const apply = useStore($updateApply)
  const connection = useStore($connection)

  const applying = apply.applying || apply.stage === 'restart'

  const resolved = resolveVersionStatus({
    applying,
    applyMessage: apply.message,
    behind: status?.behind ?? 0,
    branch: status?.branch,
    copy,
    remote: connection?.mode === 'remote',
    restarting: apply.stage === 'restart',
    sha: status?.currentSha?.slice(0, 7) ?? null,
    target: 'client',
    updateAvailable: status?.updateAvailable,
    version: version?.appVersion
  })

  const label = resolved.unknown ? about.versionUnavailable : resolved.label
  const tooltip = resolved.tooltip || label
  const menuLabel = t.ui.accessibility.moreActions

  const triggerLabel = resolved.hasUpdate
    ? `${menuLabel} · ${copy.update} · ${label}`
    : applying
      ? `${menuLabel} · ${label}`
      : menuLabel

  return (
    <DropdownMenu>
      <Tip label={triggerLabel}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={triggerLabel}
            className="settings-more-control relative"
            data-settings-more=""
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            {applying ? <Loader2 className="size-3.5 animate-spin" /> : <MoreHorizontal />}
            {resolved.hasUpdate && <span aria-hidden className="settings-update-indicator" />}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-60" side="bottom" sideOffset={8}>
        <DropdownMenuLabel>{t.commandCenter.settings}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={onImport}>
          <Upload />
          {t.settings.importConfig}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport}>
          <Download />
          {t.settings.exportConfig}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset} variant="destructive">
          <RefreshCw />
          {t.settings.resetToDefaults}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={cn(resolved.hasUpdate && 'text-primary')}
          data-settings-version=""
          onSelect={() => {
            triggerHaptic('open')
            onOpenAbout()
          }}
        >
          <Info />
          {t.settings.nav.about}
          {resolved.hasUpdate && <span className="ml-auto text-xs">{copy.update}</span>}
        </DropdownMenuItem>
        <div className="px-2 py-1.5 text-xs text-muted-foreground" title={tooltip}>
          <span>{label}</span>
          {resolved.detail && <span className="ml-2 opacity-70">{resolved.detail}</span>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

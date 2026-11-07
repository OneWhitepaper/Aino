import './approval-mode-menu.css'

import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import type { StatusbarItem } from '@/app/shell/statusbar-controls'
import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { AlertCircle, ShieldLock, Terminal } from '@/lib/icons'
import {
  $approvalModes,
  type ApprovalMode,
  type ApprovalModeRequester,
  setApprovalModeForProfile,
  syncApprovalModeForProfile
} from '@/store/approval-mode'

interface ApprovalModeOptionsProps {
  disabled?: boolean
  mode: ApprovalMode
  onValueChange: (value: ApprovalMode) => void
}

const MODE_ICONS = { manual: ShieldLock, smart: Terminal, off: AlertCircle }

export function ApprovalModeIcon({ className, mode }: { className?: string; mode: ApprovalMode }) {
  const Icon = MODE_ICONS[mode]

  return <Icon className={className} />
}

// Both the composer and status bar present the same profile-owned preference.
export function ApprovalModeOptions({ disabled, mode, onValueChange }: ApprovalModeOptionsProps) {
  const { t } = useI18n()
  const copy = t.shell.approvalMode

  const options = [
    { value: 'manual', label: copy.manual, description: copy.manualDescription },
    { value: 'smart', label: copy.smart, description: copy.smartDescription },
    { value: 'off', label: copy.off, description: copy.offDescription }
  ] as const

  return (
    <>
      <DropdownMenuLabel className="approval-mode-heading">{copy.title}</DropdownMenuLabel>
      <DropdownMenuRadioGroup onValueChange={value => onValueChange(value as ApprovalMode)} value={mode}>
        {options.map(({ value, label, description }) => (
          <DropdownMenuRadioItem
            className="approval-mode-option"
            data-approval-mode={value}
            disabled={disabled}
            key={value}
            value={value}
          >
            <ApprovalModeIcon className="approval-mode-icon size-4" mode={value} />
            <span className="approval-mode-copy">
              <span className="approval-mode-name">{label}</span>
              <span className="approval-mode-description">{description}</span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  )
}

export function useApprovalModeStatusbarItem(
  profile: string,
  requestGateway: ApprovalModeRequester,
  gatewayState: string,
  // Identity of the route the profile is served on (the active socket): a
  // move between gateways that serve the same profile name re-reads the mode.
  routeIdentity?: unknown
): StatusbarItem {
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const modes = useStore($approvalModes)
  const mode = modes[profile.trim() || 'default'] ?? 'smart'

  const labels: Record<ApprovalMode, string> = { manual: copy.manual, smart: copy.smart, off: copy.off }

  useEffect(() => {
    // The shell (and this chip) mount before the gateway socket opens at
    // boot, and a sync issued that early rejects with "Hermes gateway
    // unavailable" — the swallow below then leaves the chip on its
    // optimistic 'smart' default until some later session event reconciles
    // it. Gate on the open socket and re-run when it opens (or a reconnect
    // lands), the same way useStatusSnapshot does.
    if (gatewayState !== 'open') {
      return
    }

    void syncApprovalModeForProfile(requestGateway, profile).catch(() => undefined)
  }, [gatewayState, profile, requestGateway, routeIdentity])

  return {
    className: mode === 'off' ? 'approval-mode-trigger-warning' : undefined,
    icon: <ApprovalModeIcon className="size-3.5" mode={mode} />,
    id: 'approval-mode',
    label: labels[mode],
    menuAlign: 'end',
    menuClassName: 'approval-mode-menu',
    menuContent: (
      <ApprovalModeOptions
        mode={mode}
        onValueChange={value => {
          void setApprovalModeForProfile(requestGateway, profile, value).catch(() => undefined)
        }}
      />
    ),
    title: copy.ariaLabel(labels[mode]),
    variant: 'menu'
  }
}

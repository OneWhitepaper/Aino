import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { ApprovalModeIcon, ApprovalModeOptions } from '@/app/shell/approval-mode-menu'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { ChevronDown } from '@/lib/icons'
import { cn } from '@/lib/utils'
import {
  $approvalModes,
  type ApprovalMode,
  type ApprovalModeRequester,
  setApprovalModeForProfile,
  syncApprovalModeForProfile
} from '@/store/approval-mode'
import { requestGatewayForProfile } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import { $gatewayState } from '@/store/session'

interface ApprovalModeMenuProps {
  compact?: boolean
  disabled?: boolean
  profile: string
  requestGateway: ApprovalModeRequester
}

// This remains a workspace/profile preference, shared with Settings and slash
// commands. Moving the control must not turn it into a per-message override.
export function ComposerApprovalMode({ compact, disabled }: Pick<ApprovalModeMenuProps, 'compact' | 'disabled'>) {
  const profile = useStore($activeGatewayProfile)
  const gatewayState = useStore($gatewayState)

  const requestGateway = useCallback<ApprovalModeRequester>(
    (method, params) => requestGatewayForProfile(profile, method, params),
    [profile]
  )

  return (
    <ApprovalModeMenu
      compact={compact}
      disabled={disabled || gatewayState !== 'open'}
      profile={profile}
      requestGateway={requestGateway}
    />
  )
}

export function ApprovalModeMenu({
  compact = false,
  disabled = false,
  profile,
  requestGateway
}: ApprovalModeMenuProps) {
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const modes = useStore($approvalModes)
  const mode = modes[profile.trim() || 'default'] ?? 'smart'

  const [saving, setSaving] = useState(false)
  const labels: Record<ApprovalMode, string> = { manual: copy.manual, smart: copy.smart, off: copy.off }

  useEffect(() => {
    if (!disabled) {
      void syncApprovalModeForProfile(requestGateway, profile).catch(() => undefined)
    }
  }, [disabled, profile, requestGateway])

  const selectMode = async (value: ApprovalMode) => {
    setSaving(true)

    try {
      await setApprovalModeForProfile(requestGateway, profile, value)
    } catch (error) {
      notifyError(error, t.errors.genericFailure)
    } finally {
      setSaving(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={copy.ariaLabel(labels[mode])}
          className={cn(
            !compact && 'text-[length:var(--aino-text-label)] font-normal',
            mode === 'off' && 'approval-mode-trigger-warning'
          )}
          data-slot="composer-approval-mode"
          disabled={disabled || saving}
          size={compact ? 'icon-xs' : 'sm'}
          type="button"
          variant="ghost"
        >
          <ApprovalModeIcon mode={mode} />
          {!compact && (
            <>
              <span>{labels[mode]}</span>
              <ChevronDown />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="approval-mode-menu" side="top">
        <ApprovalModeOptions
          disabled={disabled || saving}
          mode={mode}
          onValueChange={value => void selectMode(value)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

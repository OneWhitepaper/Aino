import { registryBackendScopeKey } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useState } from 'react'

import { ApprovalModeIcon, ApprovalModeOptions } from '@/app/shell/approval-mode-menu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
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
import { $activeGatewayConnectionId, requestGatewayForAgent, requestGatewayForProfile } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { $activeGatewayProfile } from '@/store/profile'
import { $gatewayState } from '@/store/session'

import { useComposerScope } from './scope'

interface ApprovalModeMenuProps {
  compact?: boolean
  connectionId?: null | string
  disabled?: boolean
  presentation?: 'pill' | 'submenu'
  profile: string
  requestGateway: ApprovalModeRequester
}

// This remains a workspace/profile preference, shared with Settings and slash
// commands. Moving the control must not turn it into a per-message override.
export function ComposerApprovalMode({
  compact,
  disabled,
  presentation
}: Pick<ApprovalModeMenuProps, 'compact' | 'disabled' | 'presentation'>) {
  const activeProfile = useStore($activeGatewayProfile)
  const activeConnectionId = useStore($activeGatewayConnectionId)
  const gatewayState = useStore($gatewayState)
  const { connectionId: ownerConnectionId, profile: ownerProfile } = useComposerScope()
  const connectionId = ownerProfile?.trim() ? ownerConnectionId : (ownerConnectionId ?? activeConnectionId)
  const profile = ownerProfile?.trim() || activeProfile

  const requestGateway = useCallback<ApprovalModeRequester>(
    (method, params) =>
      connectionId
        ? requestGatewayForAgent(connectionId, profile, method, params)
        : requestGatewayForProfile(profile, method, params),
    [connectionId, profile]
  )

  return (
    <ApprovalModeMenu
      compact={compact}
      connectionId={connectionId}
      disabled={disabled || gatewayState !== 'open'}
      presentation={presentation}
      profile={profile}
      requestGateway={requestGateway}
    />
  )
}

export function ApprovalModeMenu({
  compact = false,
  connectionId,
  disabled = false,
  presentation = 'pill',
  profile,
  requestGateway
}: ApprovalModeMenuProps) {
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const modes = useStore($approvalModes)
  const mode = modes[registryBackendScopeKey(connectionId, profile)] ?? 'smart'

  const [saving, setSaving] = useState(false)
  const labels: Record<ApprovalMode, string> = { manual: copy.manual, smart: copy.smart, off: copy.off }

  useEffect(() => {
    if (!disabled) {
      void syncApprovalModeForProfile(requestGateway, profile, connectionId).catch(() => undefined)
    }
  }, [connectionId, disabled, profile, requestGateway])

  const selectMode = async (value: ApprovalMode) => {
    setSaving(true)

    try {
      await setApprovalModeForProfile(requestGateway, profile, value, connectionId)
    } catch (error) {
      notifyError(error, t.errors.genericFailure)
    } finally {
      setSaving(false)
    }
  }

  const options = (
    <ApprovalModeOptions disabled={disabled || saving} mode={mode} onValueChange={value => void selectMode(value)} />
  )

  if (presentation === 'submenu') {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          aria-label={copy.ariaLabel(labels[mode])}
          className={cn('min-h-8', mode === 'off' && 'approval-mode-trigger-warning')}
          disabled={disabled || saving}
        >
          <ApprovalModeIcon mode={mode} />
          <span>{copy.ariaLabel(labels[mode])}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="approval-mode-menu">{options}</DropdownMenuSubContent>
      </DropdownMenuSub>
    )
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
        {options}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { useStore } from '@nanostores/react'
import { useState } from 'react'

import type { CommandCenterSection } from '@/app/command-center'
import { GatewayMenuPanel } from '@/app/shell/gateway-menu-panel'
import { useStatusSnapshot } from '@/app/shell/hooks/use-status-snapshot'
import { StatusDot } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { ChevronDown, Command } from '@/lib/icons'
import { runtimeReadinessDisplay, type RuntimeReadinessRequester } from '@/lib/runtime-readiness'
import { $activeConnectionId } from '@/store/connections'
import { $activeGatewayProfile } from '@/store/profile'
import { $gatewayState } from '@/store/session'
import { $gatewayRestarting } from '@/store/system-actions'

interface SettingsSystemControlsProps {
  onOpenCommandCenter: () => void
  onOpenCommandCenterSection: (section: CommandCenterSection) => void
  requestGateway: RuntimeReadinessRequester
}

/**
 * The two pieces of ambient system chrome that belong to Settings rather than
 * the chat statusbar: the live gateway health and command-center entry point.
 * The menu body stays shared with the chat-era status control so
 * reconnect, restart, logs, and platform state cannot drift between surfaces.
 */
export function SettingsSystemControls({
  onOpenCommandCenter,
  onOpenCommandCenterSection,
  requestGateway
}: SettingsSystemControlsProps) {
  const { t } = useI18n()
  const copy = t.shell.statusbar
  const gatewayState = useStore($gatewayState)
  const activeConnectionId = useStore($activeConnectionId)
  const activeGatewayProfile = useStore($activeGatewayProfile)
  const gatewayRestarting = useStore($gatewayRestarting)
  const [gatewayMenuOpen, setGatewayMenuOpen] = useState(false)
  const gatewayScope = { connectionId: activeConnectionId, profile: activeGatewayProfile }
  const { inferenceStatus, statusSnapshot } = useStatusSnapshot(gatewayState, requestGateway, gatewayScope)

  const gatewayOpen = gatewayState === 'open'
  const gatewayConnecting = gatewayState === 'connecting'
  const inferenceReady = gatewayOpen && inferenceStatus?.ready === true
  const readinessDisplay = runtimeReadinessDisplay(inferenceStatus)

  const gatewayDetail = gatewayOpen
    ? {
        checking: copy.gatewayChecking,
        needs_setup: copy.gatewayNeedsSetup,
        ready: copy.gatewayReady,
        unavailable: copy.gatewayUnavailable
      }[readinessDisplay]
    : gatewayConnecting
      ? copy.gatewayConnecting
      : copy.gatewayOffline

  const gatewayTone = gatewayRestarting
    ? 'warn'
    : inferenceReady
      ? 'good'
      : gatewayOpen || gatewayConnecting
        ? 'warn'
        : 'bad'

  const gatewayAccessibleDetail = gatewayRestarting ? copy.gatewayRestarting : gatewayDetail

  const gatewayDisplay = gatewayRestarting
    ? 'restarting'
    : gatewayOpen
      ? readinessDisplay
      : gatewayConnecting
        ? 'connecting'
        : 'offline'

  return (
    <div className="settings-system-controls">
      <DropdownMenu onOpenChange={setGatewayMenuOpen} open={gatewayMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`${copy.gateway}: ${gatewayAccessibleDetail}`}
            className="settings-runtime-control"
            data-runtime-status={gatewayDisplay}
            data-settings-gateway=""
            size="sm"
            type="button"
            variant="ghost"
          >
            <StatusDot className="settings-runtime-dot" data-runtime-status={gatewayDisplay} tone={gatewayTone} />
            <span className="truncate">{gatewayAccessibleDetail}</span>
            <ChevronDown aria-hidden="true" className="settings-runtime-chevron size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 p-0" side="bottom" sideOffset={8}>
          <GatewayMenuPanel
            gatewayState={gatewayState}
            inferenceStatus={inferenceStatus}
            onClose={() => setGatewayMenuOpen(false)}
            onOpenSystem={() => onOpenCommandCenterSection('system')}
            statusSnapshot={statusSnapshot}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <span aria-hidden="true" className="settings-system-controls-separator" />
      <Tip label={copy.openCommandCenter}>
        <Button
          aria-label={copy.openCommandCenter}
          className="settings-command-center-control"
          data-settings-command-center=""
          onClick={onOpenCommandCenter}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Command aria-hidden="true" />
        </Button>
      </Tip>
    </div>
  )
}

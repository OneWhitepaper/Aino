import { useStore } from '@nanostores/react'
import { useState } from 'react'

import type { CommandCenterSection } from '@/app/command-center'
import { GatewayMenuPanel } from '@/app/shell/gateway-menu-panel'
import { useStatusSnapshot } from '@/app/shell/hooks/use-status-snapshot'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { Activity, AlertCircle, ChevronDown, Command } from '@/lib/icons'
import { runtimeReadinessDisplay, type RuntimeReadinessRequester } from '@/lib/runtime-readiness'
import { cn } from '@/lib/utils'
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
 * the chat statusbar: the command-center entry point and the live gateway
 * health menu. The menu body stays shared with the chat-era status control so
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

  const gatewayClassName = inferenceReady
    ? undefined
    : gatewayOpen || gatewayConnecting
      ? 'text-amber-600 hover:text-amber-600'
      : 'text-destructive hover:text-destructive'

  const gatewayAccessibleDetail = gatewayRestarting ? copy.gatewayRestarting : gatewayDetail

  return (
    <div className="flex min-w-0 flex-1 flex-col items-stretch gap-0.5 max-[47.5rem]:flex-none max-[47.5rem]:flex-row max-[47.5rem]:items-center max-[47.5rem]:gap-1">
      <Tip label={copy.openCommandCenter}>
        <Button
          aria-label={copy.openCommandCenter}
          className="w-full min-w-0 justify-start text-(--ui-text-secondary) hover:text-foreground max-[47.5rem]:w-auto max-[47.5rem]:flex-none max-[47.5rem]:px-2"
          data-settings-command-center=""
          onClick={onOpenCommandCenter}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Command />
          <span className="truncate max-[47.5rem]:hidden">{copy.openCommandCenter}</span>
        </Button>
      </Tip>

      <DropdownMenu onOpenChange={setGatewayMenuOpen} open={gatewayMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`${copy.gateway}: ${gatewayAccessibleDetail}`}
            className={cn(
              'w-full min-w-0 justify-start text-(--ui-text-secondary) data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground max-[47.5rem]:w-auto max-[47.5rem]:flex-none max-[47.5rem]:px-2',
              !gatewayRestarting && gatewayClassName
            )}
            data-settings-gateway=""
            size="sm"
            type="button"
            variant="ghost"
          >
            {gatewayRestarting ? (
              <GlyphSpinner ariaLabel={copy.gatewayRestarting} />
            ) : inferenceReady ? (
              <Activity />
            ) : (
              <AlertCircle />
            )}
            <span className="truncate max-[47.5rem]:hidden">{copy.gateway}</span>
            <span className="truncate text-muted-foreground/80 max-[47.5rem]:hidden">
              {gatewayRestarting ? copy.gatewayRestarting : gatewayDetail}
            </span>
            <ChevronDown className="ml-auto opacity-60 max-[47.5rem]:hidden" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 p-0" side="top" sideOffset={8}>
          <GatewayMenuPanel
            gatewayState={gatewayState}
            inferenceStatus={inferenceStatus}
            onClose={() => setGatewayMenuOpen(false)}
            onOpenSystem={() => onOpenCommandCenterSection('system')}
            statusSnapshot={statusSnapshot}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

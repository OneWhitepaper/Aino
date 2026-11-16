import { StartupOverlay } from '@/components/boot-failure-overlay'
import { ConfirmHost } from '@/components/confirm-host'
import { DesktopInstallOverlay } from '@/components/desktop-install-overlay'
import { ExternalOpenFailedDialog } from '@/components/external-open-failed-dialog'
import { GatewayConnectingOverlay } from '@/components/gateway-connecting-overlay'
import { SendDiagnosticsHost } from '@/components/send-diagnostics-dialog'
import { isAuxiliaryWindow } from '@/store/windows'

/** Window-wide recovery hosts have no conversation or route ownership. */
export function WiringRecoverySurfaces() {
  return (
    <>
      <ConfirmHost />
      <SendDiagnosticsHost />
      <ExternalOpenFailedDialog />
      {!isAuxiliaryWindow() && <DesktopInstallOverlay />}
      <GatewayConnectingOverlay />
      <StartupOverlay />
    </>
  )
}

import { useStore } from '@nanostores/react'

import { ModelVisibilityDialog } from '@/components/model-visibility-dialog'
import type { HermesGateway } from '@/hermes'
import { queryClient } from '@/lib/query-client'
import {
  $customModelConfigTarget,
  $modelVisibilityOpen,
  closeCustomModelConfig,
  setModelVisibilityOpen
} from '@/store/model-visibility'
import { $activeSessionId, $gatewayState } from '@/store/session'

import { CustomModelConfigDialog } from './settings/custom-endpoints-settings'
import { ThirdPartyModelConfigDialog } from './settings/third-party-model-settings'

interface ModelVisibilityOverlayProps {
  gateway?: HermesGateway
  onOpenProviders: () => void
  ownerConnectionId?: string
  profile: string
}

export function ModelVisibilityOverlay({
  gateway,
  onOpenProviders,
  ownerConnectionId,
  profile
}: ModelVisibilityOverlayProps) {
  const activeSessionId = useStore($activeSessionId)
  const gatewayOpen = useStore($gatewayState) === 'open'
  const open = useStore($modelVisibilityOpen)
  const configTarget = useStore($customModelConfigTarget)

  return (
    <>
      {gatewayOpen && (
        <ModelVisibilityDialog
          gw={gateway}
          onOpenChange={setModelVisibilityOpen}
          onOpenProviders={onOpenProviders}
          open={open}
          ownerConnectionId={ownerConnectionId}
          profile={profile}
          sessionId={activeSessionId}
        />
      )}
      {configTarget?.kind === 'provider' ? (
        <ThirdPartyModelConfigDialog
          key={`${configTarget.connectionId ?? ''}:${configTarget.profile}:provider`}
          onConfigSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['model-options'] })
          }}
          onOpenChange={nextOpen => {
            if (!nextOpen) {
              closeCustomModelConfig()
            }
          }}
          open
          providerId={configTarget.providerId}
          scope={configTarget}
        />
      ) : (
        configTarget && (
          <CustomModelConfigDialog
            key={`${configTarget.connectionId ?? ''}:${configTarget.profile}`}
            onConfigSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ['model-options'] })
            }}
            onOpenChange={nextOpen => {
              if (!nextOpen) {
                closeCustomModelConfig()
              }
            }}
            open
            scope={configTarget}
          />
        )
      )}
    </>
  )
}

import type { ModelOptionsResult } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { ModelPickerDialog } from '@/components/model-picker'
import { useI18n } from '@/i18n'
import { translateNow } from '@/i18n/runtime'
import { sessionRecoveryCopy } from '@/i18n/session-recovery'
import { modelOptionsQueryKey } from '@/lib/model-options'
import { queryClient } from '@/lib/query-client'
import { switchSessionModel } from '@/lib/session-model-switch'
import { activeGateway } from '@/store/gateway'
import { platformSessionAccess } from '@/store/platform-session-access'
import { captureSessionRecovery } from '@/store/session-recovery'
import { knownOwnerForSession, requestForOwnedSession } from '@/store/session-states'

interface SessionModelRecoveryProps {
  className: string
  label: string
}

/** A recovery choice is temporary until Apply; the normal model menu stays immediate. */
export function SessionModelRecovery({ className, label }: SessionModelRecoveryProps) {
  const { locale } = useI18n()
  const copy = sessionRecoveryCopy(locale)
  const view = useSessionView()
  const runtimeId = useStore(view.$runtimeId)
  const model = useStore(view.$model)
  const provider = useStore(view.$provider)
  const busy = useStore(view.$busy)
  const [target, setTarget] = useState<ReturnType<typeof captureSessionRecovery> | null>(null)
  const owner = target ? knownOwnerForSession(target.runtimeId) : null

  const request = <T,>(method: string, params?: Record<string, unknown>): Promise<T> => {
    if (!target?.isCurrent()) {
      return Promise.reject(new Error(copy.changed))
    }

    return requestForOwnedSession(
      target.runtimeId,
      (name, input) => {
        const gateway = activeGateway()

        return gateway ? gateway.request(name, input) : Promise.reject(new Error(copy.disconnected))
      },
      method,
      params
    )
  }

  return (
    <>
      <button
        className={className}
        disabled={!runtimeId}
        onClick={() => runtimeId && setTarget(captureSessionRecovery(runtimeId))}
        type="button"
      >
        {label}
      </button>
      {target && (
        <ModelPickerDialog
          busy={busy}
          confirmation={{ title: copy.modelTitle, description: copy.modelDescription, applyLabel: copy.apply }}
          contentClassName="max-w-[440px]"
          currentModel={model}
          currentProvider={provider}
          includePlatform
          onOpenChange={open => {
            if (!open) {
              setTarget(null)
            }
          }}
          onSelect={async selection => {
            if (!target.isCurrent() || view.$runtimeId.get() !== target.runtimeId) {
              throw new Error(copy.changed)
            }

            if (!owner) {
              throw new Error(copy.changed)
            }

            const profile = typeof owner === 'string' ? owner : owner.profile
            const connectionId = typeof owner === 'object' ? owner.connectionId : undefined
            const cacheProfile = typeof owner === 'string' ? owner : (owner.targetProfile ?? owner.profile)

            return switchSessionModel({
              selection: { ...selection, sessionId: target.runtimeId },
              sessionOnly: true,
              recoverUnbound: platformSessionAccess(target.runtimeId).kind === 'unbound',
              queryClient,
              profile,
              connectionId,
              request,
              cache: (sessionId, provider, model) => {
                queryClient.setQueryData<ModelOptionsResult>(
                  modelOptionsQueryKey(cacheProfile, sessionId, connectionId),
                  previous => ({ ...previous, model, provider, providers: previous?.providers ?? [] })
                )
              },
              copy: {
                confirm: translateNow('common.confirm'),
                failed: translateNow('desktop.modelSwitchFailed'),
                busy: translateNow('platformModels.switchBusy'),
                recovery: translateNow('platformModels.switchRecovery'),
                retry: translateNow('platformModels.retry')
              }
            })
          }}
          open
          ownerConnectionId={owner && typeof owner === 'object' ? owner.connectionId : undefined}
          profile={typeof owner === 'string' ? owner : (owner?.targetProfile ?? owner?.profile)}
          request={request}
          sessionId={target.runtimeId}
        />
      )}
    </>
  )
}

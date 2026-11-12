import { useStore } from '@nanostores/react'
import { type ReactNode, useMemo, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { sessionRecoveryCopy } from '@/i18n/session-recovery'
import { useStoreSelector } from '@/lib/use-session-slice'
import { notifyError } from '@/store/notifications'
import { createPlatformSignInRecovery } from '@/store/platform-model-capability'
import { requestRoute } from '@/store/recovery-requests'
import { $deferredSessionSignIns, captureSessionRecovery, deferSessionSignIn } from '@/store/session-recovery'

import { InlineRecovery } from './inline-recovery'

export function isSessionSignInFailure(code: string): boolean {
  return [
    'RECENT_AUTH_REQUIRED',
    'not_authenticated',
    'managed_auth_unavailable',
    'managed_credential_expired',
    'managed_credential_revoked',
    'managed_credential_rejected',
    'DESKTOP_DEVICE_KEY_REVOKED'
  ].includes(code)
}

export function SessionSignInRecovery({ children }: { children?: ReactNode }) {
  const { locale } = useI18n()
  const copy = sessionRecoveryCopy(locale)
  const runtimeId = useStore(useSessionView().$runtimeId)
  const deferred = useStoreSelector($deferredSessionSignIns, entries => (runtimeId ? entries[runtimeId] : undefined))

  const recovery = useMemo(() => {
    const target = runtimeId ? captureSessionRecovery(runtimeId) : null
    const signIn = createPlatformSignInRecovery()

    return (
      target && {
        ...target,
        recover: async () => {
          if (!target.isCurrent()) {
            throw new Error(copy.changed)
          }

          if (target.accountStore?.get()?.account) {
            await signIn()
          } else {
            requestRoute('/settings?tab=account')
          }
        }
      }
    )
  }, [runtimeId, copy.changed])

  const [pending, setPending] = useState(false)

  if (deferred?.isCurrent()) {
    return null
  }

  const recover = async () => {
    if (!recovery || pending) {
      return
    }

    setPending(true)

    try {
      await recovery.recover()
    } catch (error) {
      if (recovery.isCurrent()) {
        notifyError(error, copy.signIn)
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <InlineRecovery
      actions={
        <>
          <Button disabled={!recovery} loading={pending} onClick={() => void recover()} size="sm">
            {copy.signIn}
          </Button>
          <Button
            disabled={!recovery || pending}
            onClick={() => recovery && deferSessionSignIn(recovery)}
            size="sm"
            variant="ghost"
          >
            {copy.later}
          </Button>
        </>
      }
      description={copy.authBody}
      icon="account"
      title={copy.authTitle}
    >
      {children}
    </InlineRecovery>
  )
}

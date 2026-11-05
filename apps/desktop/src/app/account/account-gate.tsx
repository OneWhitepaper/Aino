import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { createLegacyDevelopmentAccountActions, platformAccountActions } from '@/api/platform'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { AccountActions, AccountState } from '@/store/account'
import { $activeConnectionId } from '@/store/connections'
import { requestGatewayForAgent } from '@/store/gateway'
import { $gatewayState } from '@/store/session'

import type { PlatformAccountSnapshot } from '../../../shared/platform-contract'

import { AccountContext } from './account-context'
import { AccountLoginCard } from './account-login-card'

export interface AccountFlowProps {
  actions: AccountActions
  children: ReactNode
  refreshEnabled?: boolean
}

function accountWorkspaceIdentity(state: AccountState, snapshot: PlatformAccountSnapshot | null): string | null {
  return state.authenticated && state.account && snapshot?.account?.id === state.account.id
    ? JSON.stringify([snapshot.mode, state.account.id])
    : null
}

function useAccountRestoration(actions: AccountActions, state: AccountState) {
  const [resolvedActions, setResolvedActions] = useState<AccountActions | null>(null)
  // Loading also occurs during sign-in. Once this flow has resolved identity,
  // keep its form mounted so authentication and second-factor drafts survive.
  const restoringAccount = resolvedActions !== actions && state.phase === 'loading' && !state.error

  useLayoutEffect(() => {
    if (!restoringAccount) {
      setResolvedActions(actions)
    }
  }, [actions, restoringAccount])

  return restoringAccount
}

export function AccountFlow({ actions, children, refreshEnabled = true }: AccountFlowProps) {
  const state = useStore(actions.state)
  const snapshot = useStore(actions.snapshot)
  const { t } = useI18n()
  const copy = t.settings.account
  const navigate = useNavigate()
  const loginContent = useRef<HTMLDivElement>(null)
  const [windowError, setWindowError] = useState(false)
  const [workspace, setWorkspace] = useState<{ actions: AccountActions; identity: string } | null>(null)
  const restoringAccount = useAccountRestoration(actions, state)

  const identity = accountWorkspaceIdentity(state, snapshot)

  const workspaceReady =
    !restoringAccount && identity !== null && workspace?.actions === actions && workspace.identity === identity

  const expectedOwner = useMemo(
    () =>
      snapshot?.account && state.adapter === 'platform'
        ? {
            userId: snapshot.account.id,
            mode: snapshot.mode,
            revision: snapshot.revision
          }
        : undefined,
    [snapshot, state.adapter]
  )

  useEffect(() => {
    if (refreshEnabled) {
      void actions.refresh()
    }
  }, [actions, refreshEnabled])

  useLayoutEffect(() => {
    const setMode = window.hermesDesktop?.setAccountWindowMode
    let active = true
    setWindowError(false)

    if (workspaceReady) {
      return
    }

    if (restoringAccount) {
      setWorkspace(null)

      return
    }

    if (identity !== null) {
      // Native acceptance binds the window's data scope as well as its bounds.
      // A late acknowledgment must never reveal another account's subtree.
      setWorkspace(null)
      void Promise.resolve()
        .then(() => setMode?.('workspace', undefined, expectedOwner))
        .then(ready => {
          if (active) {
            if (ready === true) {
              setWorkspace({ actions, identity })
            } else {
              setWindowError(true)
            }
          }
        })
        .catch(() => {
          if (active) {
            setWindowError(true)
          }
        })

      return () => {
        active = false
      }
    }

    setWorkspace(null)

    if (!setMode) {
      return
    }

    const content = loginContent.current

    if (!content) {
      return
    }

    const resize = () => {
      if (active && content.isConnected) {
        void setMode('login', content.scrollHeight).catch(() => setWindowError(true))
      }
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(content)

    return () => {
      active = false
      observer.disconnect()
    }
  }, [actions, expectedOwner, identity, restoringAccount, workspaceReady])

  return (
    <AccountContext.Provider value={actions}>
      {workspaceReady && (
        <div className="contents" key={identity}>
          {children}
        </div>
      )}
      {state.authenticated && workspaceReady ? null : state.authenticated || restoringAccount ? (
        <main
          className="grid h-screen place-items-center bg-(--ui-chat-surface-background)"
          data-account-restoring-page=""
        >
          {windowError ? <p role="status">{copy.errors.unavailable}</p> : <PageLoader label={copy.loadingStatus} />}
        </main>
      ) : (
        <main
          aria-label={copy.signInTitle}
          className="aino-account-window h-screen w-full overflow-y-auto bg-(--ui-chat-surface-background) text-(--ui-text-primary)"
          data-account-login-page=""
          onKeyDownCapture={event => event.stopPropagation()}
        >
          <div className="flex w-full flex-col items-center" ref={loginContent}>
            <AccountLoginCard
              capabilities={state.capabilities}
              error={state.error}
              fixedCodeHint={state.fixedCodeHint}
              loading={state.loading}
              onCompleteSecondFactor={actions.completeSecondFactor}
              onLoginExisting={actions.loginExisting}
              onRequestPhoneCode={actions.requestPhoneCode}
              onVerifyPhoneCode={async input => {
                const result = await actions.verifyPhoneCode(input)

                if (result?.status === 'signed_in') {
                  navigate('/', { replace: true })
                }

                return result
              }}
            />
            {!state.capabilities && !state.error && (state.loading || !state.ready) && (
              <p className="text-sm text-(--ui-text-tertiary)" role="status">
                {copy.loadingStatus}
              </p>
            )}
            {windowError && <p className="px-8 pb-4 text-center text-xs text-destructive">{copy.errors.unavailable}</p>}
            {state.error && !state.capabilities && !state.loading && (
              <Button onClick={() => void actions.retry()} variant="text">
                {copy.refresh}
              </Button>
            )}
          </div>
        </main>
      )}
    </AccountContext.Provider>
  )
}

export function shouldGatePlatformAccount(search: string) {
  const role = new URLSearchParams(search).get('win')

  return role !== 'hud' && role !== 'browser'
}

export function AccountGate({ children }: { children: ReactNode }) {
  const connectionId = useStore($activeConnectionId)
  const gatewayState = useStore($gatewayState)

  const legacyActions = useMemo(
    () =>
      createLegacyDevelopmentAccountActions((method, params) =>
        requestGatewayForAgent(connectionId, 'default', method, params)
      ),
    [connectionId]
  )

  if (!shouldGatePlatformAccount(window.location.search)) {
    return children
  }

  const legacy = window.hermesDesktop.accountAdapter === 'legacy-development'
  const actions = legacy ? legacyActions : platformAccountActions(window.hermesDesktop.platformAccount)

  // The descriptor arrives before the WebSocket opens; only legacy auth uses that socket.
  return (
    <AccountFlow actions={actions} refreshEnabled={!legacy || gatewayState === 'open'}>
      {children}
    </AccountFlow>
  )
}

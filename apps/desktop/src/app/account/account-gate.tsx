import { useStore } from '@nanostores/react'
import { Activity, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { createLegacyDevelopmentAccountActions, platformAccountActions } from '@/api/platform'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { AccountActions } from '@/store/account'
import { $activeConnectionId } from '@/store/connections'
import { requestGatewayForAgent } from '@/store/gateway'
import { $gatewayState } from '@/store/session'

import { AccountContext } from './account-context'
import { AccountLoginCard } from './account-login-card'

export interface AccountFlowProps {
  actions: AccountActions
  children: ReactNode
  refreshEnabled?: boolean
}

export function AccountFlow({ actions, children, refreshEnabled = true }: AccountFlowProps) {
  const state = useStore(actions.state)
  const { t } = useI18n()
  const copy = t.settings.account
  const navigate = useNavigate()
  const loginContent = useRef<HTMLDivElement>(null)
  const [windowError, setWindowError] = useState(false)
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [workspaceMounted, setWorkspaceMounted] = useState(false)

  useEffect(() => {
    if (refreshEnabled) {
      void actions.refresh()
    }
  }, [actions, refreshEnabled])

  useLayoutEffect(() => {
    const setMode = window.hermesDesktop?.setAccountWindowMode
    let active = true

    if (state.authenticated) {
      // Mount the workspace only after native bounds are restored. Otherwise
      // its responsive layout observes the login width and collapses panes.
      void Promise.resolve(setMode?.('workspace'))
        .then(() => {
          if (active) {
            setWorkspaceReady(true)
            setWorkspaceMounted(true)
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

    setWorkspaceReady(false)

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
  }, [state.authenticated])

  return (
    <AccountContext.Provider value={actions}>
      {workspaceMounted && (
        <Activity mode={state.authenticated && workspaceReady ? 'visible' : 'hidden'}>
          <div
            className="contents"
            hidden={!state.authenticated || !workspaceReady}
            inert={!state.authenticated || !workspaceReady}
          >
            {children}
          </div>
        </Activity>
      )}
      {state.authenticated && workspaceReady ? null : state.authenticated ? (
        <main className="grid h-screen place-items-center bg-(--ui-chat-surface-background)">
          <p role="status">{windowError ? copy.errors.unavailable : copy.loadingStatus}</p>
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

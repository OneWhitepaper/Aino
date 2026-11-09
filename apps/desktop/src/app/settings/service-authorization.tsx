import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { $apiRequestScope, ambientOwnerConnectionId } from '@/api/client'
import { runInTerminal } from '@/app/right-sidebar/store'
import { ProviderRow, providerTitle, sortProviders } from '@/components/onboarding'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { RowButton } from '@/components/ui/row-button'
import { Tip } from '@/components/ui/tooltip'
import { disconnectOAuthProvider, listOAuthProviders, type ProfileScope } from '@/hermes'
import { useI18n } from '@/i18n'
import { Check, ChevronRight, Loader2, Terminal, Trash2 } from '@/lib/icons'
import { platformDefaultScope } from '@/lib/platform-model-scope'
import { confirm } from '@/store/confirm'
import { notify, notifyError } from '@/store/notifications'
import { $desktopOnboarding, startManualProviderOAuth } from '@/store/onboarding'
import type { OAuthProvider } from '@/types/hermes'

import { SettingsSkeleton } from './primitives'

const canRunInTerminal = () => typeof window !== 'undefined' && Boolean(window.hermesDesktop?.terminal)

interface ServiceAuthorizationProps {
  onClose?: () => void
  profile?: ProfileScope
}

/** Authorization uses the service's existing OAuth flow and the exact settings owner route. */
export function ServiceAuthorization(props: ServiceAuthorizationProps) {
  useStore($apiRequestScope)
  const scope = platformDefaultScope(props.profile)

  return <ScopedServiceAuthorization key={scope.key} {...props} profile={scope.route} />
}

function ScopedServiceAuthorization({ onClose, profile }: ServiceAuthorizationProps) {
  const { t } = useI18n()
  const [providers, setProviders] = useState<OAuthProvider[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const onboardingActive = useStore($desktopOnboarding).manual

  useEffect(() => {
    if (onboardingActive) {
      return
    }

    let cancelled = false
    void listOAuthProviders(profile)
      .then(result => {
        if (!cancelled) {
          setProviders(sortProviders(result.providers))
          setFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [attempt, onboardingActive, profile])

  const disconnect = async (provider: OAuthProvider, terminal: boolean) => {
    const name = providerTitle(provider)
    const command = provider.disconnect_command
    const terminalOwner = { ...platformDefaultScope(profile).route }
    terminalOwner.connectionId ??= ambientOwnerConnectionId()

    if (terminal && !command) {
      return
    }

    if (
      !(await confirm({
        confirmLabel: t.settings.providers.disconnect,
        destructive: true,
        title: terminal
          ? t.settings.providers.removeTerminalConfirm(name, command!)
          : t.settings.providers.removeConfirm(name)
      }))
    ) {
      return
    }

    if (terminal) {
      try {
        await runInTerminal(command!, terminalOwner)
        onClose?.()
        notify({
          kind: 'info',
          title: t.settings.providers.disconnect,
          message: t.settings.providers.removeTerminalRunning(name)
        })
      } catch (error) {
        notifyError(error, t.settings.providers.failedRemove(name))
      }

      return
    }

    setDisconnecting(provider.id)

    try {
      const result = await disconnectOAuthProvider(provider.id, profile)

      if (!result?.ok) {
        notifyError(new Error(t.settings.providers.failedRemove(name)), t.settings.providers.failedRemove(name))

        return
      }

      notify({
        kind: 'success',
        title: t.settings.providers.removedTitle,
        message: t.settings.providers.removedMessage(name)
      })
      setAttempt(current => current + 1)
    } catch (error) {
      notifyError(error, t.settings.providers.failedRemove(name))
    } finally {
      setDisconnecting(null)
    }
  }

  if (failed) {
    return (
      <ErrorState title={t.common.failed}>
        <Button onClick={() => setAttempt(current => current + 1)} size="sm" variant="outline">
          {t.common.retry}
        </Button>
      </ErrorState>
    )
  }

  if (providers === null) {
    return <SettingsSkeleton sections={[{ rows: 2 }]} />
  }

  return (
    <div className="grid gap-2">
      {providers.map(provider =>
        provider.status?.logged_in && !provider.status.free_tier ? (
          <ConnectedProviderRow
            disconnecting={disconnecting === provider.id}
            key={provider.id}
            onDisconnect={provider => void disconnect(provider, false)}
            onSelect={provider => startManualProviderOAuth(provider.id, profile)}
            onTerminalDisconnect={provider => void disconnect(provider, true)}
            provider={provider}
          />
        ) : (
          <ProviderRow
            key={provider.id}
            onSelect={provider => startManualProviderOAuth(provider.id, profile)}
            provider={provider}
          />
        )
      )}
    </div>
  )
}

function ConnectedProviderRow({
  disconnecting,
  onDisconnect,
  onSelect,
  onTerminalDisconnect,
  provider
}: {
  disconnecting: boolean
  onDisconnect: (provider: OAuthProvider) => void
  onSelect: (provider: OAuthProvider) => void
  onTerminalDisconnect: (provider: OAuthProvider) => void
  provider: OAuthProvider
}) {
  const { t } = useI18n()
  const copy = t.settings.providers
  const title = providerTitle(provider)
  const Trail = provider.flow === 'external' ? Terminal : ChevronRight
  // Hermes can clear this provider's creds via the API.
  const canDisconnect = provider.disconnectable ?? provider.flow !== 'external'
  // External (CLI-managed) provider Hermes can't clear via the API, but ships a
  // command we can run in the embedded terminal (Electron shell only).
  const terminalDisconnect = !canDisconnect && Boolean(provider.disconnect_command) && canRunInTerminal()
  // Only fall back to a static "remove it elsewhere" hint when we offer no button.
  const showHint = !canDisconnect && !terminalDisconnect

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-(--aino-radius-control) transition-colors hover:bg-(--ui-control-hover-background)">
      <RowButton
        className="min-w-0 px-3 py-2.5 text-left"
        onClick={() => (terminalDisconnect ? onTerminalDisconnect(provider) : onSelect(provider))}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[length:var(--conversation-text-font-size)] font-semibold">{title}</span>
          <span className="inline-flex shrink-0 items-center gap-1 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            <Check className="size-3" />
            {copy.connected}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{t.onboarding.flowSubtitles[provider.flow]}</p>
        {showHint && (
          <p className="mt-0.5 truncate text-[length:var(--aino-text-caption)] leading-5 text-(--ui-text-tertiary)">
            {provider.flow === 'external' ? copy.removeExternalGeneric(title) : copy.removeKeyManaged(title)}
          </p>
        )}
      </RowButton>
      <div className="flex items-center gap-1 pr-2">
        {terminalDisconnect ? (
          <Button
            aria-label={`${copy.disconnect} ${title} in terminal`}
            onClick={() => onTerminalDisconnect(provider)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Terminal className="size-4" />
          </Button>
        ) : (
          <Trail className="size-4 text-muted-foreground transition group-hover:text-foreground" />
        )}
        {canDisconnect && (
          <Button
            aria-label={`${t.common.remove} ${title}`}
            disabled={disconnecting}
            onClick={() => onDisconnect(provider)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            {disconnecting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
          </Button>
        )}
        {terminalDisconnect && (
          <Tip label={copy.disconnectInTerminal}>
            <Button
              aria-label={`${copy.disconnect} ${title}`}
              onClick={() => onTerminalDisconnect(provider)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-3" />
            </Button>
          </Tip>
        )}
      </div>
    </div>
  )
}
